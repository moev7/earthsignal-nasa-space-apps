import { z } from "zod";
import { sarRecordSchema } from "./sar-contract";
import { verifyPublicManifest, type PublicStudy } from "./public-study-registry";
const file = z.object({ bytes: z.number().int().nonnegative().max(8 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const publishedSarSchema = z.object({
  schema: z.literal("earthsignal.sar-public-study/1"), id: z.string(), title: z.string(),
  sourceId: z.enum(["nisar", "radarsat-1", "rcm", "uavsar"]), operation: z.string(), channel: z.string(), quantity: z.string(),
  unit: z.enum(["dB", "mm", "meters", "source units"]),
  grid: z.object({ width: z.number().int().positive().max(262144), height: z.number().int().positive().max(262144), crs: z.string(), transform: z.array(z.number().finite()).length(6) }),
  coverage: z.object({ total: z.number().int(), valid: z.number().int(), fraction: z.number().min(0).max(1) }),
  stats: z.object({ min: z.number().finite(), median: z.number().finite(), max: z.number().finite() }),
  records: z.array(sarRecordSchema).min(1).max(2), notices: z.array(z.string()),
  rights: z.object({ license: z.string(), url: z.string().url(), credit: z.string() }),
  method: z.string(), processedAt: z.string(), files: z.object({ "values.json": file, "preview.png": file, "provenance.json": file }),
});
export type PublishedSar = z.infer<typeof publishedSarSchema>;
const decoder = new TextDecoder();
async function bytes(url: string, signal: AbortSignal, fetcher: typeof fetch) {
  const r = await fetcher(url, { signal, credentials: "omit", redirect: "error" });
  if (!r.ok || !r.body) throw Error("Published artifact is unavailable.");
  const reader = r.body.getReader(); const parts: Uint8Array[] = []; let total = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > 8 * 1024 * 1024) throw Error("Published artifact exceeds its size limit."); parts.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const out = new Uint8Array(total); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
}
async function checked(raw: Uint8Array, proof: { bytes: number; sha256: string }) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw))), b => b.toString(16).padStart(2, "0")).join("");
  if (raw.length !== proof.bytes || hash !== proof.sha256) throw Error("Published artifact does not match its reviewed revision.");
}
export async function loadPublishedSar(study: PublicStudy, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const raw = await bytes(study.manifestUrl, signal, fetcher); await verifyPublicManifest(study, raw);
  const manifest = publishedSarSchema.parse(JSON.parse(decoder.decode(raw)));
  if (manifest.id !== study.id || manifest.unit !== study.unit || manifest.sourceId !== study.sourceId || manifest.grid.width * manifest.grid.height > 262144) throw Error("Published study identity or native grid changed.");
  const base = study.manifestUrl.slice(0, -"manifest.json".length);
  const [valueBytes, imageBytes] = await Promise.all(["values.json", "preview.png"].map(async name => {
    const data = await bytes(base + name, signal, fetcher); await checked(data, manifest.files[name as "values.json" | "preview.png"]); return data;
  }));
  const values = z.object({ width: z.number(), height: z.number(), unit: z.string(), values: z.array(z.number().finite().nullable()).max(262144) }).parse(JSON.parse(decoder.decode(valueBytes)));
  if (values.width !== manifest.grid.width || values.height !== manifest.grid.height || values.values.length !== values.width * values.height || values.unit !== manifest.unit) throw Error("Published samples disagree with their native grid.");
  const valid = values.values.filter((v): v is number => v !== null);
  if (valid.length !== manifest.coverage.valid || values.values.length !== manifest.coverage.total || valid.length / values.values.length !== manifest.coverage.fraction) throw Error("Published validity population changed.");
  return { manifest, values: values.values, imageBytes };
}
