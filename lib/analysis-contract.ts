import { z } from "zod";
import { inspectionWindowsSchema } from "./inspection-contract";

export const coordinateSchema = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
export const polygonSchema = z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(coordinateSchema).min(4).max(65)).length(1) }).strict();
export const analysisRequestSchema = z.object({
  polygon: polygonSchema.nullable().optional(),
  point: coordinateSchema.optional(),
  transect: z.tuple([coordinateSchema, coordinateSchema]).optional(),
  thresholdDb: z.number().finite().min(0.1).max(30).default(3),
}).strict();
const nullableNumber = z.number().finite().nullable();
const distributionSchema = z.object({ edges: z.array(z.number().finite()).max(66), counts: z.array(z.number().int().nonnegative()).max(65) });
const sampleSchema = z.object({ coordinate: coordinateSchema, valid: z.boolean(), beforeDb: nullableNumber, afterDb: nullableNumber, differenceDb: nullableNumber, reason: z.string().nullable() });
export const analysisResultSchema = z.object({
  schemaVersion: z.literal("1.0"), kind: z.literal("radar-analysis"), jobId: z.string(),
  selection: z.object({ polygon: polygonSchema.nullable(), thresholdDb: z.number() }),
  summary: z.object({ totalPixels: z.number().int().nonnegative(), validPixels: z.number().int().nonnegative(), validPercent: z.number(), pixelAreaM2: z.number(), validAreaKm2: z.number(), beforeMedianDb: nullableNumber, afterMedianDb: nullableNumber, medianChangeDb: nullableNumber, p05Db: nullableNumber, p95Db: nullableNumber, increasedAreaKm2: z.number(), decreasedAreaKm2: z.number(), withinThresholdAreaKm2: z.number() }),
  distributions: z.object({ before: distributionSchema, after: distributionSchema, difference: distributionSchema }),
  probe: sampleSchema.nullable(),
  transect: z.array(sampleSchema.extend({ distanceM: z.number().nonnegative() })).max(128),
  insights: z.array(z.string()),
  inspectionWindows: inspectionWindowsSchema.optional(),
  provenance: z.object({ algorithm: z.string(), crs: z.string(), beforeId: z.string(), afterId: z.string(), method: z.string(), units: z.literal("dB"), valueSource: z.literal("native-exported-rasters") }),
}).superRefine((value, ctx) => {
  const inspection = value.inspectionWindows;
  if (!inspection) return; // Earlier service results retain their original contract.
  const summary = value.summary;
  const cellArea = summary.pixelAreaM2 / 1e6;
  const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  const categories = [["increasedPixels", "increasedAreaKm2"], ["decreasedPixels", "decreasedAreaKm2"], ["withinThresholdPixels", "withinThresholdAreaKm2"]] as const;
  const inconsistentCategories = categories.some(([count, area]) => {
    const returnedArea = inspection.candidates.reduce((sum, candidate) => sum + candidate[count], 0) * cellArea;
    return !Number.isFinite(summary[area]) || summary[area] < 0 ||
      (returnedArea > summary[area] && !near(returnedArea, summary[area])) ||
      (inspection.omittedWindows === 0 && count !== "withinThresholdPixels" && !near(returnedArea, summary[area]));
  });
  if (!Number.isFinite(cellArea) || cellArea <= 0 || inspection.thresholdDb !== value.selection.thresholdDb || inspection.selectedPixels !== summary.totalPixels || inspection.validPixels !== summary.validPixels ||
      !near(summary.validAreaKm2, inspection.validPixels * cellArea) ||
      !near(summary.increasedAreaKm2 + summary.decreasedAreaKm2 + summary.withinThresholdAreaKm2, summary.validAreaKm2) ||
      inconsistentCategories || inspection.candidates.some(candidate => !near(candidate.exceededAreaKm2, (candidate.increasedPixels + candidate.decreasedPixels) * cellArea))) {
    ctx.addIssue({ code: "custom", message: "Inspection windows do not match the recorded analysis selection" });
  }
});
export const annotationRequestSchema = z.object({ label: z.enum(["water-change", "vegetation-change", "surface-change", "artifact", "uncertain"]), note: z.string().trim().min(1).max(1000), polygon: polygonSchema.nullable().optional() }).strict();
export const annotationSchema = annotationRequestSchema.extend({ id: z.string(), jobId: z.string(), createdAt: z.string(), version: z.number().int().positive(), status: z.literal("unverified-human-annotation") });
export type Coordinate = z.infer<typeof coordinateSchema>;
export type AnalysisRequest = z.input<typeof analysisRequestSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type AnalysisPolygon = z.infer<typeof polygonSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
