import { areaExperimentProxy } from "@/lib/area-experiment-server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; action?: string[] }> };
async function proxy(request: Request, context: Context) {
  const { id, action = [] } = await context.params;
  return areaExperimentProxy(request, `/api/area-experiments/${encodeURIComponent(id)}${action.length ? "/" + action.map(encodeURIComponent).join("/") : ""}`);
}
export const GET = proxy;
export const POST = proxy;
