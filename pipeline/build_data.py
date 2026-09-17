#!/usr/bin/env python3
"""
costLAB data pipeline.

Fetches Zillow Research ZIP-level CSVs (ZHVI, Total Monthly Payment, ZORI),
computes the latest value + YoY change per ZIP, joins to Census ZCTA
polygons and GeoNames place names, and writes:

  out/zips.geojsonl   — newline-delimited GeoJSON features for tippecanoe
  out/meta.json       — data months + national quantile breaks per metric

Tippecanoe (run by the workflow) turns zips.geojsonl into costlab.pmtiles.

Data sources (all free, attributed in-app / README):
  - Zillow Research: https://www.zillow.com/research/data/
  - Census ZCTA cartographic boundaries (500k)
  - GeoNames postal codes (CC-BY 4.0)
"""

from __future__ import annotations

import io
import json
import re
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}

ZSTATIC = "https://files.zillowstatic.com/research/public_csvs"
RESEARCH_PAGE = "https://www.zillow.com/research/data/"

# Known-good URL candidates first; discovery from the research page as backup.
METRIC_SOURCES: dict[str, dict] = {
    "hv": {
        "name": "ZHVI (mid-tier SFR+condo)",
        "candidates": [
            f"{ZSTATIC}/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
            f"{ZSTATIC}/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_month.csv",
        ],
        # tokens that must / may appear in a discovered URL, all lowercase
        "must": ["zip_", "zhvi"],
        "prefer": ["tier_0.33_0.67", "sfrcondo", "sm_sa_month"],
        "avoid": ["bdrmcnt", "tier_0.0_0.33", "tier_0.67_1.0", "uc_condo_", "uc_sfr_", "growth", "forecast"],
    },
    "mc": {
        "name": "Total Monthly Payment (20% down)",
        "candidates": [
            f"{ZSTATIC}/total_monthly_payment/Zip_total_monthly_payment_downpayment_0.20_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
            f"{ZSTATIC}/total_monthly_payment/Zip_total_monthly_payment_downpayment_0.20_uc_sfrcondo_sm_sa_month.csv",
            f"{ZSTATIC}/new_homeowner_affordability/Zip_new_homeowner_affordability_downpayment_0.20_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
        ],
        "must": ["zip_"],
        "prefer": ["total_monthly_payment", "downpayment_0.20", "tier_0.33_0.67", "sm_sa_month"],
        "require_any": ["total_monthly_payment", "monthly_payment"],
        "avoid": ["growth", "forecast", "share", "income"],
    },
    "rn": {
        "name": "ZORI (all homes+MF)",
        "candidates": [
            f"{ZSTATIC}/zori/Zip_zori_uc_sfrcondomfr_sm_sa_month.csv",
            f"{ZSTATIC}/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
        ],
        "must": ["zip_", "zori"],
        "prefer": ["sfrcondomfr", "sm_sa_month"],
        "avoid": ["growth", "forecast", "_yr"],
    },
}

ZCTA_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip"
GEONAMES_URL = "https://download.geonames.org/export/zip/US.zip"

# Fallback for the monthly-cost metric when Zillow's payment series is not
# available at ZIP level: compute it from ZHVI. Mortgage rate comes from
# Freddie Mac PMMS (free, keyless), else DEFAULT_RATE_PCT.
PMMS_URL = "https://www.freddiemac.com/pmms/docs/PMMS_history.csv"
DEFAULT_RATE_PCT = 6.35
PROPERTY_TAX_RATE = 0.011  # /yr of home value, national approximation
INSURANCE_RATE = 0.0035  # /yr of home value, national approximation

OUT_DIR = Path(__file__).resolve().parent.parent / "out"
N_CLASSES = 6  # 6-step ramps in the app → 5 interior quantile breaks

DATE_COL_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")


def http_get(url: str, tries: int = 3, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout)
            if r.status_code == 200:
                return r
            last = RuntimeError(f"HTTP {r.status_code} for {url}")
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed after {tries} tries: {url}: {last}")


def discover_csv_urls() -> list[str]:
    """Scrape the research page for public_csvs links (browser UA required)."""
    try:
        html = http_get(RESEARCH_PAGE, timeout=60).text
    except Exception as e:  # noqa: BLE001
        print(f"[discover] research page unavailable: {e}")
        return []
    urls = re.findall(r"https://files\.zillowstatic\.com/research/public_csvs/[^\s\"'<>\\]+\.csv", html)
    urls = sorted(set(u.replace("\\u002F", "/") for u in urls))
    print(f"[discover] found {len(urls)} csv urls on research page")
    return urls


def pick_discovered(urls: list[str], spec: dict) -> str | None:
    def ok(u: str) -> bool:
        lu = u.lower()
        if not all(t in lu for t in spec.get("must", [])):
            return False
        req_any = spec.get("require_any")
        if req_any and not any(t in lu for t in req_any):
            return False
        if any(t in lu for t in spec.get("avoid", [])):
            return False
        return True

    scored = [(sum(t in u.lower() for t in spec.get("prefer", [])), u) for u in urls if ok(u)]
    if not scored:
        return None
    scored.sort(key=lambda x: (-x[0], len(x[1])))
    return scored[0][1]


def fetch_metric_csv(key: str, discovered: list[str]) -> pd.DataFrame | None:
    spec = METRIC_SOURCES[key]
    tried: list[str] = []
    urls = list(spec["candidates"])
    picked = pick_discovered(discovered, spec)
    if picked and picked not in urls:
        urls.append(picked)
    for url in urls:
        tried.append(url)
        try:
            r = http_get(url, tries=2)
            df = pd.read_csv(io.BytesIO(r.content), dtype={"RegionName": str})
            if "RegionName" not in df.columns:
                print(f"[{key}] no RegionName column in {url}")
                continue
            date_cols = [c for c in df.columns if DATE_COL_RE.match(c)]
            if len(date_cols) < 13:
                print(f"[{key}] too few date columns ({len(date_cols)}) in {url}")
                continue
            print(f"[{key}] OK {url}  rows={len(df)} months={len(date_cols)} latest={date_cols[-1]}")
            return df
        except Exception as e:  # noqa: BLE001
            print(f"[{key}] failed {url}: {e}")
    print(f"[{key}] UNAVAILABLE — tried: {tried}")
    return None


def latest_and_yoy(df: pd.DataFrame, key: str) -> tuple[pd.DataFrame, str]:
    date_cols = [c for c in df.columns if DATE_COL_RE.match(c)]
    date_cols.sort()
    # pick the most recent month with a reasonable fill rate (trailing months
    # can be nearly empty right after a publish)
    counts = {c: df[c].notna().sum() for c in date_cols[-4:]}
    best_fill = max(counts.values()) if counts else 0
    latest = date_cols[-1]
    for c in reversed(date_cols[-4:]):
        if counts[c] >= 0.5 * best_fill:
            latest = c
            break

    # YoY: same month one year earlier, else the closest ≥ 11 months back
    latest_dt = datetime.strptime(latest[:7], "%Y-%m")
    target = latest_dt.replace(year=latest_dt.year - 1)
    prior = None
    for c in reversed(date_cols):
        c_dt = datetime.strptime(c[:7], "%Y-%m")
        months_back = (latest_dt.year - c_dt.year) * 12 + (latest_dt.month - c_dt.month)
        if months_back >= 11:
            prior = c
            if c_dt <= target:
                break
    zips = df["RegionName"].str.replace(r"\D", "", regex=True).str.zfill(5)
    out = pd.DataFrame({"zip": zips, key: pd.to_numeric(df[latest], errors="coerce")})
    if prior is not None:
        prev = pd.to_numeric(df[prior], errors="coerce")
        with np.errstate(divide="ignore", invalid="ignore"):
            yoy = (out[key] / prev - 1.0) * 100.0
        yoy[~np.isfinite(yoy)] = np.nan
        out[f"{key}_yoy"] = yoy.round(1)
    out = out.dropna(subset=[key]).drop_duplicates(subset=["zip"])
    out[key] = out[key].round(0)
    return out, latest[:7]


def fetch_zcta():
    import geopandas as gpd

    print("[zcta] downloading Census ZCTA 500k boundaries…")
    r = http_get(ZCTA_URL, timeout=300)
    tmp = OUT_DIR / "_zcta.zip"
    tmp.write_bytes(r.content)
    # pyogrio (geopandas>=1.0 default engine) reads .zip archives directly
    gdf = gpd.read_file(tmp)
    zcol = next((c for c in gdf.columns if c.upper().startswith("ZCTA5CE")), None)
    if zcol is None:
        raise RuntimeError(f"ZCTA id column not found; columns={list(gdf.columns)}")
    gdf = gdf[[zcol, "geometry"]].rename(columns={zcol: "zip"})
    gdf["zip"] = gdf["zip"].astype(str).str.zfill(5)
    gdf = gdf.to_crs(4326)
    print(f"[zcta] {len(gdf)} polygons")
    tmp.unlink(missing_ok=True)
    return gdf


def fetch_geonames() -> pd.DataFrame:
    try:
        print("[names] downloading GeoNames US postal codes…")
        r = http_get(GEONAMES_URL, timeout=120)
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            with z.open("US.txt") as f:
                names = pd.read_csv(
                    f,
                    sep="\t",
                    header=None,
                    usecols=[1, 2, 4],
                    names=["zip", "city", "st"],
                    dtype=str,
                )
        names["zip"] = names["zip"].str.zfill(5)
        names = names.drop_duplicates(subset=["zip"])
        print(f"[names] {len(names)} zips named")
        return names
    except Exception as e:  # noqa: BLE001
        print(f"[names] unavailable (non-fatal): {e}")
        return pd.DataFrame(columns=["zip", "city", "st"])


def current_mortgage_rate() -> tuple[float, str]:
    """Latest 30-year fixed rate (percent) from Freddie Mac PMMS, with fallback."""
    try:
        r = http_get(PMMS_URL, tries=2, timeout=60)
        rows = [ln for ln in r.text.splitlines() if ln.strip()]
        header = [h.strip().lower() for h in rows[0].split(",")]
        col = next((i for i, h in enumerate(header) if "30" in h), 1)
        for ln in reversed(rows[1:]):
            parts = ln.split(",")
            if len(parts) > col:
                try:
                    rate = float(parts[col].strip().strip('"'))
                    if 1.0 < rate < 20.0:
                        return rate, "pmms"
                except ValueError:
                    continue
        raise RuntimeError("no parsable rate rows")
    except Exception as e:  # noqa: BLE001
        print(f"[rate] PMMS unavailable ({e}); using default {DEFAULT_RATE_PCT}%")
        return DEFAULT_RATE_PCT, "default"


def computed_monthly_cost(hv: pd.Series, rate_pct: float) -> pd.Series:
    """Est. all-in monthly cost: 30-yr P&I on 80% LTV + est. tax + insurance."""
    r = rate_pct / 100.0 / 12.0
    loan = 0.8 * hv
    pi = loan * (r / (1.0 - (1.0 + r) ** -360))
    extras = hv * (PROPERTY_TAX_RATE + INSURANCE_RATE) / 12.0
    return (pi + extras).round(0)


def nice_round(v: float) -> float:
    if v <= 0 or not np.isfinite(v):
        return float(round(v)) if np.isfinite(v) else 0.0
    mag = 10 ** max(0, int(np.floor(np.log10(v))) - 1)
    return float(round(v / mag) * mag)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    discovered = discover_csv_urls()
    months: dict[str, str] = {}
    frames: list[pd.DataFrame] = []
    for key in METRIC_SOURCES:
        df = fetch_metric_csv(key, discovered)
        if df is None:
            continue
        tidy, month = latest_and_yoy(df, key)
        months[key] = month
        frames.append(tidy)
        print(f"[{key}] {len(tidy)} zips, data month {month}")

    if not any(k in months for k in ("hv", "rn")):
        print("FATAL: neither ZHVI nor ZORI could be fetched — aborting so stale data is kept.")
        return 1

    merged: pd.DataFrame | None = None
    for f in frames:
        merged = f if merged is None else merged.merge(f, on="zip", how="outer")
    assert merged is not None

    # Zillow's Total Monthly Payment series is not published at ZIP level;
    # when it's absent, estimate monthly cost from ZHVI (labeled as an
    # estimate in the app via mc_method/mc_rate in meta.json).
    mc_method = "zillow" if "mc" in months else None
    mc_rate: float | None = None
    if "mc" not in months and "hv" in months:
        rate, src = current_mortgage_rate()
        merged["mc"] = computed_monthly_cost(merged["hv"], rate)
        merged.loc[merged["hv"].isna(), "mc"] = np.nan
        months["mc"] = months["hv"]
        mc_method, mc_rate = "computed", rate
        print(f"[mc] computed from ZHVI at {rate}% 30-yr ({src}), "
              f"tax {PROPERTY_TAX_RATE:.1%}/yr + ins {INSURANCE_RATE:.2%}/yr")

    gdf = fetch_zcta()
    names = fetch_geonames()
    if len(names):
        gdf = gdf.merge(names, on="zip", how="left")
    gdf = gdf.merge(merged, on="zip", how="inner")
    print(f"[join] {len(gdf)} zips with geometry + data")
    if len(gdf) < 5000:
        print("FATAL: suspiciously few joined zips — aborting.")
        return 1

    # National quantile breaks (5 interior → 6 classes)
    breaks: dict[str, list[float]] = {}
    counts: dict[str, int] = {}
    for key in METRIC_SOURCES:
        if key not in gdf.columns:
            continue
        vals = gdf[key].dropna().to_numpy()
        if len(vals) < 1000:
            continue
        qs = np.quantile(vals, [i / N_CLASSES for i in range(1, N_CLASSES)])
        # MapLibre 'step' expressions require strictly ascending stops, so
        # rounding collisions must be resolved.
        stops: list[float] = []
        prev = float("-inf")
        for q in qs:
            v = nice_round(float(q))
            if v <= prev:
                v = float(round(q))
            if v <= prev:
                v = prev + 1.0
            stops.append(v)
            prev = v
        breaks[key] = stops
        counts[key] = int(len(vals))
        print(f"[breaks] {key}: {breaks[key]} (n={counts[key]})")

    # Write newline-delimited GeoJSON for tippecanoe
    out_path = OUT_DIR / "zips.geojsonl"
    cols = [c for c in ["zip", "city", "st", "hv", "hv_yoy", "mc", "mc_yoy", "rn", "rn_yoy"] if c in gdf.columns]
    try:
        import pyogrio

        pyogrio.write_dataframe(
            gdf[cols + ["geometry"]],
            out_path,
            driver="GeoJSONSeq",
            COORDINATE_PRECISION="5",
        )
    except Exception as e:  # noqa: BLE001
        print(f"[write] pyogrio failed ({e}); falling back to manual writer")
        from shapely.geometry import mapping

        def prune(props: dict) -> dict:
            return {k: v for k, v in props.items() if v is not None and v == v}

        with out_path.open("w") as fh:
            for _, row in gdf[cols + ["geometry"]].iterrows():
                props = prune({c: row[c] for c in cols})
                geom = mapping(row.geometry)
                fh.write(json.dumps({"type": "Feature", "properties": props, "geometry": geom}) + "\n")

    meta = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version": 1,
        "months": months,
        "breaks": breaks,
        "counts": counts,
        "mc_method": mc_method,
        "mc_rate": mc_rate,
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"[out] {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")
    print(f"[out] meta.json: {json.dumps(meta)[:400]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
