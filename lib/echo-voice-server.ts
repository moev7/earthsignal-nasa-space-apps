import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import catalog from "./echo-voice.json";
export type EchoVoiceId = keyof typeof catalog.cues;
export function voiceId(value: string | null): value is EchoVoiceId {
  return (
    value !== null && Object.prototype.hasOwnProperty.call(catalog.cues, value)
  );
}
export function voiceDigest(cue: EchoVoiceId) {
  return createHash("sha256")
    .update(
      [
        catalog.version,
        catalog.model,
        catalog.voice,
        catalog.speed,
        cue,
        catalog.cues[cue],
      ].join("\n"),
    )
    .digest("hex");
}
/** The operator renderer emits mono 24 kHz PCM16 WAV. Reject partial/malformed cache files. */
export function validVoiceWave(bytes: Buffer) {
  if (
    bytes.length < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  )
    return false;
  let at = 12,
    fmt = false,
    data = 0;
  while (at + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", at, at + 4),
      size = bytes.readUInt32LE(at + 4),
      start = at + 8,
      end = start + size;
    if (end > bytes.length) return false;
    if (kind === "fmt ") {
      if (
        fmt ||
        size < 16 ||
        bytes.readUInt16LE(start) !== 1 ||
        bytes.readUInt16LE(start + 2) !== 1 ||
        bytes.readUInt32LE(start + 4) !== 24000 ||
        bytes.readUInt32LE(start + 8) !== 48000 ||
        bytes.readUInt16LE(start + 12) !== 2 ||
        bytes.readUInt16LE(start + 14) !== 16
      )
        return false;
      fmt = true;
    }
    if (kind === "data") {
      if (data || size % 2 !== 0) return false;
      data = size;
    }
    at = end + (size % 2);
  }
  return at === bytes.length && fmt && data >= 9600 && data <= 22 * 24000 * 2;
}
// At most six cache reads in flight; visiting never starts synthesis or a model.
let inFlight = 0;
export async function serveEchoVoice(
  request: Request,
  cache = process.env.EARTHSIGNAL_ECHO_CACHE ??
    "/opt/earthsignal/voice-20261112/cache",
) {
  const url = new URL(request.url),
    cue = url.searchParams.get("cue");
  if (
    !voiceId(cue) ||
    [...url.searchParams.keys()].some((k) => k !== "cue" && k !== "v") ||
    url.searchParams.get("v") !== catalog.version
  )
    return new Response("Unknown voice cue", { status: 404 });
  if (inFlight >= 6)
    return new Response("Voice busy", {
      status: 503,
      headers: { "Retry-After": "2" },
    });
  const digest = voiceDigest(cue);
  const headers = {
    "Content-Type": "audio/wav",
    "Cache-Control": "public, max-age=86400, immutable",
    ETag: `"${digest}"`,
    "X-Content-Type-Options": "nosniff",
    "X-Echo-Engine": "Kokoro-82M-ONNX-int8",
  };
  if (request.headers.get("if-none-match") === headers.ETag)
    return new Response(null, { status: 304, headers });
  inFlight++;
  try {
    const path = join(cache, digest + ".wav");
    const size = (await stat(path)).size;
    if (size < 44 || size > 1_100_000) throw Error("Voice outside budget");
    const bytes = await readFile(path);
    if (bytes.length !== size || !validVoiceWave(bytes))
      throw Error("Invalid audio");
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, "Content-Length": String(size) },
    });
  } catch {
    return new Response(
      "Echo voice is preparing. The caption remains available.",
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "30" },
      },
    );
  } finally {
    inFlight--;
  }
}
