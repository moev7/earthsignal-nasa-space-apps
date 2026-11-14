import { gaugeVintageSchema, type GaugeVintage } from "./gauge-vintage-contract";

export type ReferencedVintage = Extract<GaugeVintage, { status: "referenced" }>;
export type ReceiptSnapshot = Extract<GaugeVintage, { status: "captured" }>["snapshot"];

/** Verify an explicit same-owner response; neither a summary nor a self-hash proves reproduction. */
export async function verifyReceiptSnapshot(response: Response, input: ReferencedVintage, signal?: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; snapshot: ReceiptSnapshot }> {
  let reference: ReferencedVintage;
  let snapshot: ReceiptSnapshot;
  try {
    const parsed = gaugeVintageSchema.parse(input);
    if (parsed.status !== "referenced") throw new Error();
    reference = parsed;
  } catch { await response.body?.cancel().catch(() => {}); throw new Error("Saved receipt metadata is invalid."); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(response.status === 401 || response.status === 403 ? "Sign in again to retrieve this receipt." : "The full receipt is unavailable. The saved summary cannot replace the original file.");
  }
  if (!response.body) throw new Error("The full receipt is unavailable.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0, reads = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > reference.artifact.bytes || ++reads > 4096) throw new Error("Receipt size does not match this saved result.");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (total !== reference.artifact.bytes) throw new Error("The received file is incomplete.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  signal?.throwIfAborted();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  signal?.throwIfAborted();
  if (digest !== reference.artifact.sha256) throw new Error("Receipt integrity check failed. This file does not match the saved result.");
  try {
    const parsed = gaugeVintageSchema.parse({ status: "captured", receipt: reference.receipt, snapshot: JSON.parse(new TextDecoder().decode(bytes)) });
    if (parsed.status !== "captured") throw new Error();
    snapshot = parsed.snapshot;
    const summary = reference.snapshotRef;
    for (const key of ["policyVersion", "availabilityBasis", "issueTime", "start", "end", "calendarDays", "unknownDays", "snapshotHash"] as const) {
      if (snapshot[key] !== summary[key]) throw new Error();
    }
    for (const key of ["station", "timeSeriesId", "parameter", "statistic", "unit"] as const) if (snapshot.identity[key] !== summary.identity[key]) throw new Error();
    if (snapshot.observations.length !== summary.observationCount || snapshot.observations.filter(row => row.qualifiers.length > 0).length !== summary.qualifiedRecords || snapshot.observations.filter(row => row.value === null).length !== summary.withdrawnRecords) throw new Error();
  } catch { throw new Error("Receipt contents do not match the saved snapshot metadata."); }
  signal?.throwIfAborted();
  return { bytes, snapshot };
}

/** Compatibility path for callers that only save the checked bytes. */
export async function verifyReceiptResponse(response: Response, input: ReferencedVintage, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  return (await verifyReceiptSnapshot(response, input, signal)).bytes;
}
