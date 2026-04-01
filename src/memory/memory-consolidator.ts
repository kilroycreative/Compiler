import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { MemoryEntry, ConsolidatedMemory, MemoryConfig } from "./types.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";
import { readEntries } from "./memory-log.js";

const CONSOLIDATED_FILE = "consolidated.md";
const META_FILE = "meta.json";

// Rough token estimate: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;

function agentDir(agentId: string, config: MemoryConfig): string {
  return resolve(config.memory_dir, agentId);
}

function consolidatedPath(agentId: string, config: MemoryConfig): string {
  return join(agentDir(agentId, config), CONSOLIDATED_FILE);
}

function metaPath(agentId: string, config: MemoryConfig): string {
  return join(agentDir(agentId, config), META_FILE);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface ConsolidationMeta {
  last_consolidated_index: number;
  last_consolidated_at: string;
}

function readMeta(agentId: string, config: MemoryConfig): ConsolidationMeta | null {
  const path = metaPath(agentId, config);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as ConsolidationMeta;
}

function writeMeta(agentId: string, meta: ConsolidationMeta, config: MemoryConfig): void {
  const dir = agentDir(agentId, config);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(metaPath(agentId, config), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

function formatEntryMarkdown(entry: MemoryEntry): string {
  const lines: string[] = [];
  const date = entry.timestamp.slice(0, 10);
  lines.push(`### ${date} — ${entry.task_id} [${entry.outcome}]`);
  lines.push(entry.summary);
  if (entry.key_decisions.length > 0) {
    lines.push("**Decisions:**");
    for (const d of entry.key_decisions) {
      lines.push(`- ${d}`);
    }
  }
  if (entry.artifacts && entry.artifacts.length > 0) {
    lines.push(`**Artifacts:** ${entry.artifacts.join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

function compressEntries(entries: MemoryEntry[], maxTokens: number): string {
  // Build from newest to oldest, stop when we hit the token budget
  const sections: string[] = [];
  let tokenBudget = maxTokens;

  // Reserve tokens for the header
  const header = "# Agent Memory\n\n";
  tokenBudget -= estimateTokens(header);

  for (let i = entries.length - 1; i >= 0 && tokenBudget > 0; i--) {
    const section = formatEntryMarkdown(entries[i]);
    const sectionTokens = estimateTokens(section);
    if (sectionTokens > tokenBudget) break;
    sections.unshift(section);
    tokenBudget -= sectionTokens;
  }

  return header + sections.join("\n");
}

export function consolidate(
  agentId: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): ConsolidatedMemory {
  const entries = readEntries(agentId, config);
  const content = compressEntries(entries, config.max_tokens);
  const tokenCount = estimateTokens(content);

  const dir = agentDir(agentId, config);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(consolidatedPath(agentId, config), content, "utf-8");

  const now = new Date().toISOString();
  writeMeta(agentId, { last_consolidated_index: entries.length, last_consolidated_at: now }, config);

  return {
    agent_id: agentId,
    last_consolidated_at: now,
    entries_consolidated: entries.length,
    content,
    token_count: tokenCount,
  };
}

export function needsConsolidation(
  agentId: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): boolean {
  const meta = readMeta(agentId, config);
  const entries = readEntries(agentId, config);
  const lastIndex = meta?.last_consolidated_index ?? 0;
  return entries.length - lastIndex >= config.consolidation_threshold;
}

export function getConsolidatedMemory(
  agentId: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): string | null {
  const path = consolidatedPath(agentId, config);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function getOrConsolidate(
  agentId: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): ConsolidatedMemory {
  if (needsConsolidation(agentId, config)) {
    return consolidate(agentId, config);
  }

  // Return existing or generate fresh
  const existing = getConsolidatedMemory(agentId, config);
  if (existing) {
    const meta = readMeta(agentId, config);
    return {
      agent_id: agentId,
      last_consolidated_at: meta?.last_consolidated_at ?? new Date().toISOString(),
      entries_consolidated: meta?.last_consolidated_index ?? 0,
      content: existing,
      token_count: estimateTokens(existing),
    };
  }

  return consolidate(agentId, config);
}
