import { sarProxy } from "@/lib/sar-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return sarProxy(request, "/api/sar-studies/search"); }
