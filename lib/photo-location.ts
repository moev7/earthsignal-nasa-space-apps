/** Caller checks the original file size, then reads only this prefix locally. */
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const PHOTO_HEADER_BYTES = 256 * 1024;

export type PhotoPoint = { longitude: number; latitude: number };
export type PhotoLocationResult =
  | { status: "located"; point: PhotoPoint }
  | { status: "missing" | "unsupported" | "invalid"; message: string };

const MANUAL = "Choose a location on the map or enter latitude and longitude manually.";
const MAX_ENTRIES = 256;
const MAX_SEGMENTS = 1024;
const MAX_READS = 8192;

/** Strict decimal degrees; no exponents, partial numbers, wrapping or blank-as-zero. */
export function parsePhotoPoint(latText: string, lonText: string): PhotoPoint | null {
  const texts = [latText.trim(), lonText.trim()];
  if (texts.some((text) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))) return null;
  const [latitude, longitude] = texts.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { longitude: longitude === 0 ? 0 : longitude, latitude: latitude === 0 ? 0 : latitude };
}

function invalid(): never {
  throw new Error("Invalid or out-of-budget photo header");
}

/** Reads only IFD0 and its single GPS IFD, never EXIF/thumbnail/linked IFDs. */
function exifPoint(bytes: Uint8Array, budget: { reads: number; entries: number; gps: number }): PhotoPoint | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset: number, size: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset > bytes.length - size) invalid();
  };
  range(0, 8);
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) invalid();
  const read = (offset: number, size: 2 | 4): number => {
    if (++budget.reads > MAX_READS) invalid();
    range(offset, size);
    return size === 2 ? view.getUint16(offset, little) : view.getUint32(offset, little);
  };
  if (read(2, 2) !== 42) invalid();
  type Entry = { type: number; count: number; value: number };
  const directory = (offset: number) => {
    if (offset < 8) invalid();
    const count = read(offset, 2);
    budget.entries += count;
    if (count > MAX_ENTRIES || budget.entries > MAX_ENTRIES * 2) invalid();
    const end = offset + 2 + count * 12 + 4;
    range(offset, end - offset);
    const entries = new Map<number, Entry>();
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12;
      const tag = read(at, 2);
      if (entries.has(tag)) invalid();
      entries.set(tag, { type: read(at + 2, 2), count: read(at + 4, 4), value: at + 8 });
    }
    const next = read(end - 4, 4);
    if (next !== 0) {
      if (next < 8 || (next >= offset && next < end)) invalid();
      range(next, 2); // Validate the pointer, but do not follow a thumbnail/IFD chain.
    }
    return { entries, start: offset, end, next };
  };
  const root = directory(read(4, 4));
  const pointer = root.entries.get(0x8825);
  if (!pointer) return null;
  if (++budget.gps !== 1 || pointer.type !== 4 || pointer.count !== 1) invalid();
  const gps = directory(read(pointer.value, 4));
  if (gps.next !== 0 || gps.entries.has(0x8825) || (gps.start < root.end && root.start < gps.end)) invalid();
  // The catalog uses WGS84. An absent datum is an unverified GPS/WGS84 assumption;
  // an explicitly different survey datum must never be silently transformed.
  const datum = gps.entries.get(0x12);
  if (datum) {
    if (datum.type !== 2 || datum.count < 2 || datum.count > 32) invalid();
    const offset = datum.count <= 4 ? datum.value : read(datum.value, 4);
    range(offset, datum.count);
    if (datum.count > 4 && (offset < 8 || (offset < root.end && root.start < offset + datum.count) || (offset < gps.end && gps.start < offset + datum.count))) invalid();
    const raw = bytes.subarray(offset, offset + datum.count);
    if (raw[raw.length - 1] !== 0 || raw.subarray(0, -1).some(byte => byte < 32 || byte > 126)) invalid();
    const value = String.fromCharCode(...raw.subarray(0, -1)).trim().toUpperCase().replace(/[ -]/g, "");
    if (value !== "WGS84") invalid();
  }
  const required = (tag: number, type: number, count: number): Entry => {
    const entry = gps.entries.get(tag);
    if (!entry || entry.type !== type || entry.count !== count) invalid();
    return entry;
  };
  const hemisphere = (tag: number, positive: string, negative: string) => {
    const entry = required(tag, 2, 2); // ASCII plus its required NUL, inline.
    if (bytes[entry.value + 1] !== 0) invalid();
    const ref = String.fromCharCode(bytes[entry.value]);
    if (ref !== positive && ref !== negative) invalid();
    return ref === positive ? 1 : -1;
  };
  const coordinate = (tag: number, limit: number) => {
    const entry = required(tag, 5, 3); // Three unsigned RATIONALs.
    const offset = read(entry.value, 4);
    range(offset, 24);
    if (offset < 8 || (offset < root.end && root.start < offset + 24) || (offset < gps.end && gps.start < offset + 24)) invalid();
    const parts = [0, 8, 16].map((step) => {
      const numerator = read(offset + step, 4);
      const denominator = read(offset + step + 4, 4);
      if (denominator === 0) invalid();
      return numerator / denominator;
    });
    const [degrees, minutes, seconds] = parts;
    if (degrees > limit || minutes >= 60 || seconds >= 60 || (degrees === limit && (minutes !== 0 || seconds !== 0))) invalid();
    const value = degrees + minutes / 60 + seconds / 3600;
    if (!Number.isFinite(value) || value > limit || (value === limit && (minutes !== 0 || seconds !== 0))) invalid();
    return value;
  };
  const latitude = hemisphere(1, "N", "S") * coordinate(2, 90);
  const longitude = hemisphere(3, "E", "W") * coordinate(4, 180);
  return { longitude: longitude === 0 ? 0 : longitude, latitude: latitude === 0 ? 0 : latitude };
}

/**
 * Local prefix parser, independent of browser/file/network APIs. A located point is
 * the camera-recorded GPS position, not a verified subject position or ground truth.
 * No filename, timestamp, image bytes or other private metadata leaves this API.
 */
export function parsePhotoLocation(bytes: Uint8Array): PhotoLocationResult {
  if (bytes.length > PHOTO_MAX_BYTES) return { status: "invalid", message: `The photo exceeds the 20 MiB limit. ${MANUAL}` };
  const header = bytes.subarray(0, PHOTO_HEADER_BYTES);
  const matches = (offset: number, signature: number[]) => signature.every((byte, i) => header[offset + i] === byte);
  if (!matches(0, [0xff, 0xd8])) {
    const format = matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? "PNG"
      : matches(0, [0x52, 0x49, 0x46, 0x46]) && matches(8, [0x57, 0x45, 0x42, 0x50]) ? "WebP" : "This file's";
    return { status: "unsupported", message: `${format} GPS metadata is not supported here. Try a JPEG with GPS metadata. ${MANUAL}` };
  }
  try {
    let offset = 2;
    let point: PhotoPoint | null = null;
    const budget = { reads: 0, entries: 0, gps: 0 };
    for (let segments = 0; segments < MAX_SEGMENTS; segments++) {
      if (header[offset++] !== 0xff) invalid();
      while (header[offset] === 0xff) offset++; // JPEG marker fill, bounded by prefix.
      const marker = header[offset++];
      if (marker === 0xd9) return point ? { status: "located", point } : { status: "missing", message: `No camera GPS location was found in the JPEG header. ${MANUAL}` };
      if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
      if (marker === 0x01) continue; // Standalone TEM marker.
      if (offset + 2 > header.length) invalid();
      const length = header[offset] * 256 + header[offset + 1];
      if (length < 2 || offset + length > header.length) invalid();
      const end = offset + length;
      if (marker === 0xda) return point ? { status: "located", point } : { status: "missing", message: `No camera GPS location was found before JPEG image data. ${MANUAL}` };
      if (marker === 0xe1 && length >= 8 && matches(offset + 2, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
        const candidate = exifPoint(header.subarray(offset + 8, end), budget);
        if (candidate) point = candidate;
      }
      offset = end;
    }
    invalid();
  } catch {
    return { status: "invalid", message: `The JPEG GPS header is malformed, truncated, or exceeds the bounded reader limits. ${MANUAL}` };
  }
}
