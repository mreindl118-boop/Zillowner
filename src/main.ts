import './style.css'
import { BASE, DATA_META, LOCATE_ZOOM } from './config'
import { getPosition } from './geo'
import { createMap } from './map'
import { METRIC_ORDER } from './metrics'
import { Sheet, renderLegend } from './sheet'
import type { Meta, MetricKey } from './types'
import { initUpdateCheck } from './update'

async function loadMeta(): Promise<Meta | null> {
  try {
    const res = await fetch(DATA_META, { cache: 'no-cache' })
    if (!res.ok) return null
    const meta = (await res.json()) as Meta
    if (!meta || typeof meta !== 'object' || !meta.breaks) return null
    return meta
  } catch {
    return null
  }
}

function toast(msg: string, ms = 4000): void {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.hidden = false
  window.setTimeout(() => (el.hidden = true), ms)
}

async function boot(): Promise<void> {
  const meta = await loadMeta()
  let metric: MetricKey = 'hv'
  const available = METRIC_ORDER.filter((m) => (meta?.breaks[m]?.length ?? 0) > 0)
  if (available.length && !available.includes(metric)) metric = available[0]

  const mapEl = document.getElementById('map')
  if (!mapEl) return
  const cost = createMap(mapEl, meta, metric)
  const sheet = new Sheet()
  renderLegend(meta, metric)

  if (!meta) toast('Housing data is still being prepared — check back soon.', 6000)

  // Segmented metric control
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#metric-switch button'))
  for (const btn of buttons) {
    const m = btn.dataset.metric as MetricKey
    if (meta && !available.includes(m)) btn.disabled = true
    btn.addEventListener('click', () => {
      metric = m
      for (const b of buttons) b.setAttribute('aria-selected', String(b === btn))
      cost.setMetric(metric)
      renderLegend(meta, metric)
    })
  }

  // Bottom sheet on tap
  cost.onZipClick((props, lngLat) => {
    cost.setSelected(props.zip)
    sheet.show(props, meta, metric, lngLat)
  })
  cost.onBackgroundClick(() => sheet.hide())
  sheet.onClose(() => cost.setSelected(null))

  // Geolocate: fly to the user's area, fall back to US overview silently.
  const locate = async (announce: boolean) => {
    const pos = await getPosition()
    if (pos) {
      cost.map.flyTo({ center: [pos.lng, pos.lat], zoom: LOCATE_ZOOM, duration: 2200 })
    } else if (announce) {
      toast('Location unavailable — tap anywhere on the map to explore.')
    }
  }
  void locate(false)
  document.getElementById('locate')?.addEventListener('click', () => void locate(true))

  // Layer-2 self-update check (native shell only; throttled; never blocking)
  void initUpdateCheck()

  // PWA service worker
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    try {
      await navigator.serviceWorker.register(`${BASE}sw.js`)
    } catch {
      /* non-fatal */
    }
  }
}

void boot()
