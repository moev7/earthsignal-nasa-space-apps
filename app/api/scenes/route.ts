import { querySchema, buildAsfUrl } from "@/features/catalog/domain";
import { parseAsfCatalog } from "@/features/catalog/asf";
export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Choose a supported product, location, and valid date range." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  const query = parsed.data;
  const queryUrl = buildAsfUrl(query);
  try {
    const response = await fetch(queryUrl, {
      headers: { Accept: "application/geo+json, application/json" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
    });
    if (!response.ok) throw new Error("Upstream catalog unavailable");
    const scenes = parseAsfCatalog(await response.json());
    return Response.json(
      {
        schemaVersion: "1.0",
        source: "ASF / NASA Earthdata",
        retrievedAt: new Date().toISOString(),
        query,
        queryUrl,
        limit: 24,
        scenes,
      },
      { headers: { "Cache-Control": query.point ? "private, no-store" : "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "The ASF catalog is temporarily unavailable. Your search has not been replaced with sample data. Try again shortly.",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
