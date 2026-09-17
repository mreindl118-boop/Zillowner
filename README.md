# costLAB

**How much does it cost to live here?** A one-glance, mobile-first map of the US:
typical home value, estimated monthly ownership cost, and typical rent for every
ZIP-code area, rendered as a color-coded choropleth.

- **Live app:** https://mreindl118-boop.github.io/Zillowner/
- **Android APK:** https://github.com/mreindl118-boop/Zillowner/releases/latest/download/costlab.apk

Area-level only — no addresses, no listings.

## How updates ship (two layers)

1. **Content, UI, logic** — the Android shell renders the live GitHub Pages URL.
   Every push to `main` redeploys Pages and updates every install instantly.
   Most changes never need a new APK.
2. **Native shell** — on launch (throttled to once/24h) the app compares the
   latest GitHub release tag with its installed version; if newer it offers a
   small in-app banner that downloads `costlab.apk` and opens the package
   installer. Offline/failed checks never block the app.

## Architecture

| Piece | What | Where |
|---|---|---|
| Web app | TypeScript + Vite + MapLibre GL JS + PMTiles (PWA) | GitHub Pages (`pages.yml`) |
| Data | pandas/geopandas + tippecanoe → `costlab.pmtiles` + `meta.json` | monthly `data.yml`, published to the `data` branch |
| Android | Capacitor 8 shell (`server.url` → Pages) + AppUpdate plugin | `android.yml` on tag `v*` → GitHub Release |

## Data sources & attribution

- Housing data © [Zillow Research](https://www.zillow.com/research/data/) —
  ZHVI (mid-tier SFR+condo), Total Monthly Payment (20% down), ZORI. Latest
  month + year-over-year change per ZIP.
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
  (basemap tiles + amenity counts via Overpass API).
- Boundaries: US Census Bureau ZCTA cartographic boundary files (2020, 500k).
- Place names: [GeoNames](https://www.geonames.org/) (CC-BY 4.0).

## Releasing

**One-time bootstrap** (already done for this repo): run the `android` workflow
via *Actions → android → Run workflow* on `main`. Its `keystore` job generates
the release signing key into a main-scoped Actions cache and uploads it
encrypted to the owner's RSA key (`keys/export_public.pem`).

Then, for every release:

```bash
git tag v1.2.3 && git push origin v1.2.3   # builds, signs, and publishes costlab.apk
```

`versionName` comes from the tag, `versionCode` from the CI run number.

### APK signing

The build resolves the signing key in order — and **fails rather than mint a
new key**, because a changed signature would break in-app updates on every
installed device:

1. **Repo secrets** `KEYSTORE_B64`, `KEYSTORE_PASS`, `KEY_ALIAS`, `KEY_PASS`
   (the permanent, recommended home — set them in Settings → Secrets → Actions
   from the encrypted export).
2. **Actions cache** (`costlab-release-keystore-v1`, created only on `main` by
   the `keystore` job and kept warm by its weekly schedule — Actions caches are
   ref-scoped, so only a main-created cache is visible to tag builds).

The keystore never appears in git history, logs, or plaintext artifacts.
