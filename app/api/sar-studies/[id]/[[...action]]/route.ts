import { sarProxy } from "@/lib/sar-server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; action?: string[] }> };
async function handle(request: Request, context: Context) {
  const { id, action = [] } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(id) || action.some(part => !/^[A-Za-z0-9_.-]+$/.test(part)))
    return Response.json({ error: "Unsupported study path." }, { status: 400 });
  return sarProxy(request, `/api/sar-studies/${id}${action.length ? `/${action.join("/")}` : ""}`);
}
export const GET = handle;
export const POST = handle;
