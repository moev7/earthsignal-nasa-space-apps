import test from "node:test";
import assert from "node:assert/strict";
import { assistantRequestSchema } from "../lib/assistant-contract";
import { submitReviewedQuestion } from "../lib/assistant-submission";

test("invalidating reviewed context while hashing prevents transmission", async () => {
  for (const reason of ["question changed", "account changed", "unmounted"]) {
    let current = true;
    let calls = 0;
    let resolveHash!: (value: string) => void;
    const hash = () =>
      new Promise<string>((resolve) => {
        resolveHash = resolve;
      });
    const pending = submitReviewedQuestion(
      "What is a thermal anomaly?",
      ["nasa-firms"],
      () => current,
      async () => {
        calls++;
        return "sent";
      },
      hash,
    );
    current = false;
    resolveHash("a".repeat(64));
    assert.equal(await pending, null, reason);
    assert.equal(calls, 0, reason);
  }
});

test("a current reviewed context sends its exact canonical request once", async () => {
  let calls = 0;
  const question = "What is a thermal anomaly?",
    evidenceIds = ["nasa-firms"];
  const value = await submitReviewedQuestion(
    question,
    evidenceIds,
    () => true,
    async (body) => {
      calls++;
      assert.deepEqual(assistantRequestSchema.parse(body), {
        schemaVersion: "1.0",
        publicAIOptIn: true,
        question,
        evidenceIds,
        previewHash: "b".repeat(64),
      });
      return "verified response";
    },
    async () => "b".repeat(64),
  );
  assert.equal(value, "verified response");
  assert.equal(calls, 1);
});
