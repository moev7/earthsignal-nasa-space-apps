import { z } from "zod";
import { sceneSchema, geometrySchema, type Scene } from "./domain";
const upstreamSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z
    .array(
      z.object({
        type: z.literal("Feature"),
        geometry: geometrySchema,
        properties: z.record(z.unknown()),
      }),
    )
    .max(24),
});
function text(v: unknown, fallback = "Not provided") {
  return typeof v === "string" && v ? v : fallback;
}
function numeric(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
// Restrict links to catalog-owned public assets. Do not expose private context URLs or proxy arbitrary destinations.
export function publicAsset(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" &&
      [
        "nisar.asf.earthdatacloud.nasa.gov",
        "cumulus.asf.earthdatacloud.nasa.gov",
        "datapool.asf.alaska.edu",
      ].includes(u.hostname) &&
      !u.pathname.includes("PRIVATE")
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function parseAsfCatalog(input: unknown): Scene[] {
  const inputData = upstreamSchema.parse(input);
  const records = inputData.features.map((f) => {
    const p = f.properties;
    const urls = Array.isArray(p.browse)
      ? p.browse.map(publicAsset).filter((s): s is string => !!s)
      : [];
    const extras = Array.isArray(p.additionalUrls)
      ? p.additionalUrls.map(publicAsset).filter((s): s is string => !!s)
      : [];
    const polarizations = [
      p.polarization,
      p.mainBandPolarization,
      p.sideBandPolarization,
    ].flatMap((v) =>
      Array.isArray(v)
        ? v.filter((s): s is string => typeof s === "string")
        : typeof v === "string"
          ? [v]
          : [],
    );
    const bytes =
      typeof p.bytes === "object" && p.bytes !== null
        ? (p.bytes as Record<string, { bytes?: unknown }>)
        : {};
    const fileName = text(p.fileName, "");
    const collection = text(p.collectionName, "");
    return sceneSchema.parse({
      id: text(p.fileID, ""),
      name: text(p.sceneName),
      startTime: p.startTime,
      stopTime: p.stopTime,
      platform: text(p.platform),
      product: text(p.processingLevel),
      direction: text(p.flightDirection),
      path: numeric(p.pathNumber),
      frame: numeric(p.frameNumber),
      orbit: numeric(p.orbit),
      polarization: [...new Set(polarizations)],
      maturity: collection.includes("PROVISIONAL")
        ? "Provisional"
        : collection.includes("BETA")
          ? "Beta"
          : /^NISAR_L2_(GCOV|GUNW|GOFF|GSLC)_V\d+$/.test(collection)
            ? "Validated"
          : "Not specified in catalog",
      processorVersion: typeof p.pgeVersion === "string" ? p.pgeVersion : null,
      collection: collection || null,
      fileBytes: numeric(bytes[fileName]?.bytes),
      fileUrl: publicAsset(p.url),
      browseUrl:
        urls.find((u) => u.endsWith("_LATLON.png")) ??
        urls.find((u) => u.endsWith("_BROWSE.png")) ??
        urls.find((u) => !u.includes("thumbnail")) ??
        null,
      thumbnailUrl: urls.find((u) => u.includes("thumbnail")) ?? null,
      qaUrl: extras.find((u) => u.endsWith("QA_REPORT.pdf")) ?? null,
      geometry: f.geometry,
    });
  });
  const unique = [...new Map(records.map((s) => [s.id, s])).values()];
  return unique.sort((a, b) => b.startTime.localeCompare(a.startTime));
}
