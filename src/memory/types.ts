// ── Durable Agent Memory Types ────────────────────────────────────

export interface MemoryEntry {
  timestamp: string;
  run_id: string;
  task_id: string;
  summary: string;
  outcome: "success" | "failure" | "blocked";
  key_decisions: string[];
  artifacts?: string[];
}

export interface ConsolidatedMemory {
  agent_id: string;
  last_consolidated_at: string;
  entries_consolidated: number;
  content: string;
  token_count: number;
}

export interface MemoryConfig {
  max_tokens: number;
  consolidation_threshold: number;
  memory_dir: string;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  max_tokens: 8192,
  consolidation_threshold: 20,
  memory_dir: ".factory/memory",
};
