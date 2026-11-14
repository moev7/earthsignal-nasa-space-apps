import { forwardRadarRequest } from "./radar-gateway";
import { authenticatedUser } from "./local-auth";

export async function radarProxy(request: Request, path: string) {
  const user = await authenticatedUser(request);
  return forwardRadarRequest(request, path, {
    baseUrl: process.env.EARTHSIGNAL_PROCESSING_URL ?? "",
    secret: process.env.EARTHSIGNAL_GATEWAY_SECRET ?? "",
    userId: user?.id ?? null,
    publicOrigin:
      process.env.EARTHSIGNAL_PUBLIC_ORIGIN ?? new URL(request.url).origin,
    // Only a loopback endpoint is permitted over HTTP, including production.
    allowLocal: true,
  });
}
