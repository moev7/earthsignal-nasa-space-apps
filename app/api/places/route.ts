import { areaSchema } from "@/lib/observatory-contract";
import { authenticatedUser } from "@/lib/local-auth";
export const dynamic = "force-dynamic";
const stateKey = Symbol.for("earthsignal.place-search");
const store = globalThis as typeof globalThis & { [stateKey]?: { cache: Map<string, { at: number; places: unknown[] }>; nextRequestAt: number; busy: boolean } };
const state = store[stateKey] ??= { cache: new Map(), nextRequestAt: 0, busy: false };
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
export async function GET(request: Request) {
  if (!await authenticatedUser(request)) return response({ error: "Sign in for worldwide named-place and boundary search. Study anchors remain available." }, 401);
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 3 || query.length > 160 || /[\x00-\x1f]/.test(query)) return response({ error: "Enter a place name of 3–160 characters." }, 400);
  const cached = state.cache.get(query.toLowerCase());
  if (cached && cached.at > Date.now() - 21600000) return response({ places: cached.places });
  if (state.busy || Date.now() < state.nextRequestAt) return response({ error: "Place search is limited to one request per second. Try again shortly." }, 429);
  let url: URL;
  try { url = new URL(process.env.EARTHSIGNAL_PLACE_SEARCH_URL ?? "https://nominatim.openstreetmap.org/search"); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(); }
  catch { return response({error: "Place-search configuration is unavailable. Draw an area or use a study anchor."}, 503); }
  state.nextRequestAt = Date.now() + 1000;
  state.busy = true;
  url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "5", polygon_geojson: "1" }).toString();
  try {
    const upstream = await fetch(url, { headers: { "User-Agent": "Earthsignal/1.0 (+https://nasa.r8volt.com)", Accept: "application/json" }, redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
    if (!upstream.ok) throw new Error();
    const reader = upstream.body!.getReader(); let bytes = 0, reads = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const c = await reader.read(); if (c.done) break; if ((bytes += c.value.byteLength) > 512000 || ++reads > 4096) throw new Error(); chunks.push(c.value); } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const items = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Array<{display_name: string;geojson: unknown;boundingbox:string[]}>;
    const places = items.flatMap(item => {
      const geometry = areaSchema.safeParse(item.geojson);
      if (geometry.success) return [{ name: item.display_name, geometry: geometry.data }];
      const [s,n,w,e] = item.boundingbox.map(Number);
      const rectangle = areaSchema.safeParse({ type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]] });
      return rectangle.success ? [{ name: `${item.display_name} — bounding rectangle; full boundary unsupported`, geometry: rectangle.data }] : [];
    });
    if (state.cache.size >= 64) state.cache.delete(state.cache.keys().next().value!);
    state.cache.set(query.toLowerCase(), { at: Date.now(), places });
    return response({ places, attribution: "© OpenStreetMap contributors; Nominatim" });
  } catch { return response({ error: "Named-place search is unavailable or this boundary exceeds supported complexity. Draw a smaller area or upload bounded GeoJSON." }, 503); }
  finally { state.busy = false; }
}
