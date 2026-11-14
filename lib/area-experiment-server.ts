import { authenticatedUser } from "./local-auth";
import { forwardAreaRequest } from "./area-experiment-gateway";
export async function areaExperimentProxy(request: Request, path: string) {
  const user = await authenticatedUser(request);
  return forwardAreaRequest(request, path, { userId: user?.id ?? null, baseUrl: process.env.EARTHSIGNAL_PROCESSING_URL ?? "",
    secret: process.env.EARTHSIGNAL_GATEWAY_SECRET ?? "", publicOrigin: process.env.EARTHSIGNAL_PUBLIC_ORIGIN ?? new URL(request.url).origin, allowLocal: true });
}
