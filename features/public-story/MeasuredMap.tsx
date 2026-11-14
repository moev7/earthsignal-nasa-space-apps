'use client'

import { useState, useId } from 'react'
import { ArrowUp, RotateCcw } from 'lucide-react'
import { NISAR_BUNDLES, formatPeriod, rampGradient, useNisarBundle } from '@/features/ground-truth/data/nisar'
import type { BundleManifest, LoadedBundle } from '@/features/ground-truth/data/nisar'

export function MeasuredMap() {
  const [attempt, setAttempt] = useState(0)
  return <MeasuredMapResult key={attempt} retry={() => setAttempt((value) => value + 1)} />
}

function MeasuredMapResult({ retry }: { retry: () => void }) {
  const result = useNisarBundle(NISAR_BUNDLES.tehran)
  const titleId = useId()
  if (!result || result.status === 'loading') return <div className="es-data-message" role="status"><p>Checking the Tehran observations…</p><p>The map appears after its data and image pass their integrity checks.</p></div>
  if (result.status === 'error') return <div className="es-data-message" role="alert"><h3>The measured map could not be verified.</h3><p>{result.message}</p><p>No demonstration data has been substituted.</p><button type="button" className="es-action" onClick={retry}><RotateCcw size={16} aria-hidden="true" />Try loading the map again</button></div>
  return <VerifiedRaster bundle={result.data} titleId={titleId} />
}

function VerifiedRaster({ bundle, titleId }: { bundle: LoadedBundle; titleId: string }) {
  const { manifest: m, imageUrl } = bundle
  const [west, south, east, north] = m.bbox_lonlat
  const scale = m.layers.vertical_rate.colour.limit_mm_per_year
  // The source pixels are aligned to Web Mercator, not an unprojected lat/lon rectangle.
  const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
  const aspect = ((east - west) * Math.PI / 180) / (mercator(north) - mercator(south))
  return <figure className="es-measured-map" aria-labelledby={titleId}>
    <div className="es-figure-top"><h3 id={titleId}>Ground movement across the Tehran plain</h3><span className="es-data-label">Measured · {m.source.product_status}</span></div>
    <div className="es-raster-frame">
      <div className="es-map-direction"><ArrowUp size={19} aria-hidden="true" /> North</div>
      {/* Object URL supplied only by the shared hash-verifying bundle loader. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} width="1000" height={Math.round(1000 / aspect)} style={{ aspectRatio: aspect }} alt="Radar-derived vertical ground-motion map of the Tehran plain. A broad warm-coloured sinking area lies to the south-west. Uncoloured gaps have no measurement; apparent motion in the northern foothills may be atmospheric noise." />
      <div className="es-map-coordinates"><span>{west.toFixed(2)}° E</span><span>{east.toFixed(2)}° E</span></div>
    </div>
    <div className="es-map-legend" aria-label={`Vertical movement scale, ${scale} millimetres per year down to ${scale} millimetres per year up`}>
      <div className="es-colour-scale" style={{ background: rampGradient(m) }} />
      <div><span>{scale} mm/year down</span><span>0</span><span>{scale} mm/year up</span></div>
    </div>
    <figcaption><strong>Read the broad pattern.</strong> Warm colours show sinking relative to the area’s median; cool colours show apparent upward movement. Transparent gaps are unmeasured, not stable. The map spans {south.toFixed(2)}–{north.toFixed(2)}° N.</figcaption>
    <MeasurementNotes manifest={m} />
    <details className="es-disclosure"><summary>Map method, coverage &amp; limitations</summary><div className="es-disclosure-body">
      <dl className="es-facts"><div><dt>Measured area</dt><dd>{Math.round(m.stats.measured_fraction * 100)}% of this region</dd></div><div><dt>Radar grid</dt><dd>{m.processing.grid_spacing_m} m pixels</dd></div><div><dt>Processing</dt><dd>{m.producer.software} · {m.producer.algorithm}</dd></div></dl>
      <ul>{m.caveats.map((caveat) => <li key={caveat.id}>{caveat.text}</li>)}</ul>
      <p>{m.attribution.join(' · ')}</p>
      <a href={`/data/nisar/${NISAR_BUNDLES.tehran}/manifest.json`}>Read the original result manifest</a>
    </div></details>
    <p className="es-attribution">NISAR data: NASA/JPL-Caltech and ISRO · ASF DAAC. Map colours are the original result-bundle scale.</p>
  </figure>
}

export function MeasurementNotes({ manifest: m }: { manifest: BundleManifest }) {
  return <div className="es-measurement-notes">
    <p><strong>Observed {formatPeriod(m)}.</strong> {m.source.product_status === 'provisional' ? 'Provisional satellite products; the result may change as calibration improves.' : 'Product status: validated.'}</p>
    <p>A typical {m.processing.grid_spacing_m} m pixel has uncertainty of about <strong>±{Math.round(m.stats.median_sigma)} mm/year</strong> (one standard error). This short record is expressed as a yearly rate and may include seasonal motion. Rates are relative, not an absolute height change.</p>
  </div>
}

export function MeasuredPeriod() {
  const result = useNisarBundle(NISAR_BUNDLES.tehran)
  if (!result || result.status === 'loading') return <p className="es-caption">Measured scene: checking the frozen observation bundle.</p>
  if (result.status === 'error') return <p className="es-caption">Measured observations unavailable: the bundle could not be verified.</p>
  return <p className="es-caption">{formatPeriod(result.data.manifest)} · {result.data.manifest.source.product_status} NISAR L-band observations. Typical pixel uncertainty ±{Math.round(result.data.manifest.stats.median_sigma)} mm/year. Geometry and movement are exaggerated for visibility.</p>
}
