import test from "node:test";
import assert from "node:assert/strict";
import { coordinateInput, studyRectangle, type RectangleInputs } from "../lib/study-rectangle";
import { assessmentRequestSchema } from "../lib/observatory-contract";

const input: RectangleInputs = { west: "-114.755123456789", south: "36.05", east: "-114.74", north: "36.07" };

test("existing coordinates displayed in exponent notation expand without rounding", () => {
  for (const value of [1e-7, -1.123456789e-8, 5e-324, 180, -85, 0, 36.01234567890123]) {
    const text = coordinateInput(value);
    assert.equal(text.includes("e"), false);
    assert.equal(Number(text), value);
  }
  assert.equal(studyRectangle({ west: coordinateInput(1e-7), east: "0.01", south: "20", north: "20.01" }).ok, true);
});

test("rectangle preserves exact decimal coordinates, longitude-first order and closed counterclockwise ring", () => {
  const result = studyRectangle(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.area, { type: "Polygon", coordinates: [[
    [-114.755123456789, 36.05], [-114.74, 36.05], [-114.74, 36.07], [-114.755123456789, 36.07], [-114.755123456789, 36.05],
  ]] });
  assert.equal(assessmentRequestSchema.safeParse({ schemaVersion: "1.0", domain: "water", question: "change", start: "2026-10-01", end: "2026-10-16", area: result.area }).success, true);
  assert.equal(input.west, "-114.755123456789");
});

test("signed, zero and fractional decimals work in either hemisphere without rounding", () => {
  for (const west of ["0", "+.5", " 1.25 ", "-180"]) {
    const result = studyRectangle({ west, south: "-85", east: String(Number(west) + 1), north: "-84.5" });
    assert.equal(result.ok, true, west);
  }
  assert.equal(studyRectangle({ west: "179", east: "180", south: "84", north: "85" }).ok, true);
});

test("blank, non-decimal and nonfinite values never become zero or a partial rectangle", () => {
  for (const value of ["", " ", "0x10", "1e1", "NaN", "Infinity", "36,05", "36°", "36 N", "--1", "1 2"]) {
    const result = studyRectangle({ ...input, south: value });
    assert.equal(result.ok, false, value);
    if (!result.ok) assert.deepEqual(Object.keys(result.errors), ["south"]);
    assert.equal("area" in result, false);
  }
});

test("reports every invalid coordinate and enforces the existing latitude and longitude limits", () => {
  const result = studyRectangle({ west: "-181", south: "-85.1", east: "180.1", north: "86" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(Object.keys(result.errors), ["west", "south", "east", "north"]);
});

test("reversed, degenerate, crossing and ambiguous wide rectangles are refused without sorting or wrapping", () => {
  for (const values of [
    { west: "1", east: "1" }, { west: "2", east: "1" },
    { south: "2", north: "1" }, { south: "2", north: "2" },
    { west: "179", east: "-179" }, { west: "-90", east: "90" },
    { west: "-179", east: "179" },
    { west: "0", east: "0.00000001", south: "0", north: "0.00000001" },
    { west: "0", east: "0.000000000001", south: "0", north: "60" },
    { west: "0", east: "60", south: "0", north: "0.000000000001" },
  ]) {
    const result = studyRectangle({ ...input, ...values });
    assert.equal(result.ok, false, JSON.stringify(values));
    assert.equal("area" in result, false);
  }
});
