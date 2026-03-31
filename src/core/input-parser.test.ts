import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUserInput, extractFilePaths, extractIdentifiers, analyzeInput } from "./input-parser.js";

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

describe("extractIdentifiers", () => {
  it("extracts camelCase identifiers", () => {
    const ids = extractIdentifiers("refactor parseUserInput to handle edge cases");
    assert.deepEqual(ids, ["parseUserInput"]);
  });

  it("extracts PascalCase identifiers", () => {
    const ids = extractIdentifiers("add a new PipelineContext type");
    assert.deepEqual(ids, ["PipelineContext"]);
  });

  it("extracts snake_case identifiers", () => {
    const ids = extractIdentifiers("rename task_id to use the new format");
    assert.deepEqual(ids, ["task_id"]);
  });

  it("extracts SCREAMING_SNAKE_CASE identifiers", () => {
    const ids = extractIdentifiers("update the MAX_RETRIES constant");
    assert.deepEqual(ids, ["MAX_RETRIES"]);
  });

  it("extracts multiple identifiers in order", () => {
    const ids = extractIdentifiers("move parseUserInput and extractFilePaths into InputParser");
    assert.deepEqual(ids, ["parseUserInput", "extractFilePaths", "InputParser"]);
  });

  it("deduplicates repeated identifiers", () => {
    const ids = extractIdentifiers("use parseUserInput then call parseUserInput again");
    assert.deepEqual(ids, ["parseUserInput"]);
  });

  it("ignores plain English words", () => {
    const ids = extractIdentifiers("add a helper function to parse user input");
    assert.deepEqual(ids, []);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(extractIdentifiers(""), []);
  });
});

describe("analyzeInput", () => {
  it("combines action, identifiers, and file paths", () => {
    const result = analyzeInput("refactor parseUserInput in src/core/input-parser.ts");
    assert.equal(result.action, "refactor");
    assert.equal(result.target, "parseUserInput in src/core/input-parser.ts");
    assert.deepEqual(result.identifiers, ["parseUserInput"]);
    assert.deepEqual(result.filePaths, ["src/core/input-parser.ts"]);
  });

  it("returns empty arrays when no identifiers or paths found", () => {
    const result = analyzeInput("add a helper function");
    assert.equal(result.action, "add");
    assert.deepEqual(result.identifiers, []);
    assert.deepEqual(result.filePaths, []);
  });

  it("preserves the full description", () => {
    const result = analyzeInput("fix the MAX_RETRIES bug in src/core/pipeline.ts");
    assert.equal(result.description, "fix the MAX_RETRIES bug in src/core/pipeline.ts");
    assert.equal(result.action, "fix");
    assert.deepEqual(result.identifiers, ["MAX_RETRIES"]);
    assert.deepEqual(result.filePaths, ["src/core/pipeline.ts"]);
  });

  it("throws on empty input", () => {
    assert.throws(() => analyzeInput(""), /Empty input/);
  });
});
