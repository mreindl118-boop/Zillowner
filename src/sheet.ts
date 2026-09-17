import { fetchAmenities } from './amenities'
import { METRICS, fmtMoney, fmtMoneyFull, fmtMonth, fmtYoy, summaryLine } from './metrics'
import type { AmenityCounts, Meta, MetricKey, ZipProps } from './types'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

function amenitiesHtml(a: AmenityCounts | null | 'loading'): string {
  if (a === 'loading') return `<div id="amenities" class="amenities muted">Checking what’s nearby…</div>`
  if (!a) return `<div id="amenities" class="amenities muted"></div>`
  const item = (emoji: string, label: string, n: number) =>
    `<span class="am"><span class="am-n">${emoji} ${n}</span><span class="am-l">${label}</span></span>`
  return `<div id="amenities" class="amenities">
    ${item('🛒', 'groceries', a.groceries)}
    ${item('🍽️', 'food & drink', a.food)}
    ${item('🌳', 'parks', a.parks)}
    ${item('🏫', 'schools', a.schools)}
    ${item('🚌', 'transit', a.transit)}
  </div>`
}

export class Sheet {
  private el = document.getElementById('sheet') as HTMLElement
  private body = document.getElementById('sheet-body') as HTMLElement
  private closeBtn = document.getElementById('sheet-close') as HTMLElement
  private onCloseCb: (() => void) | null = null
  private currentZip: string | null = null

  constructor() {
    this.closeBtn.addEventListener('click', () => this.hide())
  }

  onClose(cb: () => void): void {
    this.onCloseCb = cb
  }

  hide(): void {
    this.el.hidden = true
    this.currentZip = null
    this.onCloseCb?.()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  show(p: ZipProps, meta: Meta | null, activeMetric: MetricKey, lngLat: { lng: number; lat: number }): void {
    this.currentZip = p.zip
    const place = [p.city, p.st].filter(Boolean).join(', ')
    const title = place ? `${esc(place)}` : 'ZIP area'
    const rows: string[] = []

    const row = (metric: MetricKey, value: number | undefined, yoy: number | undefined, note?: string) => {
      const def = METRICS[metric]
      const active = metric === activeMetric ? ' active' : ''
      rows.push(`<div class="stat${active}">
        <span class="stat-dot" style="background:${def.ramp[3]}"></span>
        <span class="stat-label">${def.legendTitle}${note ? `<span class="stat-note">${note}</span>` : ''}</span>
        <span class="stat-value">${fmtMoneyFull(value, def.perMonth)}</span>
        <span class="stat-yoy">${fmtYoy(yoy)}</span>
      </div>`)
    }

    const mcNote =
      meta?.mc_method === 'computed'
        ? `est. 20% down, 30-yr @ ${meta.mc_rate?.toFixed(2) ?? '—'}% + tax & ins.`
        : '20% down, from Zillow’s payment series'
    row('hv', p.hv, p.hv_yoy)
    row('mc', p.mc, p.mc_yoy, mcNote)
    row('rn', p.rn, p.rn_yoy)

    const month = meta?.months[activeMetric]
    this.body.innerHTML = `
      <div class="sheet-title">${title} <span class="sheet-zip">ZIP ${esc(p.zip)}</span></div>
      <div class="sheet-summary">${esc(summaryLine(p))}</div>
      ${rows.join('')}
      ${amenitiesHtml('loading')}
      <div class="sheet-month muted">${month ? 'Data through ' + fmtMonth(month) : ''}</div>
    `
    this.el.hidden = false

    void fetchAmenities(p.zip, lngLat.lat, lngLat.lng).then((counts) => {
      // Only update if the sheet still shows the same ZIP.
      if (this.currentZip !== p.zip) return
      const target = document.getElementById('amenities')
      if (target) target.outerHTML = amenitiesHtml(counts)
    })
  }
}

/** Compact legend for the active metric. */
export function renderLegend(meta: Meta | null, metric: MetricKey): void {
  const def = METRICS[metric]
  const title = document.getElementById('legend-title')
  const ramp = document.getElementById('legend-ramp')
  const min = document.getElementById('legend-min')
  const max = document.getElementById('legend-max')
  if (!title || !ramp || !min || !max) return
  title.textContent = def.legendTitle
  const breaks = meta?.breaks[metric]
  ramp.innerHTML = def.ramp.map((c) => `<span style="background:${c}"></span>`).join('')
  if (breaks && breaks.length) {
    min.textContent = '< ' + fmtMoney(breaks[0], def.perMonth)
    max.textContent = '> ' + fmtMoney(breaks[breaks.length - 1], def.perMonth)
  } else {
    min.textContent = ''
    max.textContent = 'no data yet'
  }
}
