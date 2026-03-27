import type { StageDefinition, PipelineContext } from "../types.js";

const RETRY_ANALYSIS = { when: "on_error" as const, max_retries: 2 };

// M1 — Dependency Analysis
export const M1_deps: StageDefinition = {
  id: "M1",
  name: "Dependency Analysis",
  kind: "analysis",
  group: "middle",
  requires: ["PROP_risk_classified"],
  provides: "PROP_dependencies_analyzed",
  contract: {
    preconditions: [],
    postconditions: [
      { name: "dependencies listed", check: (ctx) => Array.isArray(ctx.task.dependencies) },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_ANALYSIS,
  async execute(ctx: PipelineContext) {
    // Simulated: no real dependency analysis
    ctx.task.dependencies = [];
    ctx.task.authorized_files = ["src/**/*.ts"];
  },
};

// M2 — Conflict Prediction
export const M2_conflicts: StageDefinition = {
  id: "M2",
  name: "Conflict Prediction",
  kind: "analysis",
  group: "middle",
  requires: ["PROP_dependencies_analyzed"],
  provides: "PROP_conflict_checked",
  contract: {
    preconditions: [],
    postconditions: [
      { name: "conflict_risk set", check: (ctx) => typeof ctx.metadata.conflict_risk === "string" },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_ANALYSIS,
  async execute(ctx: PipelineContext) {
    ctx.metadata.conflict_risk = "none";
  },
};

// M3 — Model Selection
export const M3_model: StageDefinition = {
  id: "M3",
  name: "Model Selection",
  kind: "analysis",
  group: "middle",
  requires: ["PROP_conflict_checked"],
  provides: "PROP_model_selected",
  contract: {
    preconditions: [
      { name: "risk_tier exists", check: (ctx) => !!ctx.task.risk_tier },
    ],
    postconditions: [
      { name: "model assigned", check: (ctx) => typeof ctx.task.model === "string" },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_ANALYSIS,
  async execute(ctx: PipelineContext) {
    const tier = ctx.task.risk_tier as number;
    ctx.task.model = tier === 3 ? "claude-opus-4-6" : tier === 2 ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
  },
};

// M4 — Constitution Generation
export const M4_constitution: StageDefinition = {
  id: "M4",
  name: "Constitution Generation",
  kind: "transform",
  group: "middle",
  requires: ["PROP_model_selected"],
  provides: "PROP_constitution_generated",
  contract: {
    preconditions: [],
    postconditions: [
      { name: "constitution_path set", check: (ctx) => typeof ctx.task.constitution_path === "string" },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_ANALYSIS,
  async execute(ctx: PipelineContext) {
    ctx.task.constitution_path = `.factory/constitutions/${ctx.task.task_id}.md`;
    ctx.artifacts.constitution = [
      "1. Only modify files in authorized_files",
      "2. Do not introduce breaking API changes",
      "3. All new functions must have tests",
      `4. Blast radius: ${ctx.task.blast_radius}`,
    ];
  },
  async compensate(ctx: PipelineContext) {
    delete ctx.artifacts.constitution;
  },
};

// M5 — Session Package
export const M5_session: StageDefinition = {
  id: "M5",
  name: "Session Package",
  kind: "transform",
  group: "middle",
  requires: ["PROP_constitution_generated"],
  provides: "PROP_session_packaged",
  contract: {
    preconditions: [],
    postconditions: [
      { name: "session_package set", check: (ctx) => typeof ctx.task.session_package === "object" },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_ANALYSIS,
  async execute(ctx: PipelineContext) {
    ctx.task.session_package = {
      model: ctx.task.model,
      constitution: ctx.artifacts.constitution,
      authorized_files: ctx.task.authorized_files,
      task_description: ctx.task.description,
    };
    ctx.task.timeout_ms = 300_000;
    ctx.task.max_retries = 3;
  },
  async compensate(ctx: PipelineContext) {
    delete ctx.task.session_package;
  },
};

export const middleStages: StageDefinition[] = [M1_deps, M2_conflicts, M3_model, M4_constitution, M5_session];
