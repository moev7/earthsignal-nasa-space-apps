import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import {
  NISAR_BUNDLES,
  formatPeriod,
  formatVertical,
  rampGradient,
  sourceFromManifest,
  useNisarBundle,
} from '@/features/ground-truth/data/nisar'
import { DataStateNotice } from '@/features/ground-truth/components/ui/DataState'
import { FigureFrame } from '@/features/ground-truth/components/ui/FigureFrame'

/** Where a lon/lat falls on the overlay image, as percentages (the image is Web-Mercator-aligned). */
function imagePosition(bounds: [[number, number], [number, number]], lat: number, lon: number) {
  const [[s, w], [n, e]] = bounds
  const merc = (deg: number) => Math.log(Math.tan(Math.PI / 4 + (deg * Math.PI) / 360))
  return {
    left: `${((lon - w) / (e - w)) * 100}%`,
    top: `${((merc(n) - merc(lat)) / (merc(n) - merc(s))) * 100}%`,
  }
}

/** Reference places drawn on the figure so readers can orient themselves (not data). */
const PLACES: { name: string; lat: number; lon: number; side: 'left' | 'right' }[] = [
  { name: 'Tehran centre', lat: 35.6892, lon: 51.389, side: 'right' },
  { name: 'Mehrabad Airport', lat: 35.6892, lon: 51.3134, side: 'left' },
  { name: 'Eslamshahr', lat: 35.5523, lon: 51.235, side: 'right' },
]

/**
 * The measured NISAR vertical-motion map for south-west Tehran, with its
 * headline numbers. Loads the hash-verified bundle; shows an explicit loading or
 * error state rather than anything that could be mistaken for data.
 */
export function MeasuredSubsidenceFigure() {
  const state = useNisarBundle(NISAR_BUNDLES.tehran)

  if (!state || state.status === 'loading') {
    return <DataStateNotice state="loading" tone="dark" message="Loading the measured NISAR result…" />
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-3">
        <DataStateNotice
          state="error"
          tone="dark"
          message={`The measured NISAR result could not be shown (${state.message}). Nothing is drawn in its place.`}
        />
        <p className="text-[12.5px] leading-relaxed text-white/55">
          A missing layer does not mean the ground in Tehran is stable.
        </p>
      </div>
    )
  }

  const { manifest, imageUrl } = state.data
  const vr = manifest.layers.vertical_rate
  const st = manifest.stats
  const limit = vr.colour.limit_mm_per_year
  const fastest = st.fastest_neighbourhood
  const days =
    (Date.parse(manifest.source.period.end) - Date.parse(manifest.source.period.start)) / 86_400_000
  const months = Math.max(1, Math.round(days / 30.44))

  return (
    <FigureFrame
      title="Measured: how fast the ground moved, June–October 2026"
      caption={`Vertical ground motion from ${manifest.source.granules.length} NISAR radar scenes taken from two directions, ${formatPeriod(manifest)}. Warm colours sink, cool colours rise, relative to the area's median. Transparent pixels were not measured.`}
      source={sourceFromManifest(manifest)}
      tone="dark"
      actions={
        <Link
          href="/explore"
          className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200 transition-colors hover:bg-sky-300/20"
        >
          Explore the map <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="relative bg-[#11151d]">
        <img
          src={imageUrl}
          alt={`Map of measured vertical ground motion across south-west Tehran. A band of fast sinking runs from the west toward the south-west of the city centre, reaching about ${fastest ? Math.abs(Math.round(fastest.vertical_rate)) : 300} mm per year in its fastest area.`}
          className="block w-full [image-rendering:pixelated]"
        />
        {PLACES.map((p) => (
          <span
            key={p.name}
            className="pointer-events-none absolute h-0 w-0"
            style={imagePosition(vr.bounds, p.lat, p.lon)}
          >
            <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full border border-void bg-white" />
            <span
              className={`absolute top-0 -translate-y-1/2 whitespace-nowrap rounded bg-void/75 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/85 ${p.side === 'left' ? 'right-2' : 'left-2'}`}
            >
              {p.name}
            </span>
          </span>
        ))}
        {fastest && (
          <span
            className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90"
            style={imagePosition(vr.bounds, fastest.lat, fastest.lon)}
            aria-hidden
          />
        )}
        <span className="pointer-events-none absolute left-3 top-3 rounded-md border border-sky-300/50 bg-void/80 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-200">
          Measured · NISAR {manifest.source.product_status}
        </span>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div>
          <div className="h-2.5 w-full rounded-sm" style={{ background: rampGradient(manifest) }} />
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-white/55">
            <span>{limit}+ mm/yr down</span>
            <span>0</span>
            <span>{limit}+ mm/yr up</span>
          </div>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
              Fastest 1.2 km area (circled)
            </dt>
            <dd className="mt-1 font-display text-xl font-bold text-white">
              {fastest ? formatVertical(fastest.vertical_rate) : '—'}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
              Sinking faster than 100 mm/yr
            </dt>
            <dd className="mt-1 font-display text-xl font-bold text-white">
              {Math.round(st.area_km2_sinking_faster_than['100'])} km²
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
              Typical uncertainty
            </dt>
            <dd className="mt-1 font-display text-xl font-bold text-white">
              ±{Math.round(st.median_sigma)} mm/yr
            </dd>
          </div>
        </dl>
        <p className="text-[12px] leading-relaxed text-sand">
          {months} months of provisional data, relative to the area’s median, with large per-pixel
          uncertainty: this confirms where the ground is sinking fastest, but it does not replace the
          multi-year rates from the published studies quoted in this story.
        </p>
        <p className="text-[11px] leading-relaxed text-white/40">
          Place markers are for orientation only and are not part of the measurement.
        </p>
      </div>
    </FigureFrame>
  )
}
