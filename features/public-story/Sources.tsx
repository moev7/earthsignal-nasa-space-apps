import { CITATIONS, EVIDENCE_CATEGORIES, WHY_SINKING, MITIGATION } from '@/features/ground-truth/data/tehranStory'
import { NISAR_BUNDLES } from '@/features/ground-truth/data/nisar'
import { SOURCES } from '@/features/ground-truth/data/satellites'

export const JAPAN_POLICY_SOURCE = 'https://www.env.go.jp/en/water/wq/wemj/ground.html'
export const JICA_GROUNDWATER_SOURCE = 'https://www.jica.go.jp/Resource/english/our_work/thematic_issues/water/fh2q4d000000ruz4-att/theme_07.pdf'
export const USGS_COMPACTION_SOURCE = 'https://www.usgs.gov/centers/land-subsidence-in-california/science/aquifer-compaction-due-groundwater-pumping'

export function Sources() {
  return <section id="sources" className="es-sources es-wrap" aria-labelledby="sources-title" tabIndex={-1}>
    <h2 id="sources-title">A story you can trace.</h2>

    <details className="es-disclosure"><summary>Sources &amp; methods</summary><div className="es-disclosure-body es-source-list"><p>The observations, published research and illustrations have different jobs. Here is where each comes from.</p>
      <div><h3>The measured Tehran views</h3><p>A frozen Earthsignal result bundle from NISAR L-band radar observations. The shared loader checks the manifest schema and provenance, then checks SHA-256 hashes before displaying the raster and value grid. The 3D view separately verifies its neighbourhood file. A checksum checks consistency with the manifest; it is not independent validation of the science.</p><p><a href={`/data/nisar/${NISAR_BUNDLES.tehran}/manifest.json`}>Tehran result manifest, dates, methods, caveats &amp; file hashes</a> · <a href="https://nisar-docs.asf.alaska.edu/products-overview/">ASF DAAC NISAR product guide</a></p></div>
      <div><h3>The cause beneath the surface</h3><p>The aquifer is a schematic of water held in sediment pores and compaction after pressure falls. Its depths, buildings and movement are explanatory geometry, not a borehole record or a measured cross-section.</p><p><a href={USGS_COMPACTION_SOURCE}>USGS: aquifer compaction due to groundwater pumping</a> · <a href={CITATIONS.mahmoudpour2013.url}>Mahmoudpour et al. (2013): groundwater withdrawal and Tehran subsidence</a></p></div>
      <div><h3>Independent research on Tehran</h3><p>Published research provides the longer-term context. Sentinel-1 is a separate mission; its studies are not the source of the NISAR pixels displayed here.</p><p><a href={CITATIONS.moradi2023.url}>Moradi et al. (2023): Sentinel-1A observations of Tehran</a> · <a href={CITATIONS.haghighi2024.url}>Haghshenas Haghighi &amp; Motagh (2024): aquifer depletion and subsidence in Iran</a></p></div>
      <div><h3>The invented city and future scenes</h3><p>The collapse demonstration is an invented city. Its damage and collapse are deliberately illustrative. The Tehran future view extends a short observed ground-motion rate under a constant-rate assumption. Neither predicts a collapse date or the condition of a real building. Building footprints: <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors, ODbL 1.0</a>; many heights are estimates.</p></div>
      <div><h3>What Tokyo teaches</h3><p>The policy comparison uses historical evidence rather than a second satellite curve. It does not imply identical geology, water demand or outcomes in the two cities.</p><p><a href={JAPAN_POLICY_SOURCE}>Japan Ministry of the Environment: history and countermeasures</a> · <a href={JICA_GROUNDWATER_SOURCE}>JICA: Japan’s experience in groundwater management</a></p></div>
    </div></details>
    <details className="es-disclosure"><summary>Full evidence catalogue and response references</summary><div className="es-disclosure-body es-source-list">
      {EVIDENCE_CATEGORIES.map(category=><details key={category.id}><summary>{category.title} · {category.items.length} records</summary><div>{category.items.map(item=><article key={item.label}><h4>{item.label}</h4><p>{item.detail}</p><p className="es-caption">{item.state==='verified'?'Published reference context':item.state==='unavailable'?'Not connected in this experience':item.state}</p></article>)}</div></details>)}
      <details><summary>Evidence connecting extraction and sinking</summary><div>{WHY_SINKING.map(item=><article key={item.claim}><h4>{item.claim}</h4><p>{item.evidence}</p><p>{item.citationIds.map(id=><a key={id} href={CITATIONS[id]?.url}>{CITATIONS[id]?.label??id} </a>)}</p></article>)}</div></details>
      <details><summary>Response and mitigation reference material</summary><div>{MITIGATION.map(item=><article key={item.id}><h4>{item.title}</h4><p>{item.detail}</p></article>)}</div></details>
      <details><summary>All original story references</summary><div>{Object.entries(CITATIONS).map(([id,source])=><p key={id}><a href={source.url}>{source.label}</a> · {source.title}</p>)}</div></details>
      <details><summary>Complete dataset and illustration source records</summary><div>{Object.entries(SOURCES).map(([id,source])=><details key={id}><summary>{source.mission} · {source.provenance}</summary><dl>{Object.entries(source).map(([key,value])=><div key={key}><dt>{key.replace(/([A-Z])/g,' $1')}</dt><dd>{String(value)}</dd></div>)}</dl></details>)}</div></details>
    </div></details>
  </section>
}
