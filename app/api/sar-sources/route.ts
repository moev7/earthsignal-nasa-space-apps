import { SAR_SOURCES, SOURCE_READINESS } from "@/lib/challenge-resources";
export async function GET() {
  return Response.json({ schemaVersion: "1.0", sources: SAR_SOURCES, readiness: SOURCE_READINESS,
    notice: "Native support, access and grid compatibility are checked by the science service during explicit preflight. Source listing is not evidence of processing readiness." },
  { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
