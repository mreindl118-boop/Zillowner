import type { MetricKey, ZipProps } from './types'

export interface MetricDef {
  key: MetricKey
  label: string
  legendTitle: string
  /** 6-step single-hue sequential ramp (light → dark), validated with the
   *  dataviz palette validator (monotone L, ΔL ≥ 0.06, single hue). */
  ramp: string[]
  /** property key for YoY percent */
  yoyKey: keyof ZipProps
  /** value suffix in UI */
  perMonth: boolean
}

export const METRICS: Record<MetricKey, MetricDef> = {
  hv: {
    key: 'hv',
    label: 'Home value',
    legendTitle: 'Typical home value',
    ramp: ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    yoyKey: 'hv_yoy',
    perMonth: false,
  },
  mc: {
    key: 'mc',
    label: 'Monthly cost',
    legendTitle: 'Est. monthly cost (20% down)',
    ramp: ['#efb19b', '#e28969', '#d45e2f', '#af4517', '#883008', '#611f02'],
    yoyKey: 'mc_yoy',
    perMonth: true,
  },
  rn: {
    key: 'rn',
    label: 'Rent',
    legendTitle: 'Typical rent',
    ramp: ['#93d2b2', '#53bb8d', '#009f6d', '#007f56', '#006040', '#00432b'],
    yoyKey: 'rn_yoy',
    perMonth: true,
  },
}

export const METRIC_ORDER: MetricKey[] = ['hv', 'mc', 'rn']

export function fmtMoney(v: number | undefined | null, perMonth = false): string {
  if (v == null || !isFinite(v)) return '—'
  let s: string
  if (v >= 1_000_000) s = '$' + (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 2).replace(/\.0+$/, '') + 'M'
  else if (v >= 100_000) s = '$' + Math.round(v / 1000) + 'K'
  else if (v >= 10_000) s = '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  else s = '$' + Math.round(v).toLocaleString('en-US')
  return perMonth ? `${s}/mo` : s
}

export function fmtMoneyFull(v: number | undefined | null, perMonth = false): string {
  if (v == null || !isFinite(v)) return '—'
  const s = '$' + Math.round(v).toLocaleString('en-US')
  return perMonth ? `${s}/mo` : s
}

export function fmtYoy(v: number | undefined | null): string {
  if (v == null || !isFinite(v)) return ''
  const arrow = v > 0.05 ? '▲' : v < -0.05 ? '▼' : '•'
  return `${arrow} ${Math.abs(v).toFixed(1)}% yr`
}

export function fmtMonth(iso: string | undefined): string {
  if (!iso) return ''
  const [y, m] = iso.split('-').map(Number)
  if (!y || !m) return iso
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[m - 1]} ${y}`
}

/** One plain-English takeaway for the bottom sheet. */
export function summaryLine(p: ZipProps): string {
  if (p.mc != null) return `Living here typically runs ~${fmtMoneyFull(p.mc, true)} as an owner.`
  if (p.rn != null) return `Renting here typically runs ~${fmtMoneyFull(p.rn, true)}.`
  if (p.hv != null) return `A typical home here is worth ~${fmtMoneyFull(p.hv)}.`
  return 'No housing data for this area.'
}
