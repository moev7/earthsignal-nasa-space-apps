import { areaSchema, type AssessmentArea } from "./observatory-contract";

export const RECTANGLE_FIELDS = ["west", "south", "east", "north"] as const;
export type RectangleField = (typeof RECTANGLE_FIELDS)[number];
export type RectangleInputs = Record<RectangleField, string>;
export type RectangleErrors = Partial<Record<RectangleField, string>>;

/** Expand JS exponent notation without rounding an existing selected coordinate. */
export function coordinateInput(value: number): string {
  const text = String(value);
  const [mantissa, exponent] = text.split("e");
  if (!exponent) return text;
  const sign = mantissa.startsWith("-") ? "-" : "";
  const unsigned = mantissa.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Decimal degrees only: never interpret blanks as zero or silently wrap a longitude. */
export function studyRectangle(input: RectangleInputs):
  | { ok: true; area: AssessmentArea }
  | { ok: false; errors: RectangleErrors } {
  const errors: RectangleErrors = {};
  const values = {} as Record<RectangleField, number>;
  for (const field of RECTANGLE_FIELDS) {
    const text = input[field].trim();
    const value = Number(text);
    const limit = field === "west" || field === "east" ? 180 : 85;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(value)) {
      errors[field] = "Enter signed decimal degrees with a dot for decimals, for example -114.75 or 36.05.";
    } else if (Math.abs(value) > limit) {
      errors[field] = `Enter a value from −${limit} to ${limit} degrees.`;
    } else values[field] = value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const { west: w, south: s, east: e, north: n } = values;
  if (w >= e) {
    errors.west = errors.east = "West must be less than east. This editor does not cross the 180° meridian.";
  } else if (e - w >= 180) {
    // The service interprets short longitude arcs; wider boxes would select a different region.
    errors.west = errors.east = "Choose a rectangle less than 180° wide.";
  }
  if (s >= n) errors.south = errors.north = "South must be less than north.";
  // Stay outside the service's 1e-10-degree on-segment tolerance for thin edges.
  if (w < e && e - w <= 1e-10) errors.east = "Increase the width. These longitudes are too close to define a supported boundary.";
  if (s < n && n - s <= 1e-10) errors.north = "Increase the height. These latitudes are too close to define a supported boundary.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const ring: [number, number][] = [[w, s], [e, s], [e, n], [w, n], [w, s]];
  // Match the existing server's non-degenerate ring admission, using the emitted coordinates.
  const twiceArea = ring.slice(1).reduce((sum, b, i) => sum + (ring[i][0] * b[1] - b[0] * ring[i][1]), 0);
  if (Math.abs(twiceArea) <= 1e-10) {
    return { ok: false, errors: { east: "This rectangle is too small to define a supported boundary. Increase its width or height." } };
  }
  return { ok: true, area: areaSchema.parse({ type: "Polygon", coordinates: [ring] }) };
}
