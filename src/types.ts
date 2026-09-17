export type MetricKey = 'hv' | 'mc' | 'rn'

export interface Meta {
  generated: string
  version: number
  months: Partial<Record<MetricKey, string>>
  breaks: Partial<Record<MetricKey, number[]>>
  counts?: Partial<Record<MetricKey, number>>
  /** 'zillow' = Zillow's payment series; 'computed' = estimated from ZHVI */
  mc_method?: 'zillow' | 'computed' | null
  /** 30-yr rate (percent) used when mc_method is 'computed' */
  mc_rate?: number | null
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
