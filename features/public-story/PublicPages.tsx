'use client'

import { SiteLink as Link } from '@/components/site-link'
import { lazy, Suspense } from 'react'
import { readPublicStudyContext, publicStudyQuery, publicStudyExploreHref } from '@/lib/public-study-context'
const PublicRadarStudy = lazy(() => import('./radar-study/PublicRadarStudy'))
import { useSearchParams } from 'next/navigation'
import { CityScene } from '@/features/ground-truth/components/story/CityScene'
import { InteractiveAtlas } from './InteractiveAtlas'
import { PublicFrame, ActionLink } from './PublicShell'
import { MeasuredMap, MeasuredPeriod } from './MeasuredMap'
import { Sources } from './Sources'
import { CityComparison } from './comparison'

export function PublicExplore() {
  const parameters = useSearchParams()
  const initialCity = parameters.get('city') === 'tokyo' ? 'tokyo' : 'tehran'
  const proof=parameters.get('proof');
  const initialProof=proof==='profile'||proof==='footprint'?proof:undefined;
  const study = readPublicStudyContext(new URLSearchParams(parameters.toString()))
  return <PublicFrame page="explore" playback={!study}>
    <div className={`es-wrap es-secondary-heading${study ? " es-radar-explore-heading" : ""}`}><h1>{study ? 'Lake Mead, in radar.' : 'Look closer at the ground.'}</h1><p className="es-lead">{study ? 'Slide between real NISAR observations near Lake Mead, then inspect what changed in the radar return.' : 'Explore Tehran and Tokyo: satellite context, ground motion, groundwater and the places between them.'}</p>
      <nav className="es-study-navigation" aria-label="Choose a public study"><Link href="/explore" aria-current={!study && initialCity === 'tehran' ? 'page' : undefined}>Tehran · ground motion</Link><Link href="/explore?city=tokyo" aria-current={!study && initialCity === 'tokyo' ? 'page' : undefined}>Tokyo · groundwater</Link><Link href={publicStudyExploreHref()} aria-current={study ? 'page' : undefined}>Lake Mead · radar images</Link></nav>
    </div>
    {study ? <section className="es-wrap es-radar-explore-section"><Suspense fallback={<p role="status">Preparing the radar image viewer…</p>}><PublicRadarStudy key={`${publicStudyQuery(study.selection)}:${proof??'compare'}`} selection={study.selection} initialMode={proof==='difference'?'difference':undefined} /></Suspense></section> : <>
    <section className="es-wrap"><InteractiveAtlas key={`${initialCity}:${initialProof??'map'}`} initialCity={initialCity} initialProof={initialProof} /></section>
    <section className="es-wrap es-explore-scene" aria-labelledby="explore-city-title"><h2 id="explore-city-title">One neighbourhood, seen through ground motion.</h2><p>Watch a 30-year projection, then take the camera or timeline. The footprints are mapped; movement is exaggerated and assumes the measured rates continue. The HUD tracks ground tilt, not building damage.</p><div className="es-scene-block"><CityScene mode="measured" ambient exhibition intro introView="neighbourhood" /></div><MeasuredPeriod /><p className="es-caption">The focus area was selected automatically for a concentration of higher ground-tilt ratings. It is not a representative sample of the whole city. Ground tilt beneath a footprint is not an assessment of that building.</p></section>
    <section className="es-wrap es-secondary-section" aria-labelledby="explore-map-title"><div className="es-section-intro"><h2 id="explore-map-title">Pull back to the plain.</h2><div><p>The warm-coloured area shows a broad sinking pattern in the south-west. Read the region, not an individual pixel: the short record and atmospheric noise limit local conclusions.</p><p>Blue colours near the northern foothills may be atmospheric artefacts. An uncoloured gap means no measurement.</p></div></div><MeasuredMap /></section>
    <section className="es-wrap es-secondary-section"><div className="es-workspace-invitation"><div><h2>Investigating a particular place?</h2><p>Continue in the detailed workspace to work with a location and the available evidence. The public scene cannot establish the condition of an address or building.</p></div><ActionLink href="/workspace" primary>Investigate a place</ActionLink></div></section>
    </>}
    <Sources />
  </PublicFrame>
}

export function PublicCompare() {
  return <PublicFrame page="compare"><CityComparison /><Sources /></PublicFrame>
}

export function PublicAbout() {
  return <PublicFrame page="about">
    <div className="es-wrap es-secondary-heading"><h1>The ground is complex.<br />The explanation should be clear.</h1><p className="es-lead">Earthsignal helps people understand land subsidence: what drives it, how satellites observe it, and where the evidence stops.</p></div>
    <div className="es-wrap es-about-body">
      <section className="es-about-section"><h2>One experience, different kinds of truth.</h2><div><p>The public story brings together a schematic aquifer, an invented city, measured Tehran ground motion and conditional future views. Each is labelled where you see it.</p><p>Measurements describe an observation period. Schematics explain a mechanism. Simulations explore assumptions. A convincing animation does not turn an assumption into a measurement.</p></div></section>
      <section className="es-about-section"><h2>Frozen evidence, with its limits attached.</h2><div><p>The Tehran views load a local, versioned NISAR result bundle. Its manifest records source granules, observation dates, processing, uncertainty, caveats, attribution and file hashes. The visible raster and grid must pass the shared loader’s integrity checks.</p><p>The products are provisional. The record is short, the yearly rates may contain seasonal effects, and the reference is relative to the region’s median. There is no live monitoring or address-level safety diagnosis.</p><p>Mapped footprints come from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors (ODbL 1.0)</a>. Many building heights are estimates. Ground tilt and illustrative damage thresholds do not establish a building’s structural condition.</p><ActionLink href="/explore">See the observations and caveats</ActionLink></div></section>
      <section className="es-about-section"><h2>You control the pace.</h2><div><p>Read by scrolling, jump between chapters through the header contents, or pause and replay the scenes. The aquifer responds to its slider and before/after buttons. Your device’s reduced-motion preference quiets automatic animation.</p><p>The written explanations, data limitations and figure descriptions remain available without playing a scene. The workspace is a separate route for detailed investigation.</p><ActionLink href="/workspace">Open the investigation workspace</ActionLink></div></section>
      <section className="es-about-section"><h2>A purpose, and a boundary.</h2><div><p>This is an educational Earth-observation experience. It is not an official NASA, ISRO or local-authority product. A visible crack needs qualified inspection; a satellite-derived pattern alone cannot explain damage to a particular structure.</p><p>For the wider purpose, start with <Link href="/">the Tehran story</Link>. For the evidence behind it, open the sources below.</p></div></section>
    </div>
    <Sources />
  </PublicFrame>
}
