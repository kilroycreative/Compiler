import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUserInput } from "./input-parser.js";

describe("parseUserInput", () => {
  it("extracts a known action verb", () => {
    const result = parseUserInput("Add a helper function to parse user input");
    assert.equal(result.action, "add");
    assert.equal(result.target, "a helper function to parse user input");
    assert.equal(result.description, "Add a helper function to parse user input");
  });

  it("handles case-insensitive actions", () => {
    assert.equal(parseUserInput("DELETE the old config").action, "delete");
    assert.equal(parseUserInput("Refactor auth module").action, "refactor");
  });

  it('returns "unknown" for unrecognized actions', () => {
    const result = parseUserInput("Investigate flaky test");
    assert.equal(result.action, "unknown");
    assert.equal(result.target, "Investigate flaky test");
  });

  it("trims whitespace", () => {
    const result = parseUserInput("  fix the login bug  ");
    assert.equal(result.action, "fix");
    assert.equal(result.description, "fix the login bug");
  });

  it("throws on empty input", () => {
    assert.throws(() => parseUserInput(""), /Empty input/);
    assert.throws(() => parseUserInput("   "), /Empty input/);
  });

  it("handles all known action verbs", () => {
    const verbs = [
      "add", "create", "implement",
      "delete", "remove", "drop",
      "refactor", "rename", "move",
      "fix", "update", "migrate",
    ];
    for (const verb of verbs) {
      assert.equal(parseUserInput(`${verb} something`).action, verb);
    }
  });
});
