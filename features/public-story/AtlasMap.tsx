'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { CaseCity } from '@/features/ground-truth/data/types';
import { OVERLAYS, rampColor } from '@/features/ground-truth/data/overlays';
import { gridLookup, type LoadedBundle, type BuildingCollection, type BuildingProps } from '@/features/ground-truth/data/nisar';
import type { AtlasLayer, AtlasBasemap } from '@/lib/atlas-view';
import type { GroundProfileView } from '@/lib/ground-profile';

export type AtlasSelection = { title: string; detail: string; building?: BuildingProps; lat?: number; lng?: number; rate?: number | null; sigma?: number | null };
type Props = { city: CaseCity; layer: AtlasLayer; basemap: AtlasBasemap; opacity: number; bundle: LoadedBundle | null; buildings: BuildingCollection | null; renderData: boolean; onSelect: (selection: AtlasSelection) => void; profile?: GroundProfileView | null };
export default function AtlasMap({ city, layer, basemap, opacity, bundle, buildings, renderData, onSelect, profile = null }: Props) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const dataLayer = useRef<Leaflet.LayerGroup | null>(null);
  const tiles = useRef<Leaflet.TileLayer | null>(null);
  const previousCity = useRef('');
  const callbacks = useRef(onSelect);
  useEffect(() => { callbacks.current = onSelect; }, [onSelect]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let ownedMap: Leaflet.Map | null = null;
    let resize: ResizeObserver | null = null;
    void import('leaflet').then(L => {
      if (cancelled || !node.current) return;
      library.current = L;
      ownedMap = L.map(node.current, { scrollWheelZoom: false, preferCanvas: true, zoomControl: true });
      map.current = ownedMap;
      // Disclosure opening, responsive reflow and phone rotation change the
      // host without necessarily resizing the browser window. Re-tile the same
      // map; never leave a stale small tile surface under the new viewport.
      if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(() => { if (!cancelled) ownedMap?.invalidateSize({ animate: false, pan: false }); });
        resize.observe(node.current);
      }
      dataLayer.current = L.layerGroup().addTo(ownedMap);
      setReady(true);
    }).catch(() => { if (!cancelled) setError('The interactive map could not load. The measured map and scene descriptions below remain available.'); });
    return () => { cancelled = true; resize?.disconnect(); ownedMap?.remove(); map.current = null; dataLayer.current = null; };
  }, []);
  useEffect(() => {
    const view = map.current;
    if (!ready || !view) return;
    if (previousCity.current !== city.id) { view.fitBounds(bundle?.manifest.layers.vertical_rate.bounds ?? city.map.bounds, { animate: false, padding: [20,20] }); previousCity.current = city.id; }
  }, [ready, city, bundle]);
  useEffect(() => {
    const view = map.current; const L = library.current;
    if (!ready || !view || !L) return;
    if (basemap === 'none') return;
    const endpoint = basemap === 'satellite' ? 'World_Imagery' : 'Canvas/World_Dark_Gray_Base';
    const attribution = basemap === 'satellite' ? 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community' : 'Basemap © Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors';
    const layer = L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${endpoint}/MapServer/tile/{z}/{y}/{x}`, { attribution, maxNativeZoom: basemap === 'satellite' ? 18 : 16, maxZoom: 19 });
    tiles.current = layer;
    const onTileError = () => setTileError(true);
    const onLoading = () => setTileError(false);
    layer.on('tileerror', onTileError);
    layer.on('loading', onLoading);
    layer.addTo(view);
    // Leaflet's own remove listener detaches map events; keep it until removal.
    return () => {
      view.removeLayer(layer);
      layer.off('tileerror', onTileError);
      layer.off('loading', onLoading);
      if (tiles.current === layer) tiles.current = null;
    };
  }, [ready, basemap]);
  useEffect(()=>{
    const view=map.current,L=library.current;
    if(!ready||!view||!L||!profile)return;
    const group=L.layerGroup().addTo(view);
    const {start,end}=profile.line;
    L.polyline([[start.lat,start.lng],[end.lat,end.lng]],{color:'#f1eee7',weight:2,dashArray:'6 5',interactive:false}).addTo(group);
    for(const [label,point] of [['A',start],['B',end]] as const){
      const text=document.createElement('span');text.textContent=`${label} · selected profile endpoint`;
      L.circleMarker([point.lat,point.lng],{radius:5,color:'#121617',fillColor:'#f1eee7',fillOpacity:1}).bindTooltip(text,{permanent:true,direction:'top'}).addTo(group);
    }
    L.circleMarker([profile.point.lat,profile.point.lng],{radius:7,color:'#f1eee7',fillColor:'#8bcec0',fillOpacity:1,interactive:false}).addTo(group);
    return()=>{view.removeLayer(group);group.clearLayers();};
  },[ready,profile]);
  useEffect(() => {
    const L = library.current; const group = dataLayer.current; const view = map.current;
    if (!ready || !L || !group || !view) return;
    group.clearLayers();
    if (!renderData) return;
    const overlays = OVERLAYS[city.id];
    const text = (value: string) => { const element = document.createElement('span'); element.textContent = value; return element; };
    if (bundle && (layer === 'subsidence' || layer === 'buildings')) {
      L.imageOverlay(bundle.imageUrl, bundle.manifest.layers.vertical_rate.bounds, { opacity: layer === 'buildings' ? opacity * .45 : opacity }).addTo(group);
      if (layer === 'buildings' && buildings) L.geoJSON(buildings, {
        style: feature => { const p = feature?.properties as BuildingProps | undefined; const tilt = p?.ground_tilt_per_year; return { color: tilt === undefined ? '#aeb4ad' : '#f1eee7', weight: .7, fillColor: tilt === undefined ? '#858a88' : '#8bcec0', fillOpacity: .45 }; },
        onEachFeature: (feature, polygon) => { const building = feature.properties as BuildingProps; polygon.bindTooltip(text(`OSM ${building.osm_id} · ground information, not a safety rating`)); polygon.on('click', () => callbacks.current({ title: `Mapped footprint ${building.osm_id}`, detail: 'Measured ground motion beneath a mapped footprint. Building condition is not measured.', building })); },
      }).addTo(group);
    } else if (layer === 'subsidence') overlays.subsidence.forEach(zone => { const ramp = rampColor(zone.intensity); L.circle(zone.center, { radius: zone.radiusM, color: ramp.color, weight: 1.2, fillOpacity: .35 }).bindTooltip(text(`${zone.label} · illustration`)).on('click', () => callbacks.current({title:zone.label, detail:`Illustrative overlay: ${zone.value}. This is a demonstration value, not a measurement.`})).addTo(group); });
    if (layer === 'observations') overlays.passes.forEach(pass => L.polyline(pass.path, { color: '#8bcec0', weight: 3, dashArray: '9 7' }).bindTooltip(text(pass.label)).on('click',()=>callbacks.current({title:pass.label, detail:`${pass.meta}. The pass geometry is illustrative.`})).addTo(group));
    if (layer === 'groundwater') overlays.groundwater.forEach(well => L.circleMarker(well.position, { radius: 8, color:'#8bcec0', fillColor:'#121617', fillOpacity:1 }).bindTooltip(text(well.label)).on('click',()=>callbacks.current({title:well.label,detail:`${well.meta}. This is an illustrative location; no agency well feed is connected.`})).addTo(group));
    if (layer === 'agriculture') overlays.agriculture.forEach(area => L.polygon(area.points, { color:'#f6c667', weight:1.5, fillOpacity:.25 }).bindTooltip(text(area.label)).on('click',()=>callbacks.current({title:area.label,detail:`${area.meta}. This area is demonstration geometry, not a measured land-cover product.`})).addTo(group));
    const probe = (event: Leaflet.LeafletMouseEvent) => { if (!bundle || layer !== 'subsidence') return; const hit = gridLookup(bundle.grid,event.latlng.lat,event.latlng.lng); callbacks.current({title:'Ground-motion cell',detail:'Values sampled from the verified display grid; relative rates, not building movement.',lat:event.latlng.lat,lng:event.latlng.lng,rate:hit?.rate ?? null,sigma:hit?.sigma ?? null}); };
    view.on('click',probe);
    return () => { view.off('click',probe); group.clearLayers(); };
  }, [ready, city, layer, bundle, buildings, opacity, renderData]);
  return <><div className="es-atlas-canvas" ref={node} role="region" aria-label={`Interactive ${city.name} map. ${layer} layer. Pan, zoom and select features.`} />{error && <p role="alert">{error}</p>}{tileError && basemap !== 'none' && <p role="status">Some background tiles could not load. The verified local data overlay remains available. Choose “Data only” to remove the background.</p>}</>;
}
