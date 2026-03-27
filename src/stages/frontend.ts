import type { StageDefinition, PipelineContext } from "../types.js";
import * as cache from "../core/action-cache.js";
import { emit } from "../core/event-store.js";

const RETRY_FRONTEND = { when: "on_error" as const, max_retries: 2 };

// F1 — Parse Task
export const F1_parse: StageDefinition = {
  id: "F1",
  name: "Parse Task",
  kind: "analysis",
  group: "frontend",
  requires: [],
  provides: "PROP_parsed",
  contract: {
    preconditions: [
      { name: "task has description", check: (ctx) => typeof ctx.task.description === "string" && ctx.task.description.length > 0 },
    ],
    postconditions: [
      { name: "task_id assigned", check: (ctx) => typeof ctx.task.task_id === "string" },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_FRONTEND,
  async execute(ctx: PipelineContext) {
    if (!ctx.task.task_id) {
      ctx.task.task_id = `task_${Date.now().toString(36)}`;
    }
    ctx.task.source = ctx.task.source ?? "cli";
    ctx.task.base_commit = ctx.task.base_commit ?? "abc1234";
    ctx.task.idempotency_key = cache.computeKey({
      description: ctx.task.description,
      base_commit: ctx.task.base_commit,
    });
  },
};

// F2 — Validate Spec
export const F2_validate: StageDefinition = {
  id: "F2",
  name: "Validate Spec",
  kind: "analysis",
  group: "frontend",
  requires: ["PROP_parsed"],
  provides: "PROP_validated",
  contract: {
    preconditions: [
      { name: "has task_id", check: (ctx) => !!ctx.task.task_id },
    ],
    postconditions: [
      { name: "validation passed", check: (ctx) => ctx.metadata.validated === true },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_FRONTEND,
  async execute(ctx: PipelineContext) {
    const desc = ctx.task.description as string;
    if (desc.length < 5) throw new Error("Task description too short");
    ctx.metadata.validated = true;
  },
};

// F3 — Dedup Check (action cache)
export const F3_dedup: StageDefinition = {
  id: "F3",
  name: "Dedup Check",
  kind: "analysis",
  group: "frontend",
  requires: ["PROP_validated"],
  provides: "PROP_deduped",
  contract: {
    preconditions: [
      { name: "has idempotency_key", check: (ctx) => !!ctx.task.idempotency_key },
    ],
    postconditions: [],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_FRONTEND,
  async execute(ctx: PipelineContext) {
    const key = ctx.task.idempotency_key as string;
    const cached = cache.lookup(key);
    if (cached) {
      console.log(`    ✓ cache HIT — returning cached result`);
      emit("CacheHit", ctx.task.task_id as string, "F3", { key });
      ctx.metadata.cache_hit = true;
      ctx.artifacts.cached_result = cached;
    } else {
      emit("CacheMiss", ctx.task.task_id as string, "F3", { key });
      ctx.metadata.cache_hit = false;
    }
  },
};

// F4 — Risk Classification
export const F4_risk: StageDefinition = {
  id: "F4",
  name: "Risk Classification",
  kind: "analysis",
  group: "frontend",
  requires: ["PROP_deduped"],
  provides: "PROP_risk_classified",
  contract: {
    preconditions: [],
    postconditions: [
      { name: "risk_tier assigned", check: (ctx) => [1, 2, 3].includes(ctx.task.risk_tier as number) },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_FRONTEND,
  async execute(ctx: PipelineContext) {
    const desc = (ctx.task.description as string).toLowerCase();
    if (desc.includes("delete") || desc.includes("drop") || desc.includes("migration")) {
      ctx.task.risk_tier = 3;
      ctx.task.blast_radius = "high";
    } else if (desc.includes("refactor") || desc.includes("rename")) {
      ctx.task.risk_tier = 2;
      ctx.task.blast_radius = "medium";
    } else {
      ctx.task.risk_tier = 1;
      ctx.task.blast_radius = "low";
    }
  },
};

export const frontendStages: StageDefinition[] = [F1_parse, F2_validate, F3_dedup, F4_risk];
