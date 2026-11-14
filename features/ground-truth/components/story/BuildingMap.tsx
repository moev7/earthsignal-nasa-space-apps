"use client";
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Polygon as LeafletPolygon } from 'leaflet';
import { NISAR_BUNDLES, useNisarBundle, useNisarBuildings, type BuildingProps } from '@/features/ground-truth/data/nisar';
import './city3d/building-map.css';

/** The regional footprint layer is large: neither it nor Leaflet loads until requested. */
export function BuildingMap() {
  const [requested, setRequested] = useState(false);
  const bundleState = useNisarBundle(NISAR_BUNDLES.tehran);
  const bundle = bundleState?.status === 'ready' ? bundleState.data : null;
  const buildings = useNisarBuildings(NISAR_BUNDLES.tehran, bundle, requested);
  const [selected, setSelected] = useState<BuildingProps | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const polygons = useRef(new Map<string, LeafletPolygon>());
  const collection = buildings?.status === 'ready' ? buildings.data : null;
  useEffect(() => {
    if (!requested || !node.current || !bundle || !collection) return;
    let cancelled = false;
    const footprintLayers = polygons.current;
    void import('leaflet').then(L => {
      if (cancelled || !node.current) return;
      const view = L.map(node.current, { scrollWheelZoom: false, preferCanvas: true, attributionControl: true });
      map.current = view;
      const bounds = bundle.manifest.layers.vertical_rate.bounds;
      view.fitBounds(bounds);
      L.imageOverlay(bundle.imageUrl, bounds, { opacity: .8 }).addTo(view);
      L.geoJSON(collection, {
        style: feature => ({ color: (feature?.properties as BuildingProps | undefined)?.vertical_mm_per_year === undefined ? '#aeb4ad' : '#edf2e9', weight: .6, fillColor: '#d9e7d4', fillOpacity: .28 }),
        onEachFeature: (feature, layer) => {
          const properties = feature.properties as BuildingProps;
          footprintLayers.set(String(properties.osm_id), layer as LeafletPolygon);
          layer.on('click', () => { setSelected(properties); setMessage(''); });
        },
      }).addTo(view);
      view.attributionControl.addAttribution('Footprints © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · NISAR ground motion: Earthsignal / ASF DAAC');
      setMessage(`${collection.features.length.toLocaleString('en-GB')} mapped footprints loaded. Select a footprint or find its OpenStreetMap number.`);
    }).catch(() => { if (!cancelled) setMessage('The interactive map could not load. The verified raster and neighbourhood scene remain available.'); });
    return () => { cancelled = true; map.current?.remove(); map.current = null; footprintLayers.clear(); };
  }, [requested, bundle, collection]);
  const find = (event: React.FormEvent) => {
    event.preventDefault();
    const feature = collection?.features.find(item => String(item.properties.osm_id) === query.trim());
    if (!feature) { setSelected(null); setMessage('That number is not among the mapped footprints in this bundle. Unmapped does not mean unaffected.'); return; }
    setSelected(feature.properties);
    const polygon = polygons.current.get(query.trim());
    if (polygon) map.current?.fitBounds(polygon.getBounds(), { maxZoom: 18, padding: [60, 60], animate: false });
    setMessage('Mapped footprint selected. These measurements describe its ground, not its structure.');
  };
  return <details className="es-disclosure es-regional-buildings"><summary>Inspect mapped footprints across the measured area</summary><div className="es-disclosure-body">
    <p>The full OpenStreetMap layer is optional (about 12 MB). Ground measurements use 80 m pixels and cannot establish the condition of a building.</p>
    {!requested && <button type="button" className="es-action" onClick={() => setRequested(true)}>Load the regional building map</button>}
    {requested && <>
      {buildings?.status === 'loading' && <p role="status">Loading and checking the footprint file…</p>}
      {buildings?.status === 'error' && <p role="alert">The building file could not be verified. No substitute footprints are displayed.</p>}
      <div ref={node} className="es-footprint-map" role="region" aria-label="Regional map of measured ground motion and mapped building footprints" />
      <p>Drag to pan; use the map’s zoom buttons. Wheel scrolling continues the page. Warm raster colours indicate sinking; gaps are unmeasured. Footprints show mapping coverage, not a safety rating.</p>
      <form onSubmit={find}><label htmlFor="osm-building-number">OpenStreetMap building number</label><div><input id="osm-building-number" inputMode="numeric" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit" className="es-action" disabled={!collection}>Find footprint</button></div></form>
      <p role="status">{message}</p>
      {selected && <dl className="es-facts"><div><dt>Mapped footprint</dt><dd>OSM {selected.osm_id}</dd></div><div><dt>Ground-motion rate</dt><dd>{selected.vertical_mm_per_year === undefined ? 'Not measured' : `${Math.abs(Math.round(selected.vertical_mm_per_year))} mm/year ${selected.vertical_mm_per_year < 0 ? 'down' : 'up'}`}</dd></div><div><dt>Ground-tilt estimate</dt><dd>{selected.ground_tilt_per_year?.toPrecision(3) ?? 'Not resolved'} radians/year</dd></div><div><dt>Ground-tilt uncertainty</dt><dd>{selected.ground_tilt_sigma_per_year?.toPrecision(3) ?? 'Not provided'} radians/year</dd></div></dl>}
    </>}
  </div></details>;
}
