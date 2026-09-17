import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

/**
 * Resolve the user's position. On the Android shell this goes through the
 * Capacitor Geolocation plugin (which raises the native runtime-permission
 * prompt); on the web it uses the browser API. Returns null on any failure —
 * callers fall back to the US overview.
 */
export async function getPosition(): Promise<{ lng: number; lat: number } | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.requestPermissions()
      if (perm.location === 'denied' && perm.coarseLocation === 'denied') return null
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 10 * 60 * 1000,
      })
      return { lng: pos.coords.longitude, lat: pos.coords.latitude }
    }
  } catch {
    return null
  }
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lng: p.coords.longitude, lat: p.coords.latitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    )
  })
}
