"use client";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Layers2, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Scene } from "./domain";
export type RasterOverlay = {
  url: string;
  bounds: [[number, number], [number, number]];
  label?: string;
  ariaLabel?: string;
  legend?: React.ReactNode;
};
export function GeoMap({
  scenes = [],
  selectedId,
  onSelect,
  raster,
  color = "#b3f84c",
  focusBounds,
  viewKey,
  onViewportChange,
  maxFitZoom,
  point,
  polygon,
  transect,
  drawingMode,
  onMapClick,
  selectionGeometry,
  areaLabel,
}: {
  scenes?: Scene[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  raster?: RasterOverlay;
  color?: string;
  focusBounds?: [[number, number], [number, number]];
  viewKey?: string;
  maxFitZoom?: number;
  onViewportChange?: (bbox: [number, number, number, number]) => void;
  point?: [number, number] | null;
  polygon?: [number, number][];
  transect?: [[number, number], [number, number]] | null;
  drawingMode?: "point" | "polygon" | "transect" | null;
  onMapClick?: (coord: [number, number]) => void;
  selectionGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  areaLabel?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const drawingLayer = useRef<Leaflet.LayerGroup | null>(null);
  const fit = useRef<(() => void) | null>(null);
  const lastViewKey = useRef("");
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState(false);
  const selectCallback = useRef(onSelect);
  const viewportCallback = useRef(onViewportChange);
  const mapClickCallback = useRef(onMapClick);
  useEffect(() => { selectCallback.current = onSelect; }, [onSelect]);
  useEffect(() => { viewportCallback.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { mapClickCallback.current = onMapClick; }, [onMapClick]);
  useEffect(() => {
    let canceled = false;
    import("leaflet")
      .then((L) => {
        if (canceled || !element.current) return;
        lib.current = L;
        const instance = L.map(element.current, {
          scrollWheelZoom: false,
          zoomControl: false,
        }).setView([38, -121], 7);
        map.current = instance;
        L.control.zoom({ position: "bottomright" }).addTo(instance);
        const tiles = L.tileLayer(
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 18,
            className: "basemap-tiles",
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        ).addTo(instance);
        tiles.on("tileerror", () => setError(true));
        const observer = new ResizeObserver(() => instance.invalidateSize());
        observer.observe(element.current);
        instance.on("unload", () => observer.disconnect());
        instance.on("moveend", () => {
          if (viewportCallback.current) {
            const b = instance.getBounds();
            viewportCallback.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }
        });
        instance.on("click", (e) => {
          if (mapClickCallback.current) {
            mapClickCallback.current([e.latlng.lng, e.latlng.lat]);
          }
        });
        setReady(true);
      })
      .catch(() => setError(true));
    return () => {
      canceled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current || !lib.current) return;
    const L = lib.current;
    const instance = map.current;
    layer.current?.remove();
    const group = L.layerGroup().addTo(instance);
    layer.current = group;
    const selected = scenes.find((s) => s.id === selectedId);
    const focus = selected ? [selected] : scenes;
    let bounds = L.latLngBounds([]);
    focus.forEach((s) =>
      bounds.extend(
        L.geoJSON({
          type: "Feature",
          properties: {},
          geometry: s.geometry,
        } as GeoJSON.Feature).getBounds(),
      ),
    );
    if (raster) bounds.extend(raster.bounds);
    if (focusBounds) {
      bounds = L.latLngBounds(focusBounds);
    }
    fit.current = () => {
      if (bounds.isValid())
        instance.fitBounds(bounds, {
          padding: [28, 28],
          maxZoom: maxFitZoom ?? (raster ? 11 : 9),
          animate: false,
        });
    };
    const nextViewKey = viewKey ?? `${selectedId ?? ""}|${JSON.stringify(focusBounds ?? null)}`;
    if (lastViewKey.current !== nextViewKey) {
      fit.current();
      lastViewKey.current = nextViewKey;
    }
    if (visible) {
      scenes.forEach((scene) => {
        const geo = L.geoJSON(
          {
            type: "Feature",
            properties: {},
            geometry: scene.geometry,
          } as GeoJSON.Feature,
          {
            style: {
              color,
              weight: scene.id === selectedId ? 2 : 1,
              fillOpacity: scene.id === selectedId ? 0.18 : 0.035,
            },
          },
        );
        const label = document.createElement("span");
        label.textContent = `${scene.platform} · ${scene.product} · ${scene.startTime.slice(0, 10)}`;
        geo.bindTooltip(label);
        geo.on("click", () => selectCallback.current?.(scene.id));
        geo.addTo(group);
      });
      if (raster) {
        const image = L.imageOverlay(raster.url, raster.bounds, {
          opacity: 0.85,
          interactive: false,
        }).addTo(group);
        image.on("error", () => setError(true));
      }
    }
  }, [scenes, selectedId, raster, ready, visible, color, focusBounds, viewKey, maxFitZoom]);

  useEffect(() => {
    if (!ready || !map.current || !lib.current) return;
    const L = lib.current;
    const instance = map.current;
    if (drawingMode) {
      instance.doubleClickZoom.disable();
      element.current?.classList.add("drawing-mode");
    } else {
      instance.doubleClickZoom.enable();
      element.current?.classList.remove("drawing-mode");
    }

    drawingLayer.current?.remove();
    const group = L.layerGroup().addTo(instance);
    drawingLayer.current = group;

    if (selectionGeometry) L.geoJSON({ type: "Feature", properties: {}, geometry: selectionGeometry } as GeoJSON.Feature, {
      style: { color, weight: 2, fillOpacity: 0.12 },
    }).addTo(group);

    if (point) {
      L.circleMarker([point[1], point[0]], {
        color: "#ffffff",
        fillColor: "#0ea5e9",
        fillOpacity: 1,
        radius: 6,
        weight: 2,
      }).addTo(group);
    }
    if (polygon && polygon.length > 0) {
      const latlngs = polygon.map(p => [p[1], p[0]] as [number, number]);
      if (polygon.length > 2) {
        L.polygon(latlngs, {
          color: "#0ea5e9",
          weight: 2,
          fillOpacity: 0.2,
        }).addTo(group);
      } else {
        L.polyline(latlngs, {
          color: "#0ea5e9",
          weight: 2,
          dashArray: "4 4",
        }).addTo(group);
      }
      latlngs.forEach(ll => {
        L.circleMarker(ll, {
          color: "#ffffff",
          fillColor: "#0ea5e9",
          fillOpacity: 1,
          radius: 4,
          weight: 1,
        }).addTo(group);
      });
    }
    if (transect) {
      const latlngs = [
        [transect[0][1], transect[0][0]] as [number, number],
        [transect[1][1], transect[1][0]] as [number, number]
      ];
      L.polyline(latlngs, {
        color: "#0ea5e9",
        weight: 2,
      }).addTo(group);
      latlngs.forEach(ll => {
        L.circleMarker(ll, {
          color: "#ffffff",
          fillColor: "#0ea5e9",
          fillOpacity: 1,
          radius: 4,
          weight: 1,
        }).addTo(group);
      });
    }
  }, [ready, point, polygon, transect, drawingMode, selectionGeometry, color]);

  return (
    <section
      className="map-panel real-map"
      aria-label={areaLabel ?? raster?.ariaLabel ?? (raster ? "Georeferenced processed water-class map" : "Actual catalog scene footprint map")}
    >
      <div ref={element} className="map-canvas" />
      {drawingMode && (
        <div className="drawing-instructions" aria-live="polite">
          {drawingMode === "point" && "Tap the map to inspect a pixel."}
          {drawingMode === "polygon" && "Tap to draw region. Need 3+ points."}
          {drawingMode === "transect" && "Tap two points to draw a transect."}
        </div>
      )}
      <div className="map-top">
        <div className="map-label">
          <span className="signal-dot" style={{ background: color }} />
          {areaLabel ?? raster?.label ?? (raster ? "Processed classification" : "Actual scene footprint")}
          <span className="tiny-tag">{areaLabel ? "AREA" : "REAL DATA"}</span>
        </div>
        <Button
          className="map-button"
          variant="secondary"
          size="icon"
          aria-label={visible ? "Hide data layer" : "Show data layer"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          <Layers2 size={17} />
        </Button>
      </div>
      <div className="map-bottom">
        <div className="real-legend">
          {raster?.legend ?? (raster ? <><span style={{ background: "#5bc6ff" }} />Water class 1 <span style={{ background: "#b3f84c" }} />Class 2</> : <><span style={{ background: color }} />{areaLabel ? "Selected boundary; not a measured change footprint" : "Product coverage boundary"}</>)}
        </div>
        <Button
          className="map-button"
          variant="secondary"
          size="icon"
          aria-label="Fit data on map"
          onClick={() => fit.current?.()}
        >
          <LocateFixed size={17} />
        </Button>
      </div>
      {error && (
        <span className="map-error">
          A map asset is unavailable · metadata remains accessible
        </span>
      )}
    </section>
  );
}
