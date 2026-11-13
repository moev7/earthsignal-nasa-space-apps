import { publicStudy } from "@/lib/public-study-registry";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const query = new URL(request.url).searchParams;
  const study = publicStudy((await params).id, query.get("revision"));
  if (!study || query.getAll("revision").length > 1 || [...query.keys()].some(k => k !== "revision"))
    return Response.json({ error: "Published study revision not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json({ schemaVersion: "1.0", study }, { headers: { "Cache-Control": query.has("revision") ? "public, max-age=31536000, immutable" : "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
