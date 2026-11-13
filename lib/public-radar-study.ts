import { z } from "zod";
import { publicStudy, verifyPublicManifest } from "./public-study-registry";
import { radarResultSchema } from "./radar-contract";

export const RADAR_STUDY_ID = "lake-mead-gcov-2026" as const;
export const RADAR_STUDY_BASE = `/data/radar/${RADAR_STUDY_ID}/`;
export const RADAR_STUDY_FILES = [
  "values.json",
  "before.png",
  "after.png",
  "difference.png",
  "excluded.png",
  "before.tif",
  "after.tif",
  "difference.tif",
  "validity.tif",
  "verification.json",
] as const;
const fileSchema = z
  .object({
    bytes: z.number().int().positive().max(16_000_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const publicRadarManifestSchema = z
  .object({
    schema: z.literal("earthsignal.radar-study/1"),
    id: z.literal(RADAR_STUDY_ID),
    provenance: z.literal("measured"),
    quantity: z.literal("HH radar backscatter change"),
    units: z.literal("dB"),
    presentation: z
      .object({
        grid: z.literal("native"),
        resampling: z.literal("none"),
        notice: z.string().min(1),
      })
      .strict(),
    source: radarResultSchema,
    files: z.record(fileSchema),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (
      Object.keys(m.files).length !== RADAR_STUDY_FILES.length ||
      RADAR_STUDY_FILES.some((name) => !m.files[name])
    )
      ctx.addIssue({ code: "custom", message: "Incomplete radar study files" });
    if (
      m.source.before.acquiredAt !== "2026-06-26T12:52:20Z" ||
      m.source.after.acquiredAt !== "2026-09-30T12:52:17Z" ||
      JSON.stringify(m.source.crop.transform) !==
        JSON.stringify([702640, 10, 0, 3992970, 0, -10]) ||
      JSON.stringify(m.source.crop.bbox) !==
        JSON.stringify([-114.75, 36.05, -114.74, 36.06])
    )
      ctx.addIssue({
        code: "custom",
        message: "Unexpected public study identity or location",
      });
    if (
      m.source.crop.width * m.source.crop.height > 1_000_000 ||
      m.source.crop.width !== 94 ||
      m.source.crop.height !== 114 ||
      m.source.crop.crs !== "EPSG:32611"
    )
      ctx.addIssue({ code: "custom", message: "Unexpected native study grid" });
  });
export type PublicRadarManifest = z.infer<typeof publicRadarManifestSchema>;
const arraySchema = z.array(z.number().finite().nullable()).max(1_000_000);
export const radarValuesSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    beforeDb: arraySchema,
    afterDb: arraySchema,
    differenceDb: arraySchema,
  })
  .strict();
export type RadarValues = z.infer<typeof radarValuesSchema>;
export type RadarCell = { row: number; column: number };
export type RadarRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type RadarStudy = {
  manifest: PublicRadarManifest;
  values: RadarValues;
  images: Record<"before" | "after" | "difference" | "excluded", string>;
  dispose: () => void;
};

export function validateRadarValues(
  value: unknown,
  manifest: PublicRadarManifest,
): RadarValues {
  const v = radarValuesSchema.parse(value),
    s = manifest.source,
    count = v.width * v.height;
  if (
    v.width !== s.crop.width ||
    v.height !== s.crop.height ||
    [v.beforeDb, v.afterDb, v.differenceDb].some((a) => a.length !== count)
  )
    throw new Error("Radar grid dimensions do not match the source record.");
  let valid = 0;
  for (let i = 0; i < count; i++) {
    const b = v.beforeDb[i],
      a = v.afterDb[i],
      d = v.differenceDb[i];
    if ((b === null) !== (a === null) || (a === null) !== (d === null))
      throw new Error("Radar validity masks disagree.");
    if (b !== null && a !== null && d !== null) {
      valid++;
      if (Math.abs(a - b - d) > 0.00002)
        throw new Error("Radar values disagree with the measured difference.");
    }
  }
  if (
    valid !== s.coverage.commonValidPixels ||
    count !== s.coverage.totalPixels
  )
    throw new Error("Radar coverage does not match the source record.");
  return v;
}
async function readBytes(url: string, limit: number, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error("The radar study could not be loaded. Try again.");
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit)
    throw new Error("The radar study file exceeds its size limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The radar study file is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error("The radar study file exceeds its size limit.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
export async function loadPublicRadarStudy(
  signal?: AbortSignal,
): Promise<RadarStudy> {
  const rawManifest = await readBytes(`${RADAR_STUDY_BASE}manifest.json`, 250_000, signal);
  const revision = publicStudy(RADAR_STUDY_ID);
  if (!revision) throw new Error("This radar study has no reviewed public revision.");
  await verifyPublicManifest(revision, rawManifest);
  const manifest = publicRadarManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(rawManifest)),
  );
  const names = [
    "values.json",
    "before.png",
    "after.png",
    "difference.png",
    "excluded.png",
  ] as const;
  const bytes = await Promise.all(
    names.map(async (name) => {
      const expected = manifest.files[name],
        data = await readBytes(RADAR_STUDY_BASE + name, expected.bytes, signal);
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      if (data.length !== expected.bytes || digest !== expected.sha256)
        throw new Error("Radar study integrity check failed. Please retry.");
      if (name.endsWith(".png")) {
        const view = new DataView(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        );
        if (
          data.length < 24 ||
          view.getUint32(0) !== 0x89504e47 ||
          view.getUint32(4) !== 0x0d0a1a0a ||
          view.getUint32(16) !== manifest.source.crop.width ||
          view.getUint32(20) !== manifest.source.crop.height
        )
          throw new Error("Radar image is not on the native measurement grid.");
      }
      return data;
    }),
  );
  const values = validateRadarValues(
    JSON.parse(new TextDecoder().decode(bytes[0])),
    manifest,
  );
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const urls: string[] = [];
  try {
    const images = {} as RadarStudy["images"];
    (["before", "after", "difference", "excluded"] as const).forEach(
      (name, i) => {
        const url = URL.createObjectURL(
          new Blob([bytes[i + 1]], { type: "image/png" }),
        );
        urls.push(url);
        images[name] = url;
      },
    );
    return {
      manifest,
      values,
      images,
      dispose: () => urls.splice(0).forEach((url) => URL.revokeObjectURL(url)),
    };
  } catch (e) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw e;
  }
}
export function radarCellAt(
  x: number,
  y: number,
  width: number,
  height: number,
): RadarCell | null {
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    return null;
  return {
    column: Math.min(width - 1, Math.floor(x * width)),
    row: Math.min(height - 1, Math.floor(y * height)),
  };
}
export function radarPoint(study: RadarStudy, cell: RadarCell) {
  const { row, column } = cell,
    { width, height } = study.values;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    column < 0 ||
    row >= height ||
    column >= width
  )
    return null;
  const i = row * width + column,
    t = study.manifest.source.crop.transform;
  return {
    beforeDb: study.values.beforeDb[i],
    afterDb: study.values.afterDb[i],
    differenceDb: study.values.differenceDb[i],
    easting: t[0] + (column + 0.5) * t[1] + (row + 0.5) * t[2],
    northing: t[3] + (column + 0.5) * t[4] + (row + 0.5) * t[5],
  };
}
export function radarRegionStats(study: RadarStudy, region: RadarRegion) {
  const { width, height } = study.values,
    { left, top, right, bottom } = region;
  if (
    ![left, top, right, bottom].every(Number.isInteger) ||
    left < 0 ||
    top < 0 ||
    right >= width ||
    bottom >= height ||
    left > right ||
    top > bottom
  )
    throw new Error("Choose a region inside the native radar grid.");
  const values: number[] = [];
  for (let row = top; row <= bottom; row++)
    for (let col = left; col <= right; col++) {
      const v = study.values.differenceDb[row * width + col];
      if (v !== null) values.push(v);
    }
  values.sort((a, b) => a - b);
  const n = values.length,
    t = study.manifest.source.crop.transform;
  return {
    total: (right - left + 1) * (bottom - top + 1),
    valid: n,
    medianDb: n
      ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2
      : null,
    minDb: n ? values[0] : null,
    maxDb: n ? values[n - 1] : null,
    areaKm2: (n * Math.abs(t[1] * t[5] - t[2] * t[4])) / 1e6,
  };
}
