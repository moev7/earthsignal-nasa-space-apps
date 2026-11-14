'use client';
import { Component, lazy, Suspense, useState, useId, type ReactNode } from 'react';
import { SiteLink as Link } from '@/components/site-link';
import { CITIES, TEHRAN, TOKYO } from '@/features/ground-truth/data/cities';
import { OBSERVATION_DATES } from '@/features/ground-truth/data/observations';
import { SOURCES } from '@/features/ground-truth/data/satellites';
import { OVERLAYS } from '@/features/ground-truth/data/overlays';
import { formatPeriod, formatVertical, gridLookup, rampGradient, sourceFromManifest, useNisarBundle, useNisarBuildings, type BuildingProps } from '@/features/ground-truth/data/nisar';
import { atlasEvidence, type AtlasBasemap, type AtlasLayer } from '@/lib/atlas-view';
import type { AtlasSelection } from './AtlasMap';
import type { GroundProfileView } from '@/lib/ground-profile';
import { GroundProfile } from './GroundProfile';
import './atlas.css';
import { directEcho, type EchoTelemetry } from '@/lib/echo-director';
import { useFieldTelemetry } from './quest/GameDirector';
import { FieldPartner } from './discovery/FieldPartner';
const Map = lazy(()=>import('./AtlasMap'));
class AtlasBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="es-atlas-canvas es-atlas-loading" role="status">The interactive map could not load. Read the source records or open the static measured map below. Reload to try again.</div>:this.props.children;}
}
const LAYERS: {id:AtlasLayer;name:string;description:string}[] = [
  {id:'subsidence',name:'Ground motion',description:'Measured Tehran raster, or clearly identified demonstration zones.'},
  {id:'buildings',name:'Mapped buildings',description:'Optional full footprint layer, about 12 MB. Ground information, not building safety.'},
  {id:'observations',name:'Satellite passes',description:'Illustrative viewing tracks; not actual acquisition footprints.'},
  {id:'groundwater',name:'Groundwater',description:'Illustrative well locations and context, without a live monitoring feed.'},
  {id:'agriculture',name:'Land use',description:'Illustrative irrigated and reclaimed areas.'},
];
const LABELS:Record<string,string> = {measured:'Measured · provisional',illustrated:'Illustration · demonstration overlay',loading:'Loading verified observations',processing:'Example: processing gap',unavailable:'No connected data for this view',error:'Data unavailable or could not be verified',verified:'Published reference'};

export function InteractiveAtlas({initialCity='tehran',compact=false,initialProof}:{initialCity?:'tehran'|'tokyo';compact?:boolean;initialProof?:'profile'|'footprint'}) {
  const id = useId();
  const Heading = compact ? 'h3' : 'h2';
  const [cityId,setCityId] = useState(initialCity);
  const [layer,setLayer] = useState<AtlasLayer>(initialProof==='footprint'?'buildings':'subsidence');
  const [basemap,setBasemap] = useState<AtlasBasemap>('satellite');
  const [dateIndex,setDateIndex] = useState(0);
  const [opacity,setOpacity] = useState(.8);
  const [selection,setSelection] = useState<AtlasSelection|null>(null);
  const [query,setQuery] = useState('');
  const [latitude,setLatitude] = useState('35.62');
  const [longitude,setLongitude] = useState('51.33');
  const [osm,setOsm] = useState('');
  const [profileOpen,setProfileOpen] = useState(initialProof==='profile');
  const [profileView,setProfileView] = useState<GroundProfileView|null>(null);
  const city=cityId==='tehran'?TEHRAN:TOKYO;
  const record=OBSERVATION_DATES[cityId][dateIndex] ?? OBSERVATION_DATES[cityId][0];
  const bundleState=useNisarBundle(record.bundle??null);
  const bundle=bundleState?.status==='ready'?bundleState.data:null;
  const buildings=useNisarBuildings(record.bundle??null,bundle,layer==='buildings');
  const collection=buildings?.status==='ready'?buildings.data:null;
  const evidence=atlasEvidence(layer,record.state,bundleState?.status??null);
  const source=layer==='groundwater'?SOURCES.groundwaterDemo:layer==='agriculture'?SOURCES.agricultureDemo:layer==='observations'?SOURCES[cityId==='tehran'?'sentinelDemoTehran':'sentinelDemoTokyo']:bundle?sourceFromManifest(bundle.manifest):record.source;
  const renderData=evidence==='measured'||evidence==='illustrated';
  const chooseCity=(value:'tehran'|'tokyo')=>{setCityId(value);setDateIndex(0);setSelection(null);setProfileOpen(false);setProfileView(null);setLatitude(String(value==='tehran'?35.62:35.68));setLongitude(String(value==='tehran'?51.33:139.8));};
  const telemetry:EchoTelemetry|null=evidence==='measured'&&selection?.building?{kind:'footprint',osmId:selection.building.osm_id,tilt:selection.building.ground_tilt_per_year??null,sigma:selection.building.ground_tilt_sigma_per_year??null}:evidence==='measured'&&selection?.lat!==undefined&&selection.lng!==undefined?{kind:'ground',lat:selection.lat,lng:selection.lng,rate:selection.rate??null,sigma:selection.sigma??null}:null;
  useFieldTelemetry(telemetry);
  const probe=(event:React.FormEvent)=>{event.preventDefault();if(!bundle)return; const lat=Number(latitude),lng=Number(longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return; const hit=gridLookup(bundle.grid,lat,lng);setSelection({title:'Ground-motion cell',detail:'Sampled from the verified display grid, not a building diagnosis.',lat,lng,rate:hit?.rate??null,sigma:hit?.sigma??null});};
  const findBuilding=(event:React.FormEvent)=>{event.preventDefault();const building=collection?.features.find(feature=>String(feature.properties.osm_id)===osm.trim())?.properties;setSelection(building?{title:`Mapped footprint ${building.osm_id}`,detail:'Mapped ground information, not a structural assessment.',building}:{title:'Footprint not found',detail:'This number is not in the bundle. Unmapped does not mean unaffected.'});};
  const zoneChoices=layer==='subsidence'?OVERLAYS[cityId].subsidence.map(z=>({id:z.id,title:z.label,detail:`${z.value} · illustrative value, not a measurement.`})):layer==='observations'?OVERLAYS[cityId].passes.map(z=>({id:z.id,title:z.label,detail:z.meta})):layer==='groundwater'?OVERLAYS[cityId].groundwater.map(z=>({id:z.id,title:z.label,detail:z.meta})):OVERLAYS[cityId].agriculture.map(z=>({id:z.id,title:z.label,detail:z.meta}));
  return <section className={`es-atlas ${compact?'es-atlas-compact':''}`} aria-labelledby={`${id}-title`}>
    <div className="es-atlas-heading"><div><Heading id={`${id}-title`}>{compact?'Explore the ground beneath the city':'Explore Tehran and Tokyo'}</Heading><p>Pan the map, look at the satellite context, then choose what you want to investigate.</p></div><Link href="/compare">Compare the two cities →</Link></div>
    <div className="es-atlas-toolbar">
      <label htmlFor={`${id}-city`}>Place<select id={`${id}-city`} value={cityId} onChange={event=>chooseCity(event.target.value as 'tehran'|'tokyo')}>{CITIES.map(c=><option key={c.id} value={c.id}>{c.name}, {c.country}</option>)}</select></label>
      <label htmlFor={`${id}-layer`}>Show<select id={`${id}-layer`} value={layer} onChange={event=>{setLayer(event.target.value as AtlasLayer);setSelection(null);}}>{LAYERS.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <fieldset><legend>Background</legend>{([['satellite','Satellite'],['streets','Map'],['none','Data only']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={basemap===value} onClick={()=>setBasemap(value)}>{label}</button>)}</fieldset>
    </div>
    <div className="es-atlas-status"><strong>{LABELS[evidence]}</strong><span>{evidence==='measured'&&bundle?formatPeriod(bundle.manifest):`${city.name} · ${source.mission}`}</span></div>
    <AtlasBoundary><Suspense fallback={<div className="es-atlas-canvas es-atlas-loading" role="status">Preparing the map. The source records and written explanations remain available below.</div>}><Map city={city} layer={layer} basemap={basemap} opacity={opacity} bundle={bundle} buildings={collection} renderData={renderData} onSelect={setSelection} profile={profileOpen&&layer==='subsidence'&&evidence==='measured'?profileView:null}/></Suspense></AtlasBoundary>
    {bundle&&(layer==='subsidence'||layer==='buildings')&&<button className="es-action es-atlas-reveal" type="button" aria-pressed={opacity===0} onClick={()=>setOpacity(value=>value===0?.8:0)}>{opacity===0?'Restore the ground-motion overlay':'See the satellite context without the overlay'}</button>}
    <p className="es-atlas-caption">{evidence==='measured'?layer==='buildings'?'Select a footprint to inspect the ground beneath it.':'Click the map to inspect a ground-motion cell.':evidence==='illustrated'?'Select a feature to explore this illustrative layer.':record.note} {basemap==='satellite'?'Esri satellite mosaic: geographic context, not imagery from the selected radar date.':''} Pan to explore; the mouse wheel scrolls the page.</p>
    {bundle&&(layer==='subsidence'||layer==='buildings')&&<div className="es-atlas-legend"><div style={{background:rampGradient(bundle.manifest)}}/><span>{bundle.manifest.layers.vertical_rate.colour.limit_mm_per_year} mm/year down</span><span>0</span><span>{bundle.manifest.layers.vertical_rate.colour.limit_mm_per_year} mm/year up</span><p>Relative movement · typical pixel uncertainty ±{Math.round(bundle.manifest.stats.median_sigma)} mm/year. Transparent gaps are unmeasured.</p></div>}
    {buildings?.status==='loading'&&<p role="status">Loading and verifying the optional footprint file…</p>}
    {buildings?.status==='error'&&<p role="alert">The footprint file failed to load or verify. No substitute footprints are shown.</p>}
    {bundle&&layer==='subsidence'&&evidence==='measured'&&<details className="es-disclosure" open={profileOpen} onToggle={event=>setProfileOpen(event.currentTarget.open)}><summary>How does sinking vary across this area?</summary>{profileOpen&&<GroundProfile bundle={bundle} onViewChange={setProfileView}/>}</details>}
    {selection&&<section className="es-atlas-inspector" aria-label="Selected map information"><div><h4>{selection.title}</h4><button type="button" aria-label="Close map information" onClick={()=>setSelection(null)}>Close</button></div><p>{selection.detail}</p>{selection.lat!==undefined&&<p>{selection.lat.toFixed(4)}° N, {selection.lng?.toFixed(4)}° E · {selection.rate===null?'Not measured here':`${formatVertical(selection.rate??0)}${selection.sigma!==null?` ±${Math.round(selection.sigma??0)} mm/year`:''}`}</p>}{selection.building&&<BuildingInformation building={selection.building}/>}</section>}
    {telemetry&&<FieldPartner found={false} hint="Compare a nearby patch, or draw the ground profile. Gaps remain unknown; tilt beneath an outline is not a structural assessment." reading={directEcho(telemetry)}><></></FieldPartner>}
    <details className="es-disclosure"><summary>Dates, layers and inspection controls</summary><div className="es-disclosure-body es-atlas-more">
      <label htmlFor={`${id}-date`}>Observation record<select id={`${id}-date`} value={dateIndex} onChange={event=>{setDateIndex(Number(event.target.value));setSelection(null);}}>{OBSERVATION_DATES[cityId].map((date,index)=><option key={date.id} value={index}>{date.date} · {date.mission} · {date.state==='measured'?'connected measurement':'demonstration record'}</option>)}</select></label>
      <p>{record.note} {record.state!=='measured'&&'These archive/date entries demonstrate availability states. They are not live retrieval jobs or actual granule records.'}</p>
      <label htmlFor={`${id}-opacity`}>Overlay opacity<input id={`${id}-opacity`} type="range" min="0" max="1" step=".05" value={opacity} onChange={event=>setOpacity(Number(event.target.value))}/></label>
      <label htmlFor={`${id}-search`}>Find a city or region<input id={`${id}-search`} type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Tokyo, Tehran, plain, lowland…"/></label>
      {query&&<div>{CITIES.filter(c=>[c.name,c.country,c.region].join(' ').toLowerCase().includes(query.toLowerCase())).map(c=><button className="es-action" type="button" key={c.id} onClick={()=>chooseCity(c.id)}>{c.name} · {c.region}</button>)}{!CITIES.some(c=>[c.name,c.country,c.region].join(' ').toLowerCase().includes(query.toLowerCase()))&&<p>No matching city in this collection. The advanced workspace accepts other places.</p>}</div>}
      {bundle&&<form onSubmit={probe}><h4>Inspect a measured cell with coordinates</h4><div className="es-atlas-fields"><label htmlFor={`${id}-lat`}>Latitude<input id={`${id}-lat`} type="number" min="-90" max="90" step="any" required value={latitude} onChange={event=>setLatitude(event.target.value)}/></label><label htmlFor={`${id}-lon`}>Longitude<input id={`${id}-lon`} type="number" min="-180" max="180" step="any" required value={longitude} onChange={event=>setLongitude(event.target.value)}/></label><button className="es-action" type="submit">Read ground motion</button></div></form>}
      {layer==='buildings'&&<form onSubmit={findBuilding}><label htmlFor={`${id}-osm`}>OpenStreetMap building number<input id={`${id}-osm`} inputMode="numeric" value={osm} onChange={event=>setOsm(event.target.value)}/></label><button type="submit" className="es-action" disabled={!collection}>Inspect footprint</button></form>}
      {evidence==='illustrated'&&<label htmlFor={`${id}-feature`}>Inspect an illustrative map feature<select id={`${id}-feature`} defaultValue="" onChange={event=>{const item=zoneChoices.find(z=>z.id===event.target.value);if(item)setSelection({title:item.title,detail:`${item.detail} Demonstration geometry, not measured data.`});}}><option value="">Choose a feature</option>{zoneChoices.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    </div></details>
    <details className="es-disclosure"><summary>Source record and measurement details</summary><div className="es-disclosure-body"><dl className="es-facts">{Object.entries(source).map(([key,value])=><div key={key}><dt>{key.replace(/([A-Z])/g,' $1')}</dt><dd>{String(value)}</dd></div>)}</dl>{bundle&&<><h4>Connected bundle statistics</h4><dl className="es-facts"><div><dt>Area measured</dt><dd>{Math.round(bundle.manifest.stats.measured_area_km2)} km² · {Math.round(bundle.manifest.stats.measured_fraction*100)}% of the area</dd></div><div><dt>Faster than 100 mm/year down</dt><dd>{Math.round(bundle.manifest.stats.area_km2_sinking_faster_than['100'])} km² · {Math.round(bundle.manifest.stats.area_km2_sinking_faster_than_2sigma['100'])} km² beyond twice the pixel uncertainty</dd></div></dl><ul>{bundle.manifest.caveats.map(caveat=><li key={caveat.id}>{caveat.text}</li>)}</ul><a href="/data/nisar/tehran-sw-2026/manifest.json" download>Download the bundle manifest</a></>}</div></details>
  </section>;
}

function BuildingInformation({building}:{building:BuildingProps}) {
  return <><dl className="es-facts"><div><dt>Ground-motion rate</dt><dd>{building.vertical_mm_per_year===undefined?'Not measured':`${formatVertical(building.vertical_mm_per_year)} (560 m local mean)`}</dd></div><div><dt>Ground-tilt estimate</dt><dd>{building.ground_tilt_per_year?.toPrecision(3)??'Unresolved'} radians/year</dd></div><div><dt>Ground-tilt uncertainty</dt><dd>{building.ground_tilt_sigma_per_year?.toPrecision(3)??'Not provided'} radians/year</dd></div><div><dt>Tilt direction</dt><dd>{building.tilt_toward_deg??'Unknown'}°</dd></div><div><dt>Height</dt><dd>{building.height_m} m · {building.height_source==='default'?'estimated':`OSM ${building.height_source}`}</dd></div></dl><a href={`https://www.openstreetmap.org/way/${building.osm_id}`} target="_blank" rel="noreferrer">View this OpenStreetMap footprint</a><details><summary>Conditional ground-tilt thresholds</summary><p>If this short-record ground-tilt rate continued, the ground reaches 1 in 500 in {building.years_to_1_in_500??'an unresolved number of'} years and 1 in 150 in {building.years_to_1_in_150??'an unresolved number of'} years. These are mathematical extrapolations of the ground, not predicted damage or collapse dates for this structure.</p></details></>;
}
