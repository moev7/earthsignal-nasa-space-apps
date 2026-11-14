import { areaExperimentProxy } from "@/lib/area-experiment-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return areaExperimentProxy(request, "/api/area-experiments"); }
export async function POST(request: Request) { return areaExperimentProxy(request, "/api/area-experiments"); }
