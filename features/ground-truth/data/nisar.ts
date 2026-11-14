/**
 * MEASURED NISAR result bundles produced by the earthsignal backend.
 *
 * A bundle is a frozen directory under `public/data/nisar/<id>/`:
 *   manifest.json       provenance, method, caveats, colour scale, statistics, file hashes
 *   vertical_rate.png   vertical ground-motion rate, Web-Mercator-aligned (transparent = not measured)
 *   vertical_grid.json  400 m grid of rate and uncertainty for read-outs
 *   buildings.geojson   OpenStreetMap footprints rated by the ground tilt beneath them
 *
 * Honesty rules enforced here:
 *  - A bundle is only shown if its schema, provenance and every file hash check out.
 *    Anything else becomes an explicit `error` state, never a silent fallback to demo data.
 *  - Caveats from the manifest travel with every rendering of the data.
 *  - Missing values stay missing (`null`), they are never read as zero.
 */
import { useEffect, useState } from 'react'
import type { FeatureCollection, Polygon } from 'geojson'

import type { DataSource } from './types'

export const BUNDLE_SCHEMA = 'earthsignal.result-bundle/1'

/** Bundles shipped with the site, by city. */
export const NISAR_BUNDLES = { tehran: 'tehran-sw-2026' } as const
export type BundleId = (typeof NISAR_BUNDLES)[keyof typeof NISAR_BUNDLES]

export interface BundleStack {
  direction: 'A' | 'D'
  track: number
  frame: number
  pairs: number
  first: string
  last: string
  troposphere_applied: boolean
  measured_fraction: number
}

export interface BundleCaveat {
  id: string
  text: string
  /** `method` caveats come from the pipeline; `analyst` notes are specific to this study area. */
  source: 'method' | 'analyst'
}

export interface BundleStats {
  measured_fraction: number
  measured_area_km2: number
  vertical_rate_p1: number
  vertical_rate_median: number
  vertical_rate_p99: number
  median_sigma: number
  area_km2_sinking_faster_than: Record<'50' | '100' | '200', number>
  area_km2_sinking_faster_than_2sigma: Record<'50' | '100' | '200', number>
  fastest_neighbourhood?: { lon: number; lat: number; vertical_rate: number; size_m: number }
}

export type BuildingCategory = 'high' | 'elevated' | 'low' | 'not_enough_evidence' | 'not_measured'

export interface BundleManifest {
  schema: string
  id: string
  title: string
  generated_at: string
  provenance: 'measured'
  producer: { software: string; algorithm: string; code_version: string | null }
  source: {
    mission: string
    sensor: string
    product: string
    provider: string
    collections_searched: string[]
    product_status: 'provisional' | 'validated'
    period: { start: string; end: string }
    stacks: BundleStack[]
    granules: string[]
  }
  processing: {
    min_coherence: number
    rate: string
    vertical: string
    reference: string
    grid_crs: string
    grid_spacing_m: number
  }
  bbox_lonlat: [number, number, number, number]
  layers: {
    vertical_rate: {
      file: string
      units: string
      positive: 'up'
      bounds: [[number, number], [number, number]]
      colour: { limit_mm_per_year: number; alpha: number; stops: { value: number; colour: string }[] }
    }
  }
  values: { file: string; cell_m: number; method: string; sigma: string }
  buildings: null | {
    file: string
    count: number
    categories: Partial<Record<BuildingCategory, number>>
    osm_snapshot: string | null
    heights: Record<'height' | 'levels' | 'default', number>
    category_rule: Record<BuildingCategory, string>
    attribution: string
    licence: string
  }
  /** One neighbourhood at full 80 m resolution, for the 3D city view. */
  focus?: null | {
    file: string
    centre_lonlat: [number, number]
    size_m: number
    selection: string
    buildings: number
    categories: Partial<Record<BuildingCategory, number>>
  }
  stats: BundleStats
  /** Date-by-date cumulative vertical displacement (added by service.ground_motion_timeseries). */
  timeseries?: {
    file: string
    frames: string[]
    dates: string[]
    units: 'mm'
    positive: 'up'
    colour: { limit_mm: number; stops: { value: number; colour: string }[] }
    method: string
    bridging: string
    days: number
    fastest_1pct_mm: number | null
  }
  caveats: BundleCaveat[]
  attribution: string[]
  files: Record<string, { bytes: number; sha256: string }>
}

export interface ValueGrid {
  west: number
  north: number
  dlon: number
  dlat: number
  cols: number
  rows: number
  vertical_rate: (number | null)[]
  vertical_sigma: (number | null)[]
}

export interface BuildingProps {
  osm_id: number
  category: BuildingCategory
  vertical_mm_per_year?: number
  ground_tilt_per_year?: number
  ground_tilt_sigma_per_year?: number
  tilt_toward_deg?: number
  years_to_1_in_500?: number
  years_to_1_in_300?: number
  years_to_1_in_250?: number
  years_to_1_in_150?: number
  height_m: number
  height_source: 'height' | 'levels' | 'default'
}

export type BuildingCollection = FeatureCollection<Polygon, BuildingProps>

/** A building in the focus area, with its footprint in metres east/north of the area's centre. */
export interface FocusBuilding extends Omit<BuildingProps, 'osm_id'> {
  osm_id: number | null
  ring: [number, number][]
}

export interface FocusArea {
  centre_lonlat: [number, number]
  size_m: number
  coordinates: string
  spacing_m: number
  selection: string
  grid: {
    /** Pixel-centre offsets in metres; `north` runs from north to south. */
    east: number[]
    north: number[]
    vertical_rate: (number | null)[][]
    vertical_sigma: (number | null)[][]
  }
  buildings: FocusBuilding[]
  categories: Partial<Record<BuildingCategory, number>>
  /** OpenStreetMap streets ('road:<class>'), green areas and water, in the same local metres. */
  context?: { kind: string; line: [number, number][] }[]
}

export interface LoadedBundle {
  manifest: BundleManifest
  grid: ValueGrid
  /** Object URL of the hash-verified overlay image. */
  imageUrl: string
}

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

/* ------------------------------------------------------------------ */
/*  Loading with integrity checks                                      */
/* ------------------------------------------------------------------ */

export function bundleFileUrl(id: BundleId, file: string) {
  return `/data/nisar/${id}/${file}`
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function fetchVerified(id: BundleId, manifest: BundleManifest, file: string) {
  const expected = manifest.files[file]
  if (!expected) throw new Error(`${file} is not listed in the manifest`)
  const res = await fetch(bundleFileUrl(id, file))
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  if ((await sha256Hex(buffer)) !== expected.sha256) {
    throw new Error(`${file} does not match its manifest checksum`)
  }
  return buffer
}

function checkManifest(m: Partial<BundleManifest>): asserts m is BundleManifest {
  if (m.schema !== BUNDLE_SCHEMA) throw new Error(`Unsupported bundle schema ${String(m.schema)}`)
  if (m.provenance !== 'measured') throw new Error('Bundle provenance is not "measured"')
  if (!m.source?.granules?.length) throw new Error('Bundle lists no source granules')
  if (!m.caveats?.length) throw new Error('Bundle carries no caveats')
}

const bundleCache = new Map<BundleId, Promise<LoadedBundle>>()
const buildingsCache = new Map<BundleId, Promise<BuildingCollection>>()
const focusCache = new Map<BundleId, Promise<FocusArea>>()

export function loadFocus(id: BundleId, manifest: BundleManifest): Promise<FocusArea> {
  let p = focusCache.get(id)
  if (!p) {
    p = (async () => {
      if (!manifest.focus) throw new Error('This bundle has no focus area')
      const buf = await fetchVerified(id, manifest, manifest.focus.file)
      return JSON.parse(new TextDecoder().decode(buf)) as FocusArea
    })()
    p.catch(() => focusCache.delete(id))
    focusCache.set(id, p)
  }
  return p
}

export function loadBundle(id: BundleId): Promise<LoadedBundle> {
  let p = bundleCache.get(id)
  if (!p) {
    p = (async () => {
      // Revalidate: the manifest is tiny and every other file is hash-checked against it.
      const res = await fetch(bundleFileUrl(id, 'manifest.json'), { cache: 'no-cache' })
      if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`)
      const manifest = (await res.json()) as Partial<BundleManifest>
      checkManifest(manifest)
      const [gridBuf, imageBuf] = await Promise.all([
        fetchVerified(id, manifest, manifest.values.file),
        fetchVerified(id, manifest, manifest.layers.vertical_rate.file),
      ])
      const grid = JSON.parse(new TextDecoder().decode(gridBuf)) as ValueGrid
      const imageUrl = URL.createObjectURL(new Blob([imageBuf], { type: 'image/png' }))
      return { manifest, grid, imageUrl }
    })()
    p.catch(() => bundleCache.delete(id))
    bundleCache.set(id, p)
  }
  return p
}

export function loadBuildings(id: BundleId, manifest: BundleManifest): Promise<BuildingCollection> {
  let p = buildingsCache.get(id)
  if (!p) {
    p = (async () => {
      if (!manifest.buildings) throw new Error('This bundle has no building layer')
      const buf = await fetchVerified(id, manifest, manifest.buildings.file)
      return JSON.parse(new TextDecoder().decode(buf)) as BuildingCollection
    })()
    p.catch(() => buildingsCache.delete(id))
    buildingsCache.set(id, p)
  }
  return p
}

type Keyed<T> = { key: string; value: Loadable<T> }

function settle<T>(key: string, promise: Promise<T>, set: (r: Keyed<T>) => void) {
  let live = true
  promise.then(
    (data) => live && set({ key, value: { status: 'ready', data } }),
    (err: unknown) =>
      live && set({ key, value: { status: 'error', message: err instanceof Error ? err.message : String(err) } }),
  )
  return () => {
    live = false
  }
}

/** Load (once) and verify a bundle's manifest, value grid and overlay image. `null` id = nothing to load. */
export function useNisarBundle(id: BundleId | null): Loadable<LoadedBundle> | null {
  const [result, setResult] = useState<Keyed<LoadedBundle> | null>(null)
  useEffect(() => (id ? settle(id, loadBundle(id), setResult) : undefined), [id])
  if (!id) return null
  return result?.key === id ? result.value : { status: 'loading' }
}

/** Cumulative vertical displacement per acquisition date (`timeseries.json`) plus the verified frame images. */
export interface TimeSeries {
  dates: string[]
  grid: Pick<ValueGrid, 'west' | 'north' | 'dlon' | 'dlat' | 'cols' | 'rows'>
  /** One row-major grid per date, millimetres, positive up; null = not measured. */
  vertical_mm: (number | null)[][]
}

export interface LoadedTimeSeries {
  bundle: LoadedBundle
  series: TimeSeries
  /** Object URLs of the hash-verified frames, one per date. */
  frames: string[]
  meta: NonNullable<BundleManifest['timeseries']>
}

const seriesCache = new Map<BundleId, Promise<LoadedTimeSeries>>()

export function loadTimeSeries(id: BundleId): Promise<LoadedTimeSeries> {
  let p = seriesCache.get(id)
  if (!p) {
    p = (async () => {
      const bundle = await loadBundle(id)
      const meta = bundle.manifest.timeseries
      if (!meta) throw new Error('This bundle has no date-by-date series')
      const [seriesBuf, ...frameBufs] = await Promise.all([
        fetchVerified(id, bundle.manifest, meta.file),
        ...meta.frames.map((file) => fetchVerified(id, bundle.manifest, file)),
      ])
      const series = JSON.parse(new TextDecoder().decode(seriesBuf)) as TimeSeries
      if (series.dates.length !== meta.frames.length || series.vertical_mm.length !== series.dates.length)
        throw new Error('The series and its frames do not line up')
      const frames = frameBufs.map((buf) => URL.createObjectURL(new Blob([buf], { type: 'image/png' })))
      return { bundle, series, frames, meta }
    })()
    p.catch(() => seriesCache.delete(id))
    seriesCache.set(id, p)
  }
  return p
}

export function useNisarTimeSeries(id: BundleId | null): Loadable<LoadedTimeSeries> | null {
  const [result, setResult] = useState<Keyed<LoadedTimeSeries> | null>(null)
  useEffect(() => (id ? settle(id, loadTimeSeries(id), setResult) : undefined), [id])
  if (!id) return null
  return result?.key === id ? result.value : { status: 'loading' }
}

/** Cumulative millimetres at a point for every date (null where not measured). */
export function seriesAt(series: TimeSeries, lat: number, lng: number): (number | null)[] | null {
  const g = series.grid
  const i = Math.floor((lng - g.west) / g.dlon)
  const j = Math.floor((g.north - lat) / g.dlat)
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return null
  return series.vertical_mm.map((grid) => grid[j * g.cols + i] ?? null)
}

/** Load the bundle together with its verified focus area (for the 3D view). */
export function useNisarFocus(id: BundleId | null): Loadable<{ bundle: LoadedBundle; focus: FocusArea }> | null {
  const [result, setResult] = useState<Keyed<{ bundle: LoadedBundle; focus: FocusArea }> | null>(null)
  useEffect(
    () =>
      id
        ? settle(
            id,
            loadBundle(id).then(async (bundle) => ({ bundle, focus: await loadFocus(id, bundle.manifest) })),
            setResult,
          )
        : undefined,
    [id],
  )
  if (!id) return null
  return result?.key === id ? result.value : { status: 'loading' }
}

/** Load the (large) building layer only when it is actually needed. */
export function useNisarBuildings(
  id: BundleId | null,
  bundle: LoadedBundle | null,
  enabled: boolean,
): Loadable<BuildingCollection> | null {
  const [result, setResult] = useState<Keyed<BuildingCollection> | null>(null)
  const active = Boolean(id && bundle && enabled)
  useEffect(
    () => (id && bundle && enabled ? settle(id, loadBuildings(id, bundle.manifest), setResult) : undefined),
    [id, bundle, enabled],
  )
  if (!active || !id) return null
  return result?.key === id ? result.value : { status: 'loading' }
}

/* ------------------------------------------------------------------ */
/*  Read-outs and presentation helpers                                 */
/* ------------------------------------------------------------------ */

/** Value-grid cell containing a point, or null outside the grid or where nothing was measured. */
export function gridLookup(grid: ValueGrid, lat: number, lng: number) {
  const i = Math.floor((lng - grid.west) / grid.dlon)
  const j = Math.floor((grid.north - lat) / grid.dlat)
  if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return null
  const rate = grid.vertical_rate[j * grid.cols + i]
  if (rate === null || rate === undefined) return { rate: null, sigma: null }
  return { rate, sigma: grid.vertical_sigma[j * grid.cols + i] ?? null }
}

/** "128 mm/yr down" / "12 mm/yr up" — sign is spelled out so it cannot be misread. */
export function formatVertical(mmPerYear: number) {
  const v = Math.round(mmPerYear)
  if (v === 0) return '0 mm/yr'
  return `${Math.abs(v)} mm/yr ${v < 0 ? 'down' : 'up'}`
}

export function formatPeriod(m: BundleManifest) {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  return `${fmt(m.source.period.start)} – ${fmt(m.source.period.end)}`
}

/** CSS gradient matching the overlay's colour ramp exactly (from the manifest). */
export function rampGradient(m: BundleManifest) {
  const { stops, limit_mm_per_year: limit } = m.layers.vertical_rate.colour
  const parts = stops.map((s) => `${s.colour} ${((s.value + limit) / (2 * limit)) * 100}%`)
  return `linear-gradient(to right, ${parts.join(', ')})`
}

export const BUILDING_CATEGORY_STYLE: Record<BuildingCategory, { label: string; colour: string; short: string }> = {
  high: { label: 'High', colour: '#ff3d6e', short: 'Ground tilt reaches 1 in 500 within 10 years' },
  elevated: { label: 'Elevated', colour: '#ffb020', short: '1 in 500 within 10–30 years' },
  low: { label: 'Low', colour: '#5fb7ff', short: 'Measurable tilt, slower than 30 years to 1 in 500' },
  not_enough_evidence: { label: 'Not enough evidence', colour: '#8a94a6', short: 'Tilt smaller than twice its uncertainty' },
  not_measured: { label: 'Not measured', colour: '#4b5363', short: 'No radar measurement beneath it' },
}

export const BUILDING_CATEGORY_ORDER: BuildingCategory[] = [
  'high',
  'elevated',
  'low',
  'not_enough_evidence',
  'not_measured',
]

/** The manifest, restated as the site's standard data-source record. */
export function sourceFromManifest(m: BundleManifest): DataSource {
  const pairs = m.source.stacks.reduce((n, s) => n + s.pairs, 0)
  const directions = new Set(m.source.stacks.map((s) => (s.direction === 'A' ? 'ascending' : 'descending')))
  return {
    mission: m.source.mission,
    sensor: m.source.sensor,
    provider: `${m.source.provider} · product status: ${m.source.product_status.toUpperCase()}`,
    acquisitionDate: `${m.source.period.start} to ${m.source.period.end} (${m.source.granules.length} granules)`,
    processing: `${m.source.product}: ${pairs} interferograms in ${m.source.stacks.length} frame stacks (${[...directions].join(' + ')}). Rate = ${m.processing.rate}. Vertical = ${m.processing.vertical}. Zero = ${m.processing.reference}. Processed by ${m.producer.software} (${m.producer.algorithm}${m.producer.code_version ? `, ${m.producer.code_version}` : ''}).`,
    resolution: `${m.processing.grid_spacing_m} m grid (${m.processing.grid_crs}); read-outs use ${m.values.cell_m} m cells`,
    limitations: m.caveats.map((c) => c.text).join(' '),
    confidence: `Typical uncertainty ±${Math.round(m.stats.median_sigma)} mm/yr per pixel (one standard error). ${Math.round(m.stats.measured_fraction * 100)}% of the area measured.`,
    state: 'measured',
    provenance: 'measured',
    attribution: m.attribution.join(' · '),
  }
}
