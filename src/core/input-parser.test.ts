import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUserInput, extractFilePaths } from "./input-parser.js";

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

describe("extractFilePaths", () => {
  it("extracts a single file path", () => {
    const paths = extractFilePaths("fix the bug in src/core/pipeline.ts");
    assert.deepEqual(paths, ["src/core/pipeline.ts"]);
  });

  it("extracts multiple file paths", () => {
    const paths = extractFilePaths("move code from src/old/foo.ts to src/new/bar.ts");
    assert.deepEqual(paths, ["src/old/foo.ts", "src/new/bar.ts"]);
  });

  it("handles relative paths with dot prefixes", () => {
    const paths = extractFilePaths("update ./lib/utils.js");
    assert.deepEqual(paths, ["./lib/utils.js"]);
  });

  it("handles various file extensions", () => {
    const paths = extractFilePaths("check src/app/page.tsx and styles/main.css");
    assert.deepEqual(paths, ["src/app/page.tsx", "styles/main.css"]);
  });

  it("returns empty array when no paths found", () => {
    const paths = extractFilePaths("add a helper function");
    assert.deepEqual(paths, []);
  });

  it("ignores bare filenames without directory separators", () => {
    const paths = extractFilePaths("update README.md");
    assert.deepEqual(paths, []);
  });
});
