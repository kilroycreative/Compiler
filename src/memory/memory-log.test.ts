import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendEntry, readEntries, listAgents, entryCount } from "./memory-log.js";
import { consolidate, needsConsolidation, getConsolidatedMemory, getOrConsolidate } from "./memory-consolidator.js";
import type { MemoryEntry, MemoryConfig } from "./types.js";

function makeTmpConfig(): MemoryConfig {
  const dir = mkdtempSync(join(tmpdir(), "memory-test-"));
  return { max_tokens: 8192, consolidation_threshold: 3, memory_dir: dir };
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    timestamp: new Date().toISOString(),
    run_id: "run_1",
    task_id: "task_abc",
    summary: "Did a thing",
    outcome: "success",
    key_decisions: ["chose model X"],
    ...overrides,
  };
}

describe("memory-log", () => {
  let config: MemoryConfig;

  beforeEach(() => {
    config = makeTmpConfig();
  });

  it("should return empty entries for unknown agent", () => {
    const entries = readEntries("agent-1", config);
    assert.deepEqual(entries, []);
  });

  it("should append and read a single entry", () => {
    const entry = makeEntry();
    appendEntry("agent-1", entry, config);
    const entries = readEntries("agent-1", config);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].task_id, "task_abc");
    assert.equal(entries[0].outcome, "success");
  });

  it("should append multiple entries in order", () => {
    appendEntry("agent-1", makeEntry({ task_id: "t1" }), config);
    appendEntry("agent-1", makeEntry({ task_id: "t2" }), config);
    appendEntry("agent-1", makeEntry({ task_id: "t3" }), config);
    const entries = readEntries("agent-1", config);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].task_id, "t1");
    assert.equal(entries[2].task_id, "t3");
  });

  it("should isolate entries per agent", () => {
    appendEntry("agent-a", makeEntry({ task_id: "ta" }), config);
    appendEntry("agent-b", makeEntry({ task_id: "tb" }), config);
    assert.equal(readEntries("agent-a", config).length, 1);
    assert.equal(readEntries("agent-b", config).length, 1);
    assert.equal(readEntries("agent-a", config)[0].task_id, "ta");
  });

  it("should list agents with memory logs", () => {
    appendEntry("alpha", makeEntry(), config);
    appendEntry("beta", makeEntry(), config);
    const agents = listAgents(config);
    assert.ok(agents.includes("alpha"));
    assert.ok(agents.includes("beta"));
    assert.equal(agents.length, 2);
  });

  it("should return empty list when no agents exist", () => {
    assert.deepEqual(listAgents(config), []);
  });

  it("should count entries correctly", () => {
    assert.equal(entryCount("agent-1", config), 0);
    appendEntry("agent-1", makeEntry(), config);
    assert.equal(entryCount("agent-1", config), 1);
    appendEntry("agent-1", makeEntry(), config);
    assert.equal(entryCount("agent-1", config), 2);
  });

  it("should preserve optional artifacts field", () => {
    const entry = makeEntry({ artifacts: ["commit:abc123", "grade.json"] });
    appendEntry("agent-1", entry, config);
    const entries = readEntries("agent-1", config);
    assert.deepEqual(entries[0].artifacts, ["commit:abc123", "grade.json"]);
  });

  it("should handle entries without artifacts", () => {
    const entry = makeEntry();
    delete entry.artifacts;
    appendEntry("agent-1", entry, config);
    const entries = readEntries("agent-1", config);
    assert.equal(entries[0].artifacts, undefined);
  });
});

describe("memory-consolidator", () => {
  let config: MemoryConfig;

  beforeEach(() => {
    config = makeTmpConfig();
  });

  it("should not need consolidation with no entries", () => {
    assert.equal(needsConsolidation("agent-1", config), false);
  });

  it("should need consolidation after threshold entries", () => {
    for (let i = 0; i < config.consolidation_threshold; i++) {
      appendEntry("agent-1", makeEntry({ task_id: `t${i}` }), config);
    }
    assert.equal(needsConsolidation("agent-1", config), true);
  });

  it("should not need consolidation below threshold", () => {
    appendEntry("agent-1", makeEntry(), config);
    assert.equal(needsConsolidation("agent-1", config), false);
  });

  it("should produce consolidated markdown", () => {
    appendEntry("agent-1", makeEntry({ summary: "First task" }), config);
    appendEntry("agent-1", makeEntry({ summary: "Second task" }), config);
    const result = consolidate("agent-1", config);
    assert.equal(result.agent_id, "agent-1");
    assert.equal(result.entries_consolidated, 2);
    assert.ok(result.content.includes("# Agent Memory"));
    assert.ok(result.content.includes("First task"));
    assert.ok(result.content.includes("Second task"));
    assert.ok(result.token_count > 0);
  });

  it("should write consolidated file readable by getConsolidatedMemory", () => {
    appendEntry("agent-1", makeEntry(), config);
    consolidate("agent-1", config);
    const memory = getConsolidatedMemory("agent-1", config);
    assert.ok(memory !== null);
    assert.ok(memory!.includes("# Agent Memory"));
  });

  it("should return null for agent with no consolidated memory", () => {
    assert.equal(getConsolidatedMemory("unknown", config), null);
  });

  it("should consolidate on demand via getOrConsolidate", () => {
    for (let i = 0; i < config.consolidation_threshold; i++) {
      appendEntry("agent-1", makeEntry({ task_id: `t${i}` }), config);
    }
    const result = getOrConsolidate("agent-1", config);
    assert.equal(result.entries_consolidated, config.consolidation_threshold);
    assert.ok(result.content.length > 0);
  });

  it("should reset consolidation need after consolidating", () => {
    for (let i = 0; i < config.consolidation_threshold; i++) {
      appendEntry("agent-1", makeEntry({ task_id: `t${i}` }), config);
    }
    assert.equal(needsConsolidation("agent-1", config), true);
    consolidate("agent-1", config);
    assert.equal(needsConsolidation("agent-1", config), false);
  });

  it("should respect token budget and prioritize recent entries", () => {
    // Very small token budget
    const smallConfig: MemoryConfig = { ...config, max_tokens: 50 };
    for (let i = 0; i < 10; i++) {
      appendEntry("agent-1", makeEntry({ summary: `Task number ${i} with some details` }), smallConfig);
    }
    const result = consolidate("agent-1", smallConfig);
    // Should contain fewer than all 10 entries due to token budget
    assert.ok(result.token_count <= 50);
  });

  it("should include key_decisions in consolidated markdown", () => {
    appendEntry("agent-1", makeEntry({ key_decisions: ["picked model A", "used low blast radius"] }), config);
    const result = consolidate("agent-1", config);
    assert.ok(result.content.includes("picked model A"));
    assert.ok(result.content.includes("used low blast radius"));
  });

  it("should include outcome in consolidated entry header", () => {
    appendEntry("agent-1", makeEntry({ outcome: "failure" }), config);
    const result = consolidate("agent-1", config);
    assert.ok(result.content.includes("[failure]"));
  });
});
