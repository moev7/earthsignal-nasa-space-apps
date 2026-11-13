import { CHALLENGE_RESOURCES, CHALLENGE_VERSION, MAIN_EXPERIENCE, OFFICIAL_CHALLENGE_RESOURCES, SOURCE_READINESS } from "@/lib/challenge-resources";
export async function GET() {
  return Response.json({ schemaVersion: "1.0", version: CHALLENGE_VERSION, resources: CHALLENGE_RESOURCES, officialInventory: OFFICIAL_CHALLENGE_RESOURCES, mainExperience: MAIN_EXPERIENCE, readiness: SOURCE_READINESS,
    notice: "Resources include discovery, methods and interpretation. A listed resource is not a verified pixel measurement." },
  { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
