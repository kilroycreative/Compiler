// ── Task IR: 4-Level Progressive Lowering ──────────────────────────

export interface TaskIR_L1 {
  task_id: string;
  source: string;
  description: string;
  base_commit: string;
  idempotency_key: string;
}

export interface TaskIR_L2 extends TaskIR_L1 {
  authorized_files: string[];
  blast_radius: "low" | "medium" | "high";
  dependencies: string[];
  risk_tier: 1 | 2 | 3;
}

export interface TaskIR_L3 extends TaskIR_L2 {
  preconditions: string[];
  postconditions: string[];
  invariants_hard: string[];
  invariants_soft: string[];
  recovery: string;
}

export interface TaskIR_L4 extends TaskIR_L3 {
  model: string;
  worktree_path: string;
  session_package: Record<string, unknown>;
  constitution_path: string;
  timeout_ms: number;
  max_retries: number;
}

export type TaskIR = TaskIR_L1 | TaskIR_L2 | TaskIR_L3 | TaskIR_L4;

// ── Property Flags ─────────────────────────────────────────────────

export type PropertyFlag =
  | "PROP_parsed"
  | "PROP_validated"
  | "PROP_deduped"
  | "PROP_risk_classified"
  | "PROP_dependencies_analyzed"
  | "PROP_conflict_checked"
  | "PROP_model_selected"
  | "PROP_constitution_generated"
  | "PROP_session_packaged"
  | "PROP_worktree_created"
  | "PROP_executed"
  | "PROP_verified"
  | "PROP_slop_reviewed"
  | "PROP_security_reviewed"
  | "PROP_merged"
  | "PROP_linked";

// ── Pipeline Events (Event Sourcing) ───────────────────────────────

export type PipelineEventType =
  | "TaskCreated"
  | "StageStarted"
  | "StageCompleted"
  | "StageFailed"
  | "CompensationStarted"
  | "CompensationCompleted"
  | "CacheHit"
  | "CacheMiss"
  | "CacheStore"
  | "CircuitBreakerTripped"
  | "QualityCircuitBreakerTripped"
  | "PipelineCompleted"
  | "PipelineFailed";

export interface PipelineEvent {
  type: PipelineEventType;
  task_id: string;
  stage_id?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Stage Contracts (ABC) ──────────────────────────────────────────

export interface ContractCheck {
  name: string;
  check: (ctx: PipelineContext) => boolean;
}

export interface StageContract {
  preconditions: ContractCheck[];
  postconditions: ContractCheck[];
  invariants_hard: ContractCheck[];
  invariants_soft: ContractCheck[];
}

// ── Stage Definition ───────────────────────────────────────────────

export type StageKind = "analysis" | "transform";

export type RetryPolicy = {
  when: "never" | "on_error" | "always";
  max_retries: number;
  backoff_ms?: number[];
};

export interface StageDefinition {
  id: string;
  name: string;
  kind: StageKind;
  group: "frontend" | "middle" | "backend" | "linker";
  requires: PropertyFlag[];
  provides: PropertyFlag;
  contract: StageContract;
  retry: RetryPolicy;
  execute: (ctx: PipelineContext) => Promise<void>;
  compensate?: (ctx: PipelineContext) => Promise<void>;
}

// ── Slop Metrics ──────────────────────────────────────────────────

export interface SlopMetrics {
  cc_max: number;
  cc_mean: number;
  cc_high_count: number;       // functions with CC > 10
  lint_errors: number;
  ast_grep_violations: number;
  clone_ratio: number;         // 0.0–1.0
  trivial_wrappers: number;
  single_use_functions: number;
  loc: number;
  // delta metrics (null on first run, populated on subsequent runs)
  delta_loc: number | null;
  delta_cc_high_count: number | null;
  delta_ast_grep_violations: number | null;
  delta_churn_ratio: number | null;
}

// ── Pipeline Context ───────────────────────────────────────────────

export interface PipelineContext {
  task: Record<string, unknown>;
  properties: Set<PropertyFlag>;
  metadata: Record<string, unknown>;
  artifacts: Record<string, unknown>;
}
