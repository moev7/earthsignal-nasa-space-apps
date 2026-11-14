import { useEffect, useState, useCallback, useRef } from "react";
import {
  changeJobSchema,
  changeListSchema,
  type ChangeJob,
  type ChangeRequest,
} from "@/lib/radar-contract";

export type RadarJobsState = {
  status: "loading" | "ready" | "error" | "auth" | "unconfigured";
  error: string | null;
  jobs: ChangeJob[];
  capability: { ready: boolean; message: string; maxPixels: number } | null;
  submitting: boolean;
  submitJob: (req: ChangeRequest) => Promise<ChangeJob>;
  cancelJob: (id: string) => Promise<void>;
  refresh: () => void;
};
async function responseError(response: Response) {
  try {
    const value = await response.json();
    if (value && typeof value === "object" && "error" in value) {
      if (typeof value.error === "string") return value.error;
      if (
        value.error &&
        typeof value.error === "object" &&
        "message" in value.error &&
        typeof value.error.message === "string"
      )
        return value.error.message;
    }
    return `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}
export function useRadarJobs(): RadarJobsState {
  const [status, setStatus] = useState<RadarJobsState["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ChangeJob[]>([]);
  const [capability, setCapability] =
    useState<RadarJobsState["capability"]>(null);
  const [submitting, setSubmitting] = useState(false);
  const submission = useRef(false);
  const pending = useRef<{ request: string; key: string } | null>(null);
  const sequence = useRef(0);
  const fetchJobs = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    try {
      const res = await fetch("/api/change-jobs", {
        signal,
        cache: "no-store",
      });
      if (signal?.aborted || current !== sequence.current) return;
      if (res.status === 401 || res.status === 403 || res.status === 503) {
        setJobs([]);
        setCapability(null);
        setError(await responseError(res));
        setStatus(res.status === 503 ? "unconfigured" : "auth");
        return;
      }
      if (!res.ok) throw new Error(await responseError(res));
      const data = changeListSchema.parse(await res.json());
      if (signal?.aborted || current !== sequence.current) return;
      setJobs(data.jobs);
      setCapability(data.capability);
      setStatus("ready");
      setError(null);
    } catch (err) {
      if (signal?.aborted || current !== sequence.current) return;
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load processing history.",
      );
    }
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    queueMicrotask(() => {
      if (!ac.signal.aborted) void fetchJobs(ac.signal);
    });
    return () => {
      ac.abort();
    };
  }, [fetchJobs]);
  useEffect(() => {
    const changed = () => {
      sequence.current++;
      pending.current = null;
      setJobs([]);
      setCapability(null);
      void fetchJobs();
    };
    window.addEventListener("earthsignal-auth-changed", changed);
    return () =>
      window.removeEventListener("earthsignal-auth-changed", changed);
  }, [fetchJobs]);
  const active = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const canPoll = status !== "auth" && status !== "unconfigured";
  useEffect(() => {
    if (!active || !canPoll) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await fetchJobs(ac.signal);
      if (!ac.signal.aborted) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [active, canPoll, fetchJobs]);
  const submitJob = async (req: ChangeRequest) => {
    if (submission.current)
      throw new Error("A submission is already in progress.");
    submission.current = true;
    setSubmitting(true);
    const encoded = JSON.stringify(req);
    if (pending.current?.request !== encoded)
      pending.current = { request: encoded, key: crypto.randomUUID() };
    try {
      const res = await fetch("/api/change-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.current!.key,
        },
        body: encoded,
      });
      if (!res.ok) {
        if (res.status < 500) pending.current = null;
        throw new Error(await responseError(res));
      }
      const job = changeJobSchema.parse(await res.json());
      pending.current = null;
      sequence.current++;
      setJobs((previous) => [job, ...previous.filter((j) => j.id !== job.id)]);
      setStatus("ready");
      return job;
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  };
  const cancelJob = async (id: string) => {
    const res = await fetch(
      `/api/change-jobs/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!res.ok) throw new Error(await responseError(res));
    const job = changeJobSchema.parse(await res.json());
    sequence.current++;
    setJobs((previous) => previous.map((j) => (j.id === id ? job : j)));
  };
  return {
    status,
    error,
    jobs,
    capability,
    submitting,
    submitJob,
    cancelJob,
    refresh: () => {
      void fetchJobs();
    },
  };
}
