import { radarProxy } from "@/lib/radar-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return radarProxy(request, "/api/change-jobs");
}
export async function POST(request: Request) {
  return radarProxy(request, "/api/change-jobs");
}
