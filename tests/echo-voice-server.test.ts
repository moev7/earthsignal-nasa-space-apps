import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveEchoVoice, voiceDigest } from "../lib/echo-voice-server";
import catalog from "../lib/echo-voice.json";
test("voice route serves only exact reviewed versioned cached WAVs; no arbitrary text or synthesis path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "earthsignal-voice-"));
  const req = (query: string, headers?: Record<string, string>) =>
    new Request("http://localhost/api/echo-voice?" + query, { headers });
  try {
    for (const query of [
      "cue=../private&v=" + catalog.version,
      "cue=welcome&text=anything&v=" + catalog.version,
      "cue=welcome&v=old",
      "cue=constructor&v=" + catalog.version,
    ])
      assert.equal((await serveEchoVoice(req(query), dir)).status, 404);
    const q = "cue=welcome&v=" + catalog.version;
    assert.equal((await serveEchoVoice(req(q), dir)).status, 503);
    const broken = Buffer.alloc(44);
    broken.write("RIFF");
    broken.write("WAVE", 8);
    await writeFile(join(dir, voiceDigest("welcome") + ".wav"), broken);
    assert.equal(
      (await serveEchoVoice(req(q), dir)).status,
      503,
      "RIFF/WAVE markers alone do not establish a playable cache file",
    );
    const wav = Buffer.alloc(44 + 9600);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24);
    wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(9600, 40);
    await writeFile(join(dir, voiceDigest("welcome") + ".wav"), wav);
    const response = await serveEchoVoice(req(q), dir);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.match(response.headers.get("x-echo-engine")!, /Kokoro/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav);
    assert.equal(
      (
        await serveEchoVoice(
          req(q, { "if-none-match": response.headers.get("etag")! }),
          dir,
        )
      ).status,
      304,
    );
    await writeFile(
      join(dir, voiceDigest("welcome") + ".wav"),
      Buffer.alloc(1_100_001),
    );
    assert.equal((await serveEchoVoice(req(q), dir)).status, 503);
  } finally {
    await rm(dir, { recursive: true });
  }
});
