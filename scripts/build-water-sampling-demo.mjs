import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../examples/water-sampling-demo/", import.meta.url);
const metadata = JSON.parse(readFileSync(new URL("metadata.json", root), "utf8"));
if (metadata.schemaVersion !== 1 || metadata.synthetic !== true) throw Error("Tutorial must stay explicitly synthetic.");
const labels = [
  ["density", "Uneven visits", "One water-labelled visit in 2024; twelve non-water visits in 2025."],
  ["unknown", "Unclear views", "One visible view has an unclear label. Another cannot be observed."],
  ["missing-year", "A year without visits", "There are recorded visits in 2024 and 2026, but none in 2025."],
];
const digest = raw => createHash("sha256").update(raw).digest("hex");
const demos = labels.map(([id, title, description]) => {
  const pins = metadata.fixtures[id];
  if (pins.input !== id + "-input.json" || pins.result !== id + "-result.json") throw Error("Unexpected tutorial file.");
  const input = readFileSync(new URL(pins.input, root)), result = readFileSync(new URL(pins.result, root));
  if (input.length > 131072 || result.length > 131072 ||
      digest(input) !== pins.inputSha256 || digest(result) !== pins.resultSha256) throw Error("Tutorial source pin mismatch.");
  const artifact = JSON.parse(result.toString("utf8"));
  if (artifact.sourceFileSha256 !== pins.inputSha256 || artifact.artifactHash !== pins.artifactHash ||
      artifact.kind !== "water-sampling-sensitivity" || artifact.summary.methodVersion !== "water-sampling-sensitivity-v1")
    throw Error("Tutorial identity mismatch.");
  return { id, title, description, inputText: input.toString("utf8"), resultText: result.toString("utf8"),
    inputSha256: pins.inputSha256, resultSha256: pins.resultSha256 };
});
writeFileSync(new URL("../lib/water-sampling-demo.generated.ts", import.meta.url),
  "// Generated from pinned, synthetic native fixtures; never private inputs.\nexport const WATER_SAMPLING_DEMOS = " +
  JSON.stringify(demos) + " as const;\n");
