export const OWNER = 'mreindl118-boop'
export const REPO = 'Zillowner'

// BASE_URL is '/Zillowner/' in production builds and '/' in dev.
export const BASE = import.meta.env.BASE_URL
export const DATA_PMTILES = `${BASE}data/costlab.pmtiles`
export const DATA_META = `${BASE}data/meta.json`

export const RELEASES_LATEST_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
export const APK_ASSET_NAME = 'costlab.apk'

export const US_CENTER: [number, number] = [-96.5, 38.8]
export const US_ZOOM = 3.4
export const LOCATE_ZOOM = 9.6

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
export const OVERPASS_TIMEOUT_MS = 8000
export const AMENITY_RADIUS_M = 1500
