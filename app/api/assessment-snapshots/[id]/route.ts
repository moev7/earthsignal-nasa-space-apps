import { observatoryProxy } from "@/lib/observatory-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) { const {id}=await params; return observatoryProxy(request, `/api/assessment-snapshots/${encodeURIComponent(id)}`); }
