import { radarProxy } from "@/lib/radar-server";
export const dynamic = "force-dynamic";
async function forward(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return radarProxy(request, `/api/change-jobs/${encodeURIComponent(id)}/annotations`);
}
export const GET = forward;
export const POST = forward;
