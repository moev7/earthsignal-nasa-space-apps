"use client";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { assessmentArtifactUrl } from "@/lib/observatory-contract";
import { verifyReceiptSnapshot, type ReferencedVintage } from "@/lib/gauge-receipt-download";
import { summarizeGaugeQuality, type GaugeQualitySummary } from "@/lib/gauge-source-quality";
import { GaugeSourceQuality } from "./gauge-source-quality";

export function GaugeReceiptDownload({ vintage, jobId, artifactExpiresAt }: { vintage: ReferencedVintage; jobId?: string | null; artifactExpiresAt?: string | null }) {
  const context = `${jobId ?? ""}:${vintage.artifact.sha256}:${artifactExpiresAt ?? ""}`;
  return <ReceiptDownload key={context} vintage={vintage} jobId={jobId} artifactExpiresAt={artifactExpiresAt} />;
}

function ReceiptDownload({ vintage, jobId, artifactExpiresAt }: { vintage: ReferencedVintage; jobId?: string | null; artifactExpiresAt?: string | null }) {
  const expires = artifactExpiresAt ? Date.parse(artifactExpiresAt) : NaN;
  const received = Date.parse(vintage.receipt.receivedAt);
  const subscribeExpiry = useCallback((notify: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      notify();
      const remaining = expires - Date.now();
      if (remaining > 0) timer = setTimeout(check, Math.min(remaining + 1, 2_147_483_647));
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [expires]);
  const readExpiry = useCallback(() => Number.isFinite(expires) && expires <= Date.now(), [expires]);
  // SSR can prove expiry before the recorded receipt, otherwise defer availability
  // to the subscribed clock. The identical hydration snapshot avoids clock drift.
  const serverExpiry = useCallback(() => !Number.isFinite(expires) ? false : expires <= received ? true : null, [expires, received]);
  const expired = useSyncExternalStore(subscribeExpiry, readExpiry, serverExpiry);
  const [state, setState] = useState<"stored" | "loading" | "checked" | "error">("stored"), [message, setMessage] = useState("");
  const [checked, setChecked] = useState<{ context: string; summary: GaugeQualitySummary } | null>(null);
  const context = `${jobId ?? ""}:${vintage.artifact.sha256}:${artifactExpiresAt ?? ""}`;
  const epoch = useRef(0), active = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const currentEpoch = epoch, currentActive = active;
    const reset = () => { epoch.current++; active.current?.abort(); active.current = null; setState("stored"); setMessage(""); setChecked(null); };
    window.addEventListener("earthsignal-auth-changed", reset);
    return () => { currentEpoch.current++; currentActive.current?.abort(); window.removeEventListener("earthsignal-auth-changed", reset); };
  }, []);
  const retrieve = async (intent: "inspect" | "download") => {
    if (!jobId || active.current || (artifactExpiresAt && Date.parse(artifactExpiresAt) <= Date.now())) return;
    const current = ++epoch.current, controller = new AbortController();
    active.current = controller;
    setState("loading"); setMessage(""); setChecked(null);
    try {
      const response = await fetch(assessmentArtifactUrl(jobId, vintage.artifact.name), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const { bytes, snapshot } = await verifyReceiptSnapshot(response, vintage, controller.signal);
      if (current !== epoch.current || controller.signal.aborted || (Number.isFinite(expires) && expires <= Date.now())) return;
      if (intent === "download") {
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "earthsignal-received-snapshot.json"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setChecked({ context, summary: summarizeGaugeQuality(snapshot) });
      setState("checked"); setMessage(intent === "download" ? "Download integrity checked. The file and receipt identity match; calculations have not been rerun." : "Source profile read from the integrity-checked receipt. Calculations have not been rerun.");
    } catch (error) {
      if (current !== epoch.current || controller.signal.aborted) return;
      setState("error"); setMessage(error instanceof Error ? error.message : "The full receipt is unavailable.");
    } finally { if (current === epoch.current) active.current = null; }
  };
  return <div className="gauge-receipt-download">
    <p>{expired ? "The full received snapshot has expired. This saved summary preserves the recorded history and timing; full reproduction requires the original file." : "The full received snapshot is stored separately. This summary cannot replace the original file for reproduction."}</p>
    {expired === false && jobId && <div className="gauge-receipt-actions">
      <button type="button" className="science-return" disabled={state === "loading"} onClick={() => void retrieve("inspect")}>{state === "loading" ? "Checking received snapshot…" : "Inspect source quality"}</button>
      <button type="button" className="science-return" disabled={state === "loading"} onClick={() => void retrieve("download")}>{`Download received snapshot · ${(vintage.artifact.bytes / 1024 / 1024).toFixed(2)} MB`}</button>
    </div>}
    {!jobId && <p>Open the original assessment to retrieve its protected receipt.</p>}
    {message && <p role={state === "error" ? "alert" : "status"}>{message}</p>}
    {expired === false && checked?.context === context && <GaugeSourceQuality summary={checked.summary} basis="file" />}
    <details><summary>File integrity details</summary><p>Exact file SHA256: <code>{vintage.artifact.sha256}</code></p><p>Snapshot SHA256: <code>{vintage.snapshotRef.snapshotHash}</code></p><p>Hashes preserve identity and integrity; they do not establish earlier upstream availability or predictive accuracy.</p></details>
  </div>;
}
