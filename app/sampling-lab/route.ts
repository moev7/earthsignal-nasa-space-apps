import { authenticatedUser } from "@/lib/local-auth";
import { samplingLabPage } from "@/lib/sampling-lab-page";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return samplingLabPage(await authenticatedUser(request)); }
