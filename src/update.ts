import { Capacitor, registerPlugin } from '@capacitor/core'
import { APK_ASSET_NAME, RELEASES_LATEST_API } from './config'

interface AppUpdatePlugin {
  getInfo(): Promise<{ versionName: string; versionCode: number }>
  install(options: { url: string }): Promise<void>
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate')

const CHECK_KEY = 'cl_update_checked_at'
const SKIP_KEY = 'cl_update_skip'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

function parseSemver(v: string): number[] | null {
  const m = v.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function semverGt(a: string, b: string): boolean {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return false
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i]
  }
  return false
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode etc. — throttling just won't persist */
  }
}

/**
 * Layer-2 auto-update: on launch (at most once per 24h) compare the installed
 * versionName against the latest GitHub release tag; if newer, offer a small
 * non-blocking banner that downloads the APK and fires the package installer.
 * Every failure path is silent — an offline check must never block the app.
 */
export async function initUpdateCheck(force = false): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) return
    const last = Number(storageGet(CHECK_KEY) || 0)
    if (!force && Date.now() - last < CHECK_INTERVAL_MS) return
    storageSet(CHECK_KEY, String(Date.now()))

    const info = await AppUpdate.getInfo()
    const res = await fetch(RELEASES_LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return
    const rel = (await res.json()) as {
      tag_name?: string
      assets?: Array<{ name: string; browser_download_url: string }>
    }
    const latest = String(rel.tag_name ?? '').replace(/^v/, '')
    if (!latest || !semverGt(latest, info.versionName)) return
    if (storageGet(SKIP_KEY) === latest) return
    const asset = (rel.assets ?? []).find((a) => a.name === APK_ASSET_NAME)
    if (!asset) return
    showBanner(latest, asset.browser_download_url)
  } catch {
    /* never block or delay the app */
  }
}

function showBanner(version: string, url: string): void {
  const banner = document.getElementById('update-banner')
  const text = document.getElementById('update-text')
  const install = document.getElementById('update-install') as HTMLButtonElement | null
  const later = document.getElementById('update-later')
  if (!banner || !text || !install || !later) return

  text.textContent = `costLAB v${version} is available`
  banner.hidden = false

  install.onclick = async () => {
    install.disabled = true
    text.textContent = 'Downloading update…'
    try {
      await AppUpdate.install({ url })
      text.textContent = 'Opening installer…'
      setTimeout(() => (banner.hidden = true), 4000)
    } catch {
      text.textContent = 'Update failed — try again later'
      install.disabled = false
      setTimeout(() => (banner.hidden = true), 5000)
    }
  }
  later.onclick = () => {
    storageSet(SKIP_KEY, version)
    banner.hidden = true
  }
}
