import { z } from "zod";
import registry from "@/public/data/challenge/studies.json";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const publicStudySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string(),
    kind: z.enum(["ground-motion-rate", "radar-backscatter-change", "radar-backscatter-observation", "native-observation", "los-displacement", "pixel-offset"]),
    unit: z.enum(["mm/year", "dB", "mm", "meters", "source units"]),
    sourceId: z.enum(["nisar", "radarsat-1", "rcm", "saocom", "uavsar"]),
    revision: z.string().regex(/^[a-f0-9]{16}$/),
    manifestUrl: z
      .string()
      .regex(/^\/data\/(?:(?:nisar|radar)\/[a-z0-9-]+|sar\/[a-z0-9-]+\/[a-f0-9]{16})\/manifest\.json$/),
    manifestSha256: digest,
    manifestBytes: z.number().int().positive(),
    period: z.object({ start: z.string(), end: z.string() }),
    maturity: z.enum(["provisional", "validated", "source-defined"]),
    coverageFraction: z.number().min(0).max(1),
    href: z.string().startsWith("/"),
    notice: z.string(),
    files: z.record(
      z.object({ bytes: z.number().int().nonnegative(), sha256: digest }),
    ),
  })
  .superRefine((s, ctx) => {
    const units = { "ground-motion-rate": "mm/year", "radar-backscatter-change": "dB", "radar-backscatter-observation": "dB", "native-observation": "source units", "los-displacement": "mm", "pixel-offset": "meters" };
    if (units[s.kind] !== s.unit || !s.manifestSha256.startsWith(s.revision))
      ctx.addIssue({ code: "custom", message: "Study quantity or revision mismatch" });
    const legacy = s.manifestUrl.startsWith("/data/nisar/") || s.manifestUrl.startsWith("/data/radar/");
    if (legacy && (s.sourceId !== "nisar" || !["ground-motion-rate", "radar-backscatter-change"].includes(s.kind)))
      ctx.addIssue({ code: "custom", message: "Legacy study source mismatch" });
    const expected = legacy
      ? `/data/${s.kind === "ground-motion-rate" ? "nisar" : "radar"}/${s.id}/manifest.json`
      : `/data/sar/${s.id}/${s.revision}/manifest.json`;
    if (
      s.manifestUrl !== expected ||
      Object.keys(s.files).some(
        (name) =>
          !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)?$/.test(
            name,
          ) || name.split("/").some((p) => p === "." || p === ".."),
      )
    )
      ctx.addIssue({ code: "custom", message: "Unsafe study artifact path" });
  });
export const publicStudyRegistrySchema = z.object({
  schemaVersion: z.literal("1.0"),
  studies: z.array(publicStudySchema).max(128),
});
export const PUBLIC_STUDIES = publicStudyRegistrySchema.parse(registry).studies;
export type PublicStudy = z.infer<typeof publicStudySchema>;
export function publicStudy(id: string, revision?: string | null) {
  return (
    PUBLIC_STUDIES.find(
      (s) => s.id === id && (revision == null || s.revision === revision),
    ) ?? null
  );
}
export async function verifyPublicManifest(
  study: PublicStudy,
  raw: Uint8Array,
) {
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (raw.byteLength !== study.manifestBytes || hash !== study.manifestSha256)
    throw Error("Published manifest does not match its reviewed revision.");
}
