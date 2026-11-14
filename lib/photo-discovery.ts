import { defaultQuery, querySchema, type CatalogQuery } from "@/features/catalog/domain";
import { coordinateInput } from "./study-rectangle";
import type { AssessmentArea } from "./observatory-contract";
export type PhotoPoint = { longitude: number; latitude: number };

/** A search point is not a claim about the photographed subject or a measurement footprint. */
export function photoCatalogQuery(point: PhotoPoint, start: string, end: string): CatalogQuery {
  return { region: "global", product: "GCOV", start, end, point: `${coordinateInput(point.longitude)},${coordinateInput(point.latitude)}` };
}
export function photoDefaultDates() {
  const { start, end } = defaultQuery();
  return { start, end };
}
/** Keep recovery messages aligned with the catalog's real date contract. */
export function photoDateErrors(start: string, end: string): { start?: string; end?: string } {
  const result = querySchema.safeParse(photoCatalogQuery({ longitude: 0, latitude: 0 }, start, end));
  if (result.success) return {};
  const errors: { start?: string; end?: string } = {};
  let reversed = false;
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field !== "start" && field !== "end") continue;
    if (issue.message === "Start must be before end") { reversed = true; continue; }
    errors[field] = `Choose a valid ${field === "start" ? "start" : "end"} date.`;
  }
  if (reversed && !errors.start && !errors.end) errors.end = "Choose an end date on or after the start date.";
  return errors;
}
/** A small editable starting area, clipped at the existing assessment contract limits. */
export function photoStudyArea(point: PhotoPoint): AssessmentArea | null {
  if (!Number.isFinite(point.longitude) || !Number.isFinite(point.latitude) || Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 85) return null;
  const w = Math.max(-180, point.longitude - .005), e = Math.min(180, point.longitude + .005);
  const s = Math.max(-85, point.latitude - .005), n = Math.min(85, point.latitude + .005);
  return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}
