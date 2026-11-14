import { radarProxy } from "@/lib/radar-server";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  return radarProxy(
    request,
    `/api/change-jobs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`,
  );
}
