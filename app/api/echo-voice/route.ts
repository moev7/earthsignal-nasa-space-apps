import { serveEchoVoice } from "@/lib/echo-voice-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return serveEchoVoice(request);
}
