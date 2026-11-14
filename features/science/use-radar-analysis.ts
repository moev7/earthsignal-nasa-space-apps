import { useState, useEffect, useCallback, useRef } from "react";
import { analysisRequestSchema, analysisResultSchema, annotationRequestSchema, annotationSchema, type AnalysisRequest, type AnalysisResult, type Annotation } from "@/lib/analysis-contract";
import { z } from "zod";
export type AnnotationRequest = z.infer<typeof annotationRequestSchema>;
export type DrawingMode = "point" | "polygon" | "transect" | null;

async function responseData(res: Response) {
  const data = await res.json();
  if (!res.ok) {
    const parsed = z.object({ error: z.object({ message: z.string().optional() }).optional(), message: z.string().optional() }).safeParse(data);
    throw new Error((parsed.success && (parsed.data.error?.message ?? parsed.data.message)) || `Request failed (${res.status}). Sign in and retry.`);
  }
  return data;
}
export function useRadarAnalysis(jobId: string) {
  const [mode, setMode] = useState<DrawingMode>(null);
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [polygon, setPolygon] = useState<[number, number][]>([]);
  const [transect, setTransect] = useState<[[number, number], [number, number]] | null>(null);
  const [thresholdDb, setThresholdDb] = useState(3);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationsStatus, setAnnotationsStatus] = useState<"idle" | "loading" | "error">("idle");
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const noteController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);

  const fetchAnalysis = useCallback(async (request: AnalysisRequest) => {
    requestController.current?.abort();
    const controller = new AbortController(); requestController.current = controller;
    setStatus("loading"); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/change-jobs/${jobId}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(analysisRequestSchema.parse(request)), signal: controller.signal });
      const parsed = analysisResultSchema.parse(await responseData(res));
      if (parsed.jobId !== jobId) throw new Error("Analysis returned a different observation.");
      if (!controller.signal.aborted) { setResult(parsed); setStatus("success"); }
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Analysis failed."); setStatus("error"); }
    }
  }, [jobId]);

  const fetchAnnotations = useCallback(async () => {
    noteController.current?.abort();
    const controller = new AbortController(); noteController.current = controller;
    setAnnotationsStatus("loading"); setAnnotationError(null);
    try {
      const res = await fetch(`/api/change-jobs/${jobId}/annotations`, { signal: controller.signal });
      const parsed = z.object({ annotations: z.array(annotationSchema) }).parse(await responseData(res));
      if (parsed.annotations.some(a => a.jobId !== jobId)) throw new Error("Annotations returned a different observation.");
      if (!controller.signal.aborted) { setAnnotations(parsed.annotations); setAnnotationsStatus("idle"); }
    } catch (err) {
      if (!controller.signal.aborted) { setAnnotationsStatus("error"); setAnnotationError(err instanceof Error ? err.message : "Could not load annotations."); }
    }
  }, [jobId]);

  useEffect(() => {
    const reset = () => {
      saveController.current?.abort(); setSaving(false);
      setPoint(null); setPolygon([]); setTransect(null); setMode(null); setThresholdDb(3);
      setResult(null); setAnnotations([]); setAnnotationError(null);
      if (jobId) { void fetchAnalysis({ thresholdDb: 3 }); void fetchAnnotations(); }
    };
    reset();
    window.addEventListener("earthsignal-auth-changed", reset);
    return () => { window.removeEventListener("earthsignal-auth-changed", reset); requestController.current?.abort(); noteController.current?.abort(); saveController.current?.abort(); };
  }, [jobId, fetchAnalysis, fetchAnnotations]);

  const submitSelection = () => {
    const request: AnalysisRequest = { thresholdDb };
    if (point) request.point = point;
    if (polygon.length >= 3) {
      const coords = [...polygon];
      if (coords[0][0] !== coords.at(-1)![0] || coords[0][1] !== coords.at(-1)![1]) coords.push([...coords[0]]);
      request.polygon = { type: "Polygon", coordinates: [coords] };
    }
    if (transect) request.transect = transect;
    void fetchAnalysis(request);
  };
  const clearSelection = () => {
    setPoint(null); setPolygon([]); setTransect(null); setMode(null); setThresholdDb(3);
    void fetchAnalysis({ thresholdDb: 3 });
  };
  const inspectCoordinate = (coordinate: [number, number]) => {
    if (!result) return;
    // Restore the displayed analysis selection, rather than apply pending tool/slider edits.
    const selection = result.selection;
    setPoint(coordinate); setMode(null); setTransect(null);
    setPolygon(selection.polygon?.coordinates[0].slice(0, -1) ?? []);
    setThresholdDb(selection.thresholdDb);
    void fetchAnalysis({ ...selection, point: coordinate });
  };
  const addAnnotation = async (req: AnnotationRequest): Promise<boolean> => {
    if (saveController.current && !saveController.current.signal.aborted && saving) return false;
    const controller = new AbortController(); saveController.current = controller;
    setSaving(true); setAnnotationError(null);
    try {
      const res = await fetch(`/api/change-jobs/${jobId}/annotations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(annotationRequestSchema.parse(req)), signal: controller.signal });
      const parsed = annotationSchema.parse(await responseData(res));
      if (parsed.jobId !== jobId) throw new Error("Annotation returned a different observation.");
      if (controller.signal.aborted) return false;
      setAnnotations(prev => [...prev, parsed]); return true;
    } catch (err) {
      if (!controller.signal.aborted) setAnnotationError(err instanceof Error ? err.message : "Could not save annotation.");
      return false;
    } finally { if (!controller.signal.aborted) setSaving(false); }
  };
  return { mode, setMode, point, setPoint, polygon, setPolygon, transect, setTransect, thresholdDb, setThresholdDb, status, result, error, submitSelection, clearSelection, inspectCoordinate, annotations, annotationsStatus, annotationError, saving, addAnnotation, fetchAnnotations, fetchAnalysis };
}
