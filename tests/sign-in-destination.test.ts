import test from "node:test";
import assert from "node:assert/strict";
import { signInDestination } from "../lib/sign-in-destination";

test("only the single known review destination survives collaborator sign-in", () => {
  assert.equal(signInDestination("?continue=reference-review"), "/reference-review");
  assert.equal(signInDestination("?continue=reference-review&unrelated=1"), "/reference-review");
  for (const query of ["", "?continue=/reference-review", "?continue=reference-review&continue=reference-review", "?continue=reference-review&continue=https://other.example", "?continue=https://other.example", "?continue=//other.example", "?continue=javascript:alert(1)", "?continue=%2F%2Fother.example", "?continue=reference-review%0A", "?returnTo=https://other.example", "?continue=REFERENCE-REVIEW"])
    assert.equal(signInDestination(query), "/workspace", query);
});
