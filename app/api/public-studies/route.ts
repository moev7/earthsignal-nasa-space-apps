import { PUBLIC_STUDIES } from "@/lib/public-study-registry";
export async function GET() {
  return Response.json({ schemaVersion: "1.0", studies: PUBLIC_STUDIES }, { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
