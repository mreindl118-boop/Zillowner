import { Map as MapLibreMap, addProtocol, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { BASE, DATA_PMTILES, US_CENTER, US_ZOOM } from './config'
import { METRICS } from './metrics'
import type { Meta, MetricKey, ZipProps } from './types'

export const NO_DATA_COLOR = 'rgba(0,0,0,0)'

export function fillColorExpression(metric: MetricKey, meta: Meta): unknown {
  const breaks = meta.breaks[metric]
  const ramp = METRICS[metric].ramp
  if (!breaks || breaks.length !== ramp.length - 1) return NO_DATA_COLOR
  const step: unknown[] = ['step', ['get', metric], ramp[0]]
  breaks.forEach((b, i) => step.push(b, ramp[i + 1]))
  return ['case', ['has', metric], step, NO_DATA_COLOR]
}

export interface CostMap {
  map: MapLibreMap
  setMetric(metric: MetricKey): void
  setSelected(zip: string | null): void
  onZipClick(cb: (props: ZipProps, lngLat: { lng: number; lat: number }) => void): void
  onBackgroundClick(cb: () => void): void
}

export function createMap(container: HTMLElement, meta: Meta | null, initialMetric: MetricKey): CostMap {
  // MapLibre v6 resolves its worker module relative to the bundle URL,
  // which breaks once bundled — point it at the copy shipped by the build.
  setWorkerUrl(`${BASE}maplibre-gl-worker.mjs`)

  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)

  const pmtilesUrl = new URL(DATA_PMTILES, location.href).toString()

  const map = new MapLibreMap({
    container,
    center: US_CENTER,
    zoom: US_ZOOM,
    minZoom: 3,
    maxZoom: 15,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution:
            'Housing data © <a href="https://www.zillow.com/research/data/">Zillow Research</a> · Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
        zips: {
          type: 'vector',
          url: `pmtiles://${pmtilesUrl}`,
        },
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm',
          paint: {
            // Desaturated basemap so the choropleth carries the color story.
            'raster-saturation': -0.9,
            'raster-contrast': -0.05,
          },
        },
        {
          id: 'zips-fill',
          type: 'fill',
          source: 'zips',
          'source-layer': 'zips',
          paint: {
            'fill-color': (meta ? fillColorExpression(initialMetric, meta) : NO_DATA_COLOR) as never,
            'fill-opacity': 0.62,
          },
        },
        {
          id: 'zips-line',
          type: 'line',
          source: 'zips',
          'source-layer': 'zips',
          paint: {
            'line-color': 'rgba(255,255,255,0.55)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.7, 12, 1.4] as never,
          },
        },
        {
          id: 'zips-selected',
          type: 'line',
          source: 'zips',
          'source-layer': 'zips',
          filter: ['==', ['get', 'zip'], '___none___'],
          paint: {
            'line-color': '#0b0b0b',
            'line-width': 2.5,
          },
        },
      ],
    },
  })

  map.on('error', (e) => console.error('costLAB map error:', e.error?.message ?? e))

  let clickCb: ((props: ZipProps, lngLat: { lng: number; lat: number }) => void) | null = null
  let bgCb: (() => void) | null = null

  map.on('click', (e: MapMouseEvent) => {
    const feats = map.queryRenderedFeatures(e.point, { layers: ['zips-fill'] })
    if (feats.length && clickCb) {
      clickCb(feats[0].properties as unknown as ZipProps, e.lngLat)
    } else if (bgCb) {
      bgCb()
    }
  })

  map.on('mouseenter', 'zips-fill', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'zips-fill', () => (map.getCanvas().style.cursor = ''))

  let currentMeta = meta

  return {
    map,
    setMetric(metric: MetricKey) {
      if (!currentMeta) return
      map.setPaintProperty('zips-fill', 'fill-color', fillColorExpression(metric, currentMeta) as never)
    },
    setSelected(zip: string | null) {
      map.setFilter('zips-selected', ['==', ['get', 'zip'], zip ?? '___none___'] as never)
    },
    onZipClick(cb) {
      clickCb = cb
    },
    onBackgroundClick(cb) {
      bgCb = cb
    },
  }
}
