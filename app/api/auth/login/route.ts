import { authRoute } from "@/lib/local-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return authRoute(request, "login"); }
