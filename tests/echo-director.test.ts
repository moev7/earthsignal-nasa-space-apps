import test from "node:test";
import assert from "node:assert/strict";
import {
  directEcho,
  fieldNotesSchema,
  upsertFieldNote,
  type EchoTelemetry,
} from "../lib/echo-director";
import { radarSample } from "../lib/radar-interferometry";
import { phaseTwin } from "../lib/field-investigation";
import {
  assistantPayload,
  assistantPreviewHash,
  validateAssistantSelection,
} from "../lib/assistant-contract";
import {
  proofForQuestion,
  PUBLIC_QUESTIONS,
  PUBLIC_BLOCKS,
} from "../lib/public-evidence";

test("Echo preserves actual zero, missing motion and dB as different evidence; malformed/private fields fail closed", () => {
  const ground = {
    kind: "ground" as const,
    lat: 35.6,
    lng: 51.3,
    rate: null,
    sigma: null,
  };
  assert.match(directEcho(ground).text, /Missing is not zero/);
  assert.match(
    directEcho({ ...ground, rate: 0, sigma: 100.1 }).text,
    /0.0 mm\/yr ± 100.1 mm\/yr/,
  );
  const backscatter = directEcho({
    kind: "backscatter",
    row: 2,
    column: 3,
    differenceDb: -1.461,
  });
  assert.match(backscatter.text, /-1.461 dB/);
  assert.match(backscatter.text, /not metres/);
  assert.match(directEcho({ ...ground, rate: NaN }).stamp, /Unavailable/);
  assert.match(
    directEcho({ ...ground, workspace: "private" }).stamp,
    /Unavailable/,
  );
  assert.equal(
    fieldNotesSchema.safeParse({
      generation: "test",
      notes: [{ ...ground, workspace: "private" }],
    }).success,
    false,
  );
});

test("Echo reports exact unexaggerated radar telemetry at a zero reference and both phase twins", () => {
  const twin = phaseTwin();
  for (const sinkingM of [twin.firstDownM, twin.secondDownM]) {
    const sample = radarSample(0, 0, sinkingM),
      reading = directEcho({ kind: "radar", xM: 0, zM: 0, sinkingM });
    assert.ok(
      reading.lines.some((line) =>
        line.includes((sample.deltaRangeM * 1000).toFixed(1) + " mm"),
      ),
    );
    assert.ok(
      reading.lines.some((line) =>
        line.includes(sample.cycles.toFixed(3) + " cycles"),
      ),
    );
    assert.ok(
      reading.lines.some((line) =>
        line.includes(sample.wrappedCycles.toFixed(3) + " cycles"),
      ),
    );
    assert.deepEqual(
      directEcho({ kind: "radar", xM: 0, zM: 0, sinkingM }),
      reading,
    );
  }
  assert.match(
    directEcho({ kind: "radar", xM: 120, zM: 0, sinkingM: 0.3 }).text,
    /reference stays still/,
  );
  assert.match(
    directEcho({ kind: "footprint", osmId: 12, tilt: 0.001, sigma: 0.001 })
      .text,
    /smaller than twice its uncertainty/,
  );
  assert.match(
    directEcho({
      kind: "footprint",
      osmId: 12,
      tilt: null,
      sigma: null,
    }).lines.join(" "),
    /unavailable/,
  );
});

test("Notebook retains only a bounded last reading per instrument and unchanged updates cannot spin a render loop", () => {
  let notes: EchoTelemetry[] = [];
  const first: EchoTelemetry = {
    kind: "ground",
    lat: 35.6,
    lng: 51.3,
    rate: 0,
    sigma: 100,
  };
  notes = upsertFieldNote(notes, first);
  assert.equal(upsertFieldNote(notes, first), notes);
  notes = upsertFieldNote(notes, { ...first, rate: null });
  assert.equal(
    notes.length,
    2,
    "a missing pixel does not overwrite the kept measured reading",
  );
  assert.equal(directEcho(notes[1]).id, "ground-missing");
  assert.equal(upsertFieldNote(notes, { ...first, rate: Infinity }), notes);
  assert.equal(
    fieldNotesSchema.safeParse({ generation: "run", notes }).success,
    true,
  );
});

test("Public assistant proof actions are reviewed local links, carried in the exact preview and never supplied by generated text", async () => {
  const question = PUBLIC_QUESTIONS["phase-wrap"];
  const ids = ["nisar-phase-learning"];
  const proof = proofForQuestion(question);
  assert.equal(proof?.href, "/#phase-instrument");
  assert.equal(proofForQuestion("read my private building assessment"), null);
  const payload = assistantPayload(question, ids);
  assert.equal(payload.evidence[0].focusTarget, "radar-model");
  assert.match(payload.evidence[0].hook!, /clock/);
  assert.match(await assistantPreviewHash(question, ids), /^[a-f0-9]{64}$/);
  assert.throws(() =>
    validateAssistantSelection(
      {
        abstain: false,
        blockIds: ["phase-wrap"],
        focusTarget: "https://evil.test",
      },
      ids,
    ),
  );
  assert.ok(
    PUBLIC_BLOCKS.filter((b) => b.id === "ground-tilt").every((b) =>
      /not diagnoses|not a|not diagnose/.test(b.text),
    ),
  );
});
