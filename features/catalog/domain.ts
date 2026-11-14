import { z } from "zod";
export const REGIONS = {
  mead: { label: "Lake Mead region", point: [-114.75, 36.05] },
  sacramento: { label: "Sacramento Delta", point: [-121.61, 38.12] },
  tehran: { label: "Tehran Plain", point: [51.27, 35.48] },
  amazon: { label: "Amazon Basin", point: [-63.25, -9.65] },
  greenland: { label: "Jakobshavn Glacier", point: [-49.55, 69.13] },
  okavango: { label: "Okavango Delta", point: [22.9, -19.28] },
  punjab: { label: "Punjab Farmland", point: [75.45, 30.88] },
  global: { label: "Global catalog", point: null },
} as const;
export const PRODUCTS = {
  GCOV: {
    dataset: "NISAR",
    label: "GCOV · Backscatter",
    color: "#b3f84c",
    description:
      "Geocoded radar covariance. A useful starting point for water, vegetation, and surface-change analysis.",
  },
  GUNW: {
    dataset: "NISAR",
    label: "GUNW · Interferometry",
    color: "#ff795b",
    description:
      "Geocoded unwrapped interferograms. Coherence screening and atmospheric corrections are needed before interpreting line-of-sight motion.",
  },
  GOFF: {
    dataset: "NISAR",
    label: "GOFF · Surface offsets",
    color: "#6b9fff",
    description:
      "Geocoded offset tracking. Acquisition intervals and tracking quality are needed to derive motion.",
  },
  GSLC: {
    dataset: "NISAR",
    label: "GSLC · Complex imagery",
    color: "#65c6af",
    description:
      "Geocoded complex radar imagery for more advanced interferometric processing.",
  },
  RTC: {
    dataset: "OPERA-S1",
    label: "OPERA RTC · Backscatter",
    color: "#ddacff",
    description:
      "Terrain-corrected Sentinel-1 radar imagery from OPERA. This is a different mission/product from NISAR.",
  },
} as const;
export type Product = keyof typeof PRODUCTS;
export function catalogPoint(value: string): [number, number] | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+),[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const [lon, lat] = value.split(",").map(Number);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? [lon, lat] : null;
}
export const querySchema = z
  .object({
    region: z
      .enum([
        "mead",
        "sacramento",
        "tehran",
        "amazon",
        "greenland",
        "okavango",
        "punjab",
        "global",
      ])
      .default("sacramento"),
    product: z.enum(["GCOV", "GUNW", "GOFF", "GSLC", "RTC"]).default("GCOV"),
    point: z.string().max(80).refine(value => catalogPoint(value) !== null, "Use longitude,latitude in decimal degrees").optional(),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .superRefine((q, ctx) => {
    for (const key of ["start", "end"] as const)
      if (
        Number.isNaN(Date.parse(q[key])) ||
        new Date(q[key]).toISOString().slice(0, 10) !== q[key]
      )
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Use a valid date",
        });
    if (q.start > q.end)
      ctx.addIssue({
        code: "custom",
        message: "Start must be before end",
        path: ["end"],
      });
  });
export type CatalogQuery = z.infer<typeof querySchema>;
export function catalogQueryKey(query: CatalogQuery): string {
  return JSON.stringify([query.region, query.product, query.point ?? null, query.start, query.end]);
}
const position = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const ring = z.array(position).min(4).max(2000);
export const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1) }),
  z.object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(ring).min(1)).min(1),
  }),
]);
export type SceneGeometry = z.infer<typeof geometrySchema>;
export const sceneSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  startTime: z.string().datetime(),
  stopTime: z.string().datetime(),
  platform: z.string(),
  product: z.string(),
  direction: z.string(),
  path: z.number().nullable(),
  frame: z.number().nullable(),
  orbit: z.number().nullable(),
  polarization: z.array(z.string()),
  maturity: z.string(),
  processorVersion: z.string().nullable(),
  collection: z.string().nullable(),
  fileBytes: z.number().nonnegative().nullable(),
  fileUrl: z.string().url().nullable(),
  browseUrl: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  qaUrl: z.string().url().nullable(),
  geometry: geometrySchema,
});
export type Scene = z.infer<typeof sceneSchema>;
export const catalogSchema = z.object({
  schemaVersion: z.literal("1.0"),
  source: z.literal("ASF / NASA Earthdata"),
  retrievedAt: z.string().datetime(),
  query: querySchema,
  queryUrl: z.string().url(),
  limit: z.number(),
  scenes: z.array(sceneSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;
export function defaultQuery(): CatalogQuery {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 90);
  return {
    region: "sacramento",
    product: "GCOV",
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
export function buildAsfUrl(query: CatalogQuery) {
  const q = querySchema.parse(query);
  const params = new URLSearchParams({
    dataset: PRODUCTS[q.product].dataset,
    processingLevel: q.product,
    start: `${q.start}T00:00:00Z`,
    end: `${q.end}T23:59:59Z`,
    maxResults: "24",
    output: "geojson",
  });
  const point = q.point ? catalogPoint(q.point) : REGIONS[q.region].point;
  if (point) params.set("intersectsWith", q.point ? `POINT(${q.point.replace(",", " ")})` : `POINT(${point[0]} ${point[1]})`);
  return `https://api.daac.asf.alaska.edu/services/search/param?${params}`;
}
export function formatBytes(bytes: number | null) {
  if (bytes === null) return "Not provided";
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : `${(bytes / 1e6).toFixed(1)} MB`;
}
export function utcTime(date: string) {
  return (
    new Date(date).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}
