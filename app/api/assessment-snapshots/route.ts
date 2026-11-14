import { observatoryProxy } from "@/lib/observatory-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return observatoryProxy(request, "/api/assessment-snapshots"); }
