import { AMENITY_RADIUS_M, OVERPASS_TIMEOUT_MS, OVERPASS_URL } from './config'
import type { AmenityCounts } from './types'

const cache = new Map<string, AmenityCounts | null>()

function buildQuery(lat: number, lon: number): string {
  const r = AMENITY_RADIUS_M
  const at = `(around:${r},${lat.toFixed(5)},${lon.toFixed(5)})`
  return `[out:json][timeout:${Math.floor(OVERPASS_TIMEOUT_MS / 1000)}];
(node["shop"~"^(supermarket|greengrocer|convenience|grocery)$"]${at};way["shop"~"^(supermarket|grocery)$"]${at};)->.g;.g out count;
(node["amenity"~"^(cafe|restaurant|fast_food|bar|pub)$"]${at};)->.f;.f out count;
(node["leisure"~"^(park|playground)$"]${at};way["leisure"~"^(park|playground)$"]${at};relation["leisure"="park"]${at};)->.p;.p out count;
(node["amenity"~"^(school|kindergarten)$"]${at};way["amenity"="school"]${at};)->.s;.s out count;
(node["highway"="bus_stop"]${at};node["public_transport"~"^(platform|stop_position)$"]${at};node["railway"~"^(station|tram_stop|halt)$"]${at};)->.t;.t out count;`
}

/**
 * Count nearby amenities via Overpass. Best-effort: returns null on any
 * failure (timeout, rate limit, offline) and the sheet renders without it.
 */
export async function fetchAmenities(zip: string, lat: number, lon: number): Promise<AmenityCounts | null> {
  if (cache.has(zip)) return cache.get(zip) ?? null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS)
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(buildQuery(lat, lon)),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`overpass ${res.status}`)
    const json = (await res.json()) as { elements?: Array<{ type: string; tags?: Record<string, string> }> }
    const counts = (json.elements ?? [])
      .filter((e) => e.type === 'count')
      .map((e) => Number(e.tags?.total ?? 0))
    if (counts.length < 5) throw new Error('short overpass response')
    const out: AmenityCounts = {
      groceries: counts[0],
      food: counts[1],
      parks: counts[2],
      schools: counts[3],
      transit: counts[4],
    }
    cache.set(zip, out)
    return out
  } catch {
    // Cache the failure for this session so we don't hammer Overpass.
    cache.set(zip, null)
    return null
  }
}
