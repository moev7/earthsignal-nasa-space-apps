import { authenticatedUser } from "./local-auth";
import { forwardSarRequest } from "./sar-gateway";
export async function sarProxy(request: Request, path: string) {
  const user = await authenticatedUser(request);
  return forwardSarRequest(request, path, {
    userId: user?.id ?? null,
    baseUrl: process.env.EARTHSIGNAL_PROCESSING_URL ?? "",
    secret: process.env.EARTHSIGNAL_GATEWAY_SECRET ?? "",
    publicOrigin:
      process.env.EARTHSIGNAL_PUBLIC_ORIGIN ?? new URL(request.url).origin,
    allowLocal: true,
  });
}
