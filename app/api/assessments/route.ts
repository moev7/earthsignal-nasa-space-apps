import { observatoryProxy } from "@/lib/observatory-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return observatoryProxy(request, "/api/assessments"); }
export async function POST(request: Request) { return observatoryProxy(request, "/api/assessments"); }
