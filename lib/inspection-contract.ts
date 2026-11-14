import { z } from "zod";

const count = z.number().int().min(0).max(1_000_000);
const coordinate = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const candidateSchema = z.object({
  window: z.object({ rowStart: count, rowEndExclusive: count, columnStart: count, columnEndExclusive: count }).strict(),
  selectedPixels: count, validPixels: count, unknownPixels: count,
  increasedPixels: count, decreasedPixels: count, withinThresholdPixels: count,
  exceededAreaKm2: z.number().finite().nonnegative(), validPercent: z.number().finite().min(0).max(100),
  representative: z.object({ row: count, column: count, differenceDb: z.number().finite(), coordinate: coordinate.nullable(), coordinateStatus: z.enum(["available", "unavailable"]) }).strict(),
}).strict();

export const inspectionWindowsSchema = z.object({
  schemaVersion: z.literal("native-inspection-windows-v1"),
  blockSizePixels: z.literal(32), limit: z.literal(12), thresholdDb: z.number().finite().min(0.1).max(30),
  selectedPixels: count, validPixels: count, unknownPixels: count,
  candidateWindows: count, returnedWindows: count, omittedWindows: count,
  status: z.enum(["candidates", "no_threshold_candidates", "withheld_no_valid_support"]),
  ranking: z.literal("exceeded-pixel-count_then_peak-absolute-db_then_native-order"),
  candidates: z.array(candidateSchema).max(12), limitations: z.array(z.string()).max(16),
}).strict().superRefine((value, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "Inspection windows do not reconcile with their native support or ranking" });
  if (value.validPixels + value.unknownPixels !== value.selectedPixels || value.returnedWindows !== value.candidates.length || value.candidateWindows !== value.candidates.length + value.omittedWindows || value.candidates.length !== Math.min(value.candidateWindows, value.limit)) fail();
  if ((value.status === "candidates") !== (value.candidateWindows > 0) || (value.status === "withheld_no_valid_support") !== (value.validPixels === 0)) fail();
  const windows = new Set<string>();
  let returnedSelected = 0, returnedValid = 0, returnedUnknown = 0;
  value.candidates.forEach((candidate, index) => {
    const w = candidate.window, p = candidate.representative;
    const height = w.rowEndExclusive - w.rowStart, width = w.columnEndExclusive - w.columnStart;
    const exceeded = candidate.increasedPixels + candidate.decreasedPixels;
    const key = `${w.rowStart}:${w.columnStart}`;
    if (windows.has(key) || w.rowStart % 32 || w.columnStart % 32 || height <= 0 || height > 32 || width <= 0 || width > 32 || candidate.selectedPixels > height * width) fail();
    windows.add(key);
    if (!exceeded || candidate.validPixels + candidate.unknownPixels !== candidate.selectedPixels || exceeded + candidate.withinThresholdPixels !== candidate.validPixels || candidate.exceededAreaKm2 <= 0 || Math.abs(candidate.validPercent - 100 * candidate.validPixels / candidate.selectedPixels) > 1e-7) fail();
    if (p.row < w.rowStart || p.row >= w.rowEndExclusive || p.column < w.columnStart || p.column >= w.columnEndExclusive || Math.abs(p.differenceDb) <= value.thresholdDb || (p.coordinateStatus === "available") !== (p.coordinate !== null)) fail();
    if ((p.differenceDb > 0 && candidate.increasedPixels === 0) || (p.differenceDb < 0 && candidate.decreasedPixels === 0)) fail();
    const previous = value.candidates[index - 1];
    if (previous) {
      const previousCount = previous.increasedPixels + previous.decreasedPixels;
      const previousPeak = Math.abs(previous.representative.differenceDb), peak = Math.abs(p.differenceDb);
      if (exceeded > previousCount || (exceeded === previousCount && (peak > previousPeak || (peak === previousPeak && (w.rowStart < previous.window.rowStart || (w.rowStart === previous.window.rowStart && w.columnStart < previous.window.columnStart)))))) fail();
    }
    returnedSelected += candidate.selectedPixels;
    returnedValid += candidate.validPixels;
    returnedUnknown += candidate.unknownPixels;
  });
  if (returnedSelected > value.selectedPixels || returnedValid > value.validPixels || returnedUnknown > value.unknownPixels) fail();
});

export type InspectionWindows = z.infer<typeof inspectionWindowsSchema>;
export type InspectionCandidate = InspectionWindows["candidates"][number];
