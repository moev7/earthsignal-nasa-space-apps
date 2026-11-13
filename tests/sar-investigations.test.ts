import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SAR_STARTING_POINTS,
  sarStartingPoint,
  studyStartingPoint,
  studyQuestion,
  startingPointHref,
} from "../lib/sar-investigations";
import { PUBLIC_STUDIES } from "../lib/public-study-registry";
import { sarStudyRequestSchema, sarSearchSchema } from "../lib/sar-contract";

test("question starting points reproduce the reviewed evidence's exact request geometry, dates, unit and revision", async () => {
  for (const point of SAR_STARTING_POINTS) {
    const study = PUBLIC_STUDIES.find(
      (s) => s.id === point.studyId && s.revision === point.revision,
    )!;
    assert.ok(study, point.id);
    assert.equal(studyStartingPoint(study)?.id, point.id);
    assert.equal(
      studyStartingPoint({ ...study, revision: "0".repeat(16) }),
      null,
      "A future revision must not silently inherit old reproduction settings",
    );
    const m = JSON.parse(
      await readFile(
        new URL("../public" + study.manifestUrl, import.meta.url),
        "utf8",
      ),
    );
    const request = study.manifestUrl.startsWith("/data/sar/")
      ? JSON.parse(
          await readFile(
            new URL(
              "../public" +
                study.manifestUrl.replace("manifest.json", "provenance.json"),
              import.meta.url,
            ),
            "utf8",
          ),
        ).request
      : {
          schemaVersion: "1.0",
          sourceId: "nisar",
          operation: "backscatter-change",
          bbox: m.source.crop.bbox,
          channel: "HH",
          recordIds: [m.source.before.id, m.source.after.id],
        };
    assert.equal(point.sourceId, study.sourceId);
    assert.equal(point.start, study.period.start);
    assert.equal(point.end, study.period.end);
    assert.deepEqual(point.bbox, request.bbox);
    assert.equal(point.operation, request.operation);
    assert.equal(point.channel, request.channel);
    assert.deepEqual(point.pixelWindow, request.pixelWindow);
    assert.ok(
      sarStudyRequestSchema.safeParse({
        ...request,
        sourceId: point.sourceId,
        operation: point.operation,
        channel: point.channel,
        bbox: point.bbox,
        ...(point.pixelWindow ? { pixelWindow: point.pixelWindow } : {}),
      }).success,
    );
    assert.ok(
      sarSearchSchema.safeParse({
        sourceId: point.sourceId,
        product: point.product,
        bbox: point.bbox,
        start: point.start,
        end: point.end,
      }).success,
    );
    assert.equal(
      new URL(
        startingPointHref(point),
        "https://example.test",
      ).searchParams.get("investigation"),
      point.id,
    );
    assert.ok(studyQuestion(study).limit);
  }
  for (const invalid of [
    null,
    "",
    "unknown",
    "../tehran-echo",
    "https://example.test",
  ])
    assert.equal(sarStartingPoint(invalid), null);
});
