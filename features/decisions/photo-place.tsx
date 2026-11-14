"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, MapPin, X } from "lucide-react";
import { GeoMap } from "@/features/catalog/geo-map";
import { coordinateInput } from "@/lib/study-rectangle";
import { PHOTO_HEADER_BYTES, PHOTO_MAX_BYTES, parsePhotoLocation, parsePhotoPoint } from "@/lib/photo-location";
import { photoDateErrors, photoDefaultDates, photoStudyArea, type PhotoPoint } from "@/lib/photo-discovery";
import "./photo-place.css";

export function PhotoPlace({ initialPoint, onDiscover }: {
  initialPoint: readonly number[];
  onDiscover: (point: PhotoPoint, start: string, end: string) => void;
}) {
  const chooser = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const epoch = useRef(0), objectUrl = useRef<string | null>(null);
  const [active, setActive] = useState(false), [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null), [previewFailed, setPreviewFailed] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [latitude, setLatitude] = useState(""), [longitude, setLongitude] = useState("");
  const [origin, setOrigin] = useState<"camera" | "chosen" | "device">("chosen");
  const [mapOpen, setMapOpen] = useState(false);
  const [dates, setDates] = useState(photoDefaultDates);
  const point = parsePhotoPoint(latitude, longitude);
  const dateErrors = photoDateErrors(dates.start, dates.end);
  const valid = point && !dateErrors.start && !dateErrors.end;
  const releasePreview = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  const clear = () => {
    epoch.current++;
    releasePreview(); setPreview(null); setPreviewFailed(false); setActive(false); setReading(false);
    setLatitude(""); setLongitude(""); setMessage(""); setError(""); setMapOpen(false); setOrigin("chosen");
    if (chooser.current) chooser.current.value = "";
    if (camera.current) camera.current.value = "";
  };
  useEffect(() => {
    const generation = epoch;
    const reset = () => clear();
    window.addEventListener("earthsignal-auth-changed", reset);
    return () => { generation.current++; releasePreview(); window.removeEventListener("earthsignal-auth-changed", reset); };
  // This lifecycle owns only refs and state setters; it must not reset a selection on rerender.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function select(file?: File) {
    if (!file) return;
    const token = ++epoch.current;
    setError(""); setActive(true);
    if (file.size > PHOTO_MAX_BYTES || file.size === 0) {
      setReading(false); setMessage("The replacement was not used. Check your location below, or choose another photo.");
      setError(file.size === 0 ? "This photo is empty. Choose another photo, or keep the location below." : "Choose a photo no larger than 20 MiB, or keep the location below."); return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.slice(0, PHOTO_HEADER_BYTES).arrayBuffer());
      if (token !== epoch.current) return;
      const result = parsePhotoLocation(bytes);
      // Only browser image formats are previewed; SVG/HTML and arbitrary input never become a preview.
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
      // Commit only after the candidate is read: a failed replacement must not
      // discard the accepted preview or the location the user already chose.
      const nextPreview = jpeg || png || webp ? URL.createObjectURL(file) : null;
      releasePreview(); objectUrl.current = nextPreview;
      setPreview(nextPreview); setPreviewFailed(false); setMapOpen(false);
      setLatitude(""); setLongitude(""); setOrigin("chosen");
      if (result.status === "located") {
        setLatitude(coordinateInput(result.point.latitude)); setLongitude(coordinateInput(result.point.longitude)); setOrigin("camera");
        setMessage("A camera location was found. Check that this is the place you want to explore.");
      } else setMessage(result.status === "missing" ? "No saved location was found. Choose the place on the map, or use where you are now if you took the photo here." : result.status === "unsupported" ? "We can read saved locations from JPEG photos. For this format, choose the place yourself below." : "The saved location couldn’t be read. You can still choose the place yourself below.");
    } catch {
      if (token !== epoch.current) return;
      setMessage("The replacement was not used. Check your location below, or choose another photo.");
      setError("We couldn’t read this photo. Choose another, or keep the location below.");
    } finally { if (token === epoch.current) setReading(false); }
  }
  const useDeviceLocation = () => {
    const token = ++epoch.current;
    setReading(false); setActive(true); setError(""); setLatitude(""); setLongitude("");
    if (!navigator.geolocation) { setError("Your browser cannot share a location. Choose it on the map or enter coordinates."); return; }
    setMessage("Waiting for your device location. Your browser may ask permission.");
    navigator.geolocation.getCurrentPosition(position => {
      if (token !== epoch.current) return;
      setLatitude(coordinateInput(position.coords.latitude)); setLongitude(coordinateInput(position.coords.longitude)); setOrigin("device");
      setMessage(`Your device reports a location within about ${Math.round(position.coords.accuracy)} metres. Use this only if the photo was taken here; check the point before searching.`);
    }, () => {
      if (token !== epoch.current) return;
      setMessage("Device location was not available. Choose a point on the map or enter coordinates instead.");
    }, { timeout: 10000, maximumAge: 0, enableHighAccuracy: false });
  };
  const edit = (lat: string, lon: string) => {
    epoch.current++; // A late device-location response must not replace a manual choice.
    setLatitude(lat); setLongitude(lon); setOrigin("chosen"); setMessage("Location updated. Check the place, then confirm the search."); setError("");
  };
  const mapPoint = point ?? { longitude: initialPoint[0], latitude: initialPoint[1] };
  return <details className="photo-place" onToggle={event => {
    // Closing removes private preview data and invalidates any pending file read.
    if (!event.currentTarget.open) clear();
  }}>
    <summary><Camera size={17} aria-hidden="true" /> Start from a photo</summary>
    <div className="photo-place-body">
      <p>Your photo stays on this device. We can read a saved camera location from a JPEG; we don’t guess from the picture.</p>
      <div className="photo-actions">
        <button type="button" onClick={() => chooser.current?.click()}><ImagePlus size={16} aria-hidden="true" /> Choose photo</button>
        <button type="button" onClick={() => camera.current?.click()}><Camera size={16} aria-hidden="true" /> Take photo</button>
      </div>
      <input ref={chooser} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden aria-label="Choose a photo on this device" onChange={e => { void select(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-label="Take a photo on this device" onChange={e => { void select(e.target.files?.[0]); e.target.value = ""; }} />
      <p className="photo-small">JPEG GPS supported · up to 20 MiB. Other formats can use a location you choose. Camera options depend on your device.</p>
      {!active && <button type="button" className="photo-text-action" onClick={() => { setActive(true); setMessage("Choose a location below. No photo is needed to search."); }}>Set the location yourself</button>}
      {active && <>
        {/* A private blob preview must never use a server image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && !previewFailed && <img className="photo-preview" src={preview} alt="Your selected photo, kept on this device" onError={() => setPreviewFailed(true)} />}
        {previewFailed && <p className="photo-small">Preview unavailable. You can still choose a location.</p>}
        <p role="status" aria-live="polite">{reading ? "Reading the saved location on your device…" : message}</p>
        {!reading && <>
          <p className="photo-small">Choose where you want to look. A camera’s saved position may be far from the subject.</p>
          <button type="button" onClick={useDeviceLocation}>Use where I am now</button>
          <p className="photo-small">Only use this if the photo was taken here. Your browser will ask for location permission.</p>
          <details className="photo-coordinate-editor"><summary>Enter or edit coordinates</summary>
          <div className="photo-coordinates">
            <label htmlFor="photo-latitude">Latitude<input id="photo-latitude" aria-describedby="photo-coordinate-help" aria-invalid={Boolean(latitude && !point)} inputMode="decimal" value={latitude} placeholder="For example, 36.05" maxLength={30} onChange={e => edit(e.target.value, longitude)} /></label>
            <label htmlFor="photo-longitude">Longitude<input id="photo-longitude" aria-describedby="photo-coordinate-help" aria-invalid={Boolean(longitude && !point)} inputMode="decimal" value={longitude} placeholder="For example, −114.75" maxLength={30} onChange={e => edit(latitude, e.target.value)} /></label>
          </div>
          <p id="photo-coordinate-help" className={((latitude || longitude) && !point) ? "photo-error" : "photo-small"} aria-live="polite">Latitude: −90 to 90. Longitude: −180 to 180. Use decimal numbers; north/east are positive, south/west negative.</p>
          </details>
          <button type="button" aria-expanded={mapOpen} onClick={() => setMapOpen(value => !value)}><MapPin size={16} aria-hidden="true" />{mapOpen ? "Hide map" : "Check or choose on map"}</button>
          <p className="photo-small">Opening the map shares the viewed area with OpenStreetMap. You can also use the coordinate boxes without opening it.</p>
          {mapOpen && <div className="photo-map">
            <p>Tap the place you want, or edit the coordinates above. {point ? "The marker is your proposed location." : "This starts at your current study area; it is not a detected photo location."}</p>
            {Math.abs(mapPoint.latitude) > 85 ? <p>Use the coordinates for this polar location; this map cannot display it accurately.</p> : <GeoMap
              point={point ? [point.longitude, point.latitude] : undefined}
              focusBounds={[[Math.max(-85, mapPoint.latitude - .02), Math.max(-180, mapPoint.longitude - .02)], [Math.min(85, mapPoint.latitude + .02), Math.min(180, mapPoint.longitude + .02)]]}
              viewKey={`photo-${mapPoint.longitude}-${mapPoint.latitude}`}
              maxFitZoom={13}
              selectionGeometry={photoStudyArea(mapPoint) ?? undefined}
              onMapClick={([lon, lat]) => edit(coordinateInput(lat), coordinateInput(lon >= -180 && lon <= 180 ? lon : ((lon + 180) % 360 + 360) % 360 - 180))}
              areaLabel="Proposed study area"
            />}
          </div>}
          <div className="photo-dates">
            <label htmlFor="photo-start">From<input id="photo-start" type="date" value={dates.start} max={dates.end} aria-invalid={Boolean(dateErrors.start)} aria-describedby={dateErrors.start ? "photo-start-error" : undefined} onChange={e => setDates(d => ({ ...d, start: e.target.value }))} /></label>
            {dateErrors.start && <p id="photo-start-error" className="photo-error" aria-live="polite">{dateErrors.start}</p>}
            <label htmlFor="photo-end">To<input id="photo-end" type="date" value={dates.end} min={dates.start} aria-invalid={Boolean(dateErrors.end)} aria-describedby={dateErrors.end ? "photo-end-error" : undefined} onChange={e => setDates(d => ({ ...d, end: e.target.value }))} /></label>
            {dateErrors.end && <p id="photo-end-error" className="photo-error" aria-live="polite">{dateErrors.end}</p>}
          </div>
          <p className="photo-small">Search the selected dates. The photo’s file date is not used as its capture time.</p>
          <p className="photo-confirmation">{point ? `${origin === "camera" ? "Recorded camera location" : origin === "device" ? "Current device location" : "Location you chose"}: ${point.latitude}, ${point.longitude}.` : "Choose a location to continue."} Searching sends only this point and the selected dates/product through Earthsignal to ASF / NASA Earthdata.</p>
          <button type="button" className="photo-primary" disabled={!valid} onClick={() => {
            if (!point || !valid) return;
            onDiscover(point, dates.start, dates.end);
          }}>Confirm location & find radar</button>
        </>}
        {error && <p className="photo-error" role="alert">{error}</p>}
        <button type="button" className="photo-text-action" onClick={clear}><X size={15} aria-hidden="true" /> Remove photo</button>
      </>}
    </div>
  </details>;
}
