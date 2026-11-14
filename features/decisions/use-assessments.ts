"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { assessmentJobSchema, assessmentResultSchema, scenarioJobSchema, sourceSchema, type Assessment, type AssessmentJob, type AssessmentRequest, type ScenarioJob, type ScenarioRequest, type ObservatorySource } from "@/lib/observatory-contract";
export type Snapshot = { id: string; sourceJobId: string; createdAt: string; artifactExpiresAt: string | null; manifestHash: string; manifest: Assessment };
export async function apiJSON(path: string, init?: RequestInit) {
  const r = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const data = await r.json();
  if (!r.ok) { const issue = z.object({ error: z.union([z.string(), z.object({ message: z.string() })]).optional(), message: z.string().optional() }).safeParse(data);
    throw new Error(issue.success ? (typeof issue.data.error === "string" ? issue.data.error : issue.data.error?.message) ?? issue.data.message ?? "The request could not be completed." : "The request could not be completed."); }
  return data;
}
const snapshotSchema = z.object({ id: z.string(), sourceJobId: z.string(), createdAt: z.string(), artifactExpiresAt: z.string().nullable(), manifestHash: z.string(), manifest: assessmentResultSchema });
export function useAssessments() {
  const [jobs, setJobs] = useState<AssessmentJob[]>([]), [scenarios, setScenarios] = useState<ScenarioJob[]>([]), [sources, setSources] = useState<ObservatorySource[]>([]), [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [enabledDomains, setEnabledDomains] = useState<string[]>([]), [scenariosEnabled, setScenariosEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [selectedId, setSelectedId] = useState<string | null>(null);
  const identityEpoch = useRef(0), pending = useRef<{body: string; key: string} | null>(null), pendingScenario = useRef<{body: string; key: string} | null>(null);
  const refresh = useCallback(async () => {
    const epoch = identityEpoch.current;
    try {
      const data = await apiJSON("/api/assessments");
      if (epoch !== identityEpoch.current) return;
      setJobs(z.object({ jobs: z.array(assessmentJobSchema) }).parse(data).jobs); setError(null);
      const secondary = await Promise.allSettled([apiJSON("/api/sources"), apiJSON("/api/scenarios"), apiJSON("/api/assessment-snapshots")]);
      if (epoch !== identityEpoch.current) return;
      if (secondary[0].status === "fulfilled") { const config = z.object({sources:z.array(sourceSchema),assessmentDomains:z.array(z.string()).default([]),scenariosEnabled:z.boolean().default(false)}).parse(secondary[0].value); setSources(config.sources); setEnabledDomains(config.assessmentDomains); setScenariosEnabled(config.scenariosEnabled); }
      if (secondary[1].status === "fulfilled") setScenarios(z.object({ jobs: z.array(scenarioJobSchema) }).parse(secondary[1].value).jobs);
      if (secondary[2].status === "fulfilled") setSnapshots(z.object({ snapshots: z.array(snapshotSchema) }).parse(secondary[2].value).snapshots);
    } catch (e) { if (epoch === identityEpoch.current) { setError(e instanceof Error ? e.message : "Assessment history is unavailable."); setJobs([]); setScenarios([]); setSnapshots([]); } }
  }, []);
  useEffect(() => {
    let alive = true; const identityCounter = identityEpoch;
    queueMicrotask(() => { if (alive) void refresh(); });
    const changed = () => { identityEpoch.current++; setJobs([]); setSnapshots([]); setScenarios([]); setSources([]); setEnabledDomains([]); setScenariosEnabled(false); setSelectedId(null); pending.current = null; pendingScenario.current = null; setBusy(false); void refresh(); };
    window.addEventListener("earthsignal-auth-changed", changed);
    return () => { alive = false; identityCounter.current++; window.removeEventListener("earthsignal-auth-changed", changed); };
  }, [refresh]);
  useEffect(() => {
    if (![...jobs, ...scenarios].some(j => j.status === "queued" || j.status === "running")) return;
    const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer);
  }, [jobs, scenarios, refresh]);
  const submit = async (request: AssessmentRequest) => {
    const body = JSON.stringify(request), epoch = identityEpoch.current;
    if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError(null);
    try {
      const job = assessmentJobSchema.parse(await apiJSON("/api/assessments", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current!.key }, body }));
      if (epoch !== identityEpoch.current) return;
      setSelectedId(job.id); setJobs(old => [job, ...old.filter(j => j.id !== job.id)]); pending.current = null;
    } catch (e) { if (epoch === identityEpoch.current) setError(e instanceof Error ? e.message : "Submission failed."); }
    finally { if (epoch === identityEpoch.current) setBusy(false); }
  };
  const action = async (path: string, request?: ScenarioRequest) => {
    const epoch = identityEpoch.current, body = JSON.stringify(request ?? {});
    if (request && pendingScenario.current?.body !== body) pendingScenario.current = {body, key: crypto.randomUUID()};
    setBusy(true); setError(null);
    try {
      await apiJSON(path, { method: "POST", headers: { "Content-Type": "application/json", ...(request ? { "Idempotency-Key": pendingScenario.current!.key } : {}) }, body });
      if (epoch === identityEpoch.current) { if (request) pendingScenario.current = null; await refresh(); }
    } catch (e) { if (epoch === identityEpoch.current) setError(e instanceof Error ? e.message : "Request failed."); }
    finally { if (epoch === identityEpoch.current) setBusy(false); }
  };
  return { jobs, scenarios, sources, enabledDomains, scenariosEnabled, snapshots, error, busy, selectedId, setSelectedId, submit, action, refresh };
}
