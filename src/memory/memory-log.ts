import { appendFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { MemoryEntry, MemoryConfig } from "./types.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";

function agentDir(agentId: string, config: MemoryConfig): string {
  return resolve(config.memory_dir, agentId);
}

function logPath(agentId: string, config: MemoryConfig): string {
  return join(agentDir(agentId, config), "log.jsonl");
}

function ensureAgentDir(agentId: string, config: MemoryConfig): void {
  const dir = agentDir(agentId, config);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function appendEntry(
  agentId: string,
  entry: MemoryEntry,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): void {
  ensureAgentDir(agentId, config);
  appendFileSync(logPath(agentId, config), JSON.stringify(entry) + "\n");
}

export function readEntries(
  agentId: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): MemoryEntry[] {
  const path = logPath(agentId, config);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MemoryEntry);
}

export function listAgents(
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): string[] {
  if (!existsSync(config.memory_dir)) return [];
  return readdirSync(config.memory_dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function entryCount(
  agentId: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG
): number {
  return readEntries(agentId, config).length;
}
