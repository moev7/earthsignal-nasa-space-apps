import { z } from "zod";
import { bboxSchema } from "./radar-contract";

export const sarSourceIdSchema = z.enum([
  "nisar",
  "radarsat-1",
  "rcm",
  "saocom",
  "uavsar",
]);
export type SarSourceId = z.infer<typeof sarSourceIdSchema>;
export const sarOperationSchema = z.enum([
  "native-observation",
  "backscatter-observation",
  "backscatter-change",
  "los-displacement",
  "pixel-offset",
]);
export const sarStudyRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    sourceId: sarSourceIdSchema,
    operation: sarOperationSchema,
    recordIds: z
      .array(
        z
          .string()
          .min(1)
          .max(240)
          .regex(/^[A-Za-z0-9_.:-]+$/),
      )
      .min(1)
      .max(2),
    bbox: bboxSchema,
    component: z.enum(["slant-range", "along-track"]).optional(),
    layer: z.number().int().min(1).max(3).optional(),
    pixelWindow: z
      .tuple([
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
        z.number().int().positive(),
        z.number().int().positive(),
      ])
      .optional(),
    channel: z
      .enum(["HH", "HV", "VV", "VH", "CH", "CV", "RR", "RL"])
      .default("HH"),
  })
  .strict()
  .superRefine((r, ctx) => {
    const count = r.operation === "backscatter-change" ? 2 : 1;
    if (
      r.recordIds.length !== count ||
      new Set(r.recordIds).size !== r.recordIds.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["recordIds"],
        message: `Select ${count} distinct acquisition${count === 1 ? "" : "s"}.`,
      });
    if (r.operation === "pixel-offset" && r.sourceId !== "nisar")
      ctx.addIssue({ code: "custom", message: "Native offset processing supports NISAR GOFF only." });
    if (r.operation !== "pixel-offset" && (r.component !== undefined || r.layer !== undefined))
      ctx.addIssue({ code: "custom", message: "Offset settings apply to GOFF only." });
    if (r.operation === "los-displacement" && r.sourceId !== "nisar")
      ctx.addIssue({
        code: "custom",
        message: "This LOS reader supports NISAR GUNW products only.",
      });
    if (r.operation === "native-observation" && r.sourceId !== "radarsat-1")
      ctx.addIssue({
        code: "custom",
        message: "Native source-value inspection supports RADARSAT-1 only.",
      });
    if (r.operation === "native-observation" && !r.pixelWindow)
      ctx.addIssue({ code: "custom", path: ["pixelWindow"], message: "Choose an explicit native pixel window for uncalibrated source inspection." });
    if (
      r.pixelWindow &&
      (r.operation !== "native-observation" ||
        r.pixelWindow[2] * r.pixelWindow[3] > 262144)
    )
      ctx.addIssue({
        code: "custom",
        path: ["pixelWindow"],
        message:
          "Use a native window of at most 262,144 pixels for magnitude inspection only.",
      });
    if (r.bbox[2] - r.bbox[0] > 0.2 || r.bbox[3] - r.bbox[1] > 0.2)
      ctx.addIssue({
        code: "custom",
        path: ["bbox"],
        message: "Use a crop no wider or taller than 0.2 degrees.",
      });
  });
export type SarStudyRequest = z.infer<typeof sarStudyRequestSchema>;
export const sarSearchSchema = z
  .object({
    sourceId: sarSourceIdSchema,
    bbox: bboxSchema,
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    product: z.enum(["GCOV", "GUNW", "GOFF", "GSLC"]).default("GCOV"),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (
      [q.start, q.end].some(
        (d) =>
          !Number.isFinite(Date.parse(d)) ||
          new Date(d).toISOString().slice(0, 10) !== d,
      ) ||
      q.start > q.end
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose valid chronological dates.",
      });
    else if (Date.parse(q.end) - Date.parse(q.start) > 366 * 86400000)
      ctx.addIssue({
        code: "custom",
        message: "Search at most one year at a time.",
      });
  });
export type SarSearch = z.infer<typeof sarSearchSchema>;
export const sarRecordSchema = z.object({
  id: z.string(),
  sourceId: sarSourceIdSchema,
  title: z.string(),
  product: z.string(),
  acquiredAt: z.string().nullable(),
  endAt: z.string().nullable(),
  collection: z.string().nullable(),
  maturity: z.string(),
  channels: z.array(z.string()),
  bbox: bboxSchema.nullable(),
  scienceAssets: z.number().int().nonnegative(),
  referenceUrl: z.string().url(),
  notice: z.string(),
});
export type SarRecord = z.infer<typeof sarRecordSchema>;
export const sarSearchResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  sourceId: sarSourceIdSchema,
  retrievedAt: z.string(),
  status: z.enum(["ready", "access-required", "unavailable"]),
  notice: z.string(),
  limit: z.number(),
  complete: z.boolean(),
  records: z.array(sarRecordSchema).max(24),
});
export type SarSearchResult = z.infer<typeof sarSearchResultSchema>;
export const sarPlanSchema = z.object({
  schemaVersion: z.literal("1.0"),
  ready: z.boolean(),
  request: sarStudyRequestSchema,
  method: z.string(),
  quantity: z.string(),
  unit: z.enum(["dB", "mm", "meters", "source units"]),
  notices: z.array(z.string()),
  gates: z.array(z.string()),
  records: z.array(sarRecordSchema),
  limits: z.object({
    maxPixels: z.number(),
    maxTransferBytes: z.number(),
    maxSeconds: z.number(),
  }),
});
export type SarPlan = z.infer<typeof sarPlanSchema>;
export const sarResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  kind: z.literal("sar-study"),
  method: z.string(),
  sourceId: sarSourceIdSchema,
  operation: sarOperationSchema,
  channel: z.string(),
  quantity: z.string(),
  unit: z.enum(["dB", "mm", "meters", "source units"]),
  grid: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    crs: z.string(),
    transform: z.array(z.number()).length(6),
  }),
  coverage: z.object({
    total: z.number().int(),
    valid: z.number().int(),
    fraction: z.number().min(0).max(1),
  }),
  stats: z.object({
    min: z.number().nullable(),
    median: z.number().nullable(),
    max: z.number().nullable(),
  }),
  records: z.array(sarRecordSchema),
  notices: z.array(z.string()),
  artifacts: z.record(
    z.object({
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  published: z.literal(false),
  processedAt: z.string(),
});
export type SarResult = z.infer<typeof sarResultSchema>;
export const sarJobSchema = z.object({
  schemaVersion: z.literal("1.0"),
  kind: z.literal("sar-study"),
  id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  phase: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  request: sarStudyRequestSchema,
  result: sarResultSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type SarJob = z.infer<typeof sarJobSchema>;
