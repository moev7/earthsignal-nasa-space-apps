import { z } from "zod";

export const bboxSchema = z
  .tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])
  .refine(
    ([west, south, east, north]) => west < east && south < north,
    "Choose a non-empty crop that does not cross the antimeridian",
  );
export type RadarBbox = z.infer<typeof bboxSchema>;
export const changeRequestSchema = z
  .object({
    beforeId: z.string().min(1).max(220),
    afterId: z.string().min(1).max(220),
    bbox: bboxSchema,
  })
  .strict()
  .refine((q) => q.beforeId !== q.afterId, "Select two different acquisitions");
export type ChangeRequest = z.infer<typeof changeRequestSchema>;
const sourceSchema = z.object({
  id: z.string(),
  acquiredAt: z.string().datetime(),
  track: z.number(),
  frame: z.number(),
  direction: z.string(),
  mode: z.string(),
  release: z.string(),
  collection: z.string(),
  url: z.string().url(),
});
export const radarResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  kind: z.literal("radar-change"),
  title: z.string(),
  before: sourceSchema,
  after: sourceSchema,
  crop: z.object({
    bbox: bboxSchema,
    crs: z.string(),
    resolution: z.tuple([z.number(), z.number()]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    transform: z.array(z.number()).length(6),
    imageBounds: z.tuple([
      z.tuple([z.number(), z.number()]),
      z.tuple([z.number(), z.number()]),
    ]),
  }),
  stats: z.object({
    medianDb: z.number().finite(),
    p05Db: z.number().finite(),
    p95Db: z.number().finite(),
    minDb: z.number().finite(),
    maxDb: z.number().finite(),
  }),
  coverage: z.object({
    totalPixels: z.number().int().positive(),
    beforeValidPixels: z.number().int().nonnegative(),
    afterValidPixels: z.number().int().nonnegative(),
    commonValidPixels: z.number().int().positive(),
    commonValidPercent: z.number().min(0).max(100),
    validAreaKm2: z.number().positive(),
  }),
  layers: z.object({
    before: z.literal("before.png"),
    after: z.literal("after.png"),
    difference: z.literal("difference.png"),
    excluded: z.literal("excluded.png"),
  }),
  artifacts: z.array(z.string()),
  display: z.object({
    backscatterMinDb: z.number(),
    backscatterMaxDb: z.number(),
    differenceLimitDb: z.number().positive(),
  }),
  processing: z.object({
    algorithmVersion: z.string(),
    method: z.string(),
    processedAt: z.string().datetime(),
    beforeSha256: z.string(),
    afterSha256: z.string(),
    maskPolicy: z.string(),
    sourceMetadata: z.record(z.unknown()),
  }),
  notice: z.string(),
});
export type RadarResult = z.infer<typeof radarResultSchema>;
export const changeJobSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string(),
  status: z.enum(["queued", "running", "failed", "cancelled", "completed"]),
  phase: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  beforeId: z.string(),
  afterId: z.string(),
  bbox: bboxSchema,
  prepared: z.boolean(),
  result: radarResultSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type ChangeJob = z.infer<typeof changeJobSchema>;
export const changeListSchema = z.object({
  schemaVersion: z.literal("1.0"),
  jobs: z.array(changeJobSchema),
  capability: z.object({
    ready: z.boolean(),
    message: z.string(),
    maxPixels: z.number().int().positive(),
  }),
});
export const artifactUrl = (jobId: string, name: string) =>
  `/api/change-jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(name)}`;
