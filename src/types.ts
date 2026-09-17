export type MetricKey = 'hv' | 'mc' | 'rn'

export interface Meta {
  generated: string
  version: number
  months: Partial<Record<MetricKey, string>>
  breaks: Partial<Record<MetricKey, number[]>>
  counts?: Partial<Record<MetricKey, number>>
}

/** Feature properties baked into the pmtiles layer (kept short for tile size). */
export interface ZipProps {
  zip: string
  city?: string
  st?: string
  hv?: number
  hv_yoy?: number
  mc?: number
  mc_yoy?: number
  rn?: number
  rn_yoy?: number
}

export interface AmenityCounts {
  groceries: number
  food: number
  parks: number
  schools: number
  transit: number
}
