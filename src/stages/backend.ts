import type { StageDefinition, PipelineContext } from "../types.js";

const RETRY_AGENT = { when: "always" as const, max_retries: 3, backoff_ms: [100, 200, 400] };
const RETRY_NEVER = { when: "never" as const, max_retries: 0 };
const RETRY_MERGE = { when: "on_error" as const, max_retries: 5 };

// B1 — Create Worktree
export const B1_worktree: StageDefinition = {
  id: "B1",
  name: "Create Worktree",
  kind: "transform",
  group: "backend",
  requires: ["PROP_session_packaged"],
  provides: "PROP_worktree_created",
  contract: {
    preconditions: [],
    postconditions: [
      { name: "worktree_path set", check: (ctx) => typeof ctx.task.worktree_path === "string" },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: { when: "on_error", max_retries: 2 },
  async execute(ctx: PipelineContext) {
    ctx.task.worktree_path = `.factory/worktrees/${ctx.task.task_id}`;
    ctx.artifacts.worktree_created = true;
    console.log(`    worktree → ${ctx.task.worktree_path}`);
  },
  async compensate(ctx: PipelineContext) {
    console.log(`    removing worktree ${ctx.task.worktree_path}`);
    ctx.artifacts.worktree_created = false;
  },
};

// B2 — Execute Agent (simulated, 80% success rate)
export const B2_execute: StageDefinition = {
  id: "B2",
  name: "Execute Agent",
  kind: "transform",
  group: "backend",
  requires: ["PROP_worktree_created"],
  provides: "PROP_executed",
  contract: {
    preconditions: [
      { name: "session_package exists", check: (ctx) => !!ctx.task.session_package },
    ],
    postconditions: [
      { name: "diff produced", check: (ctx) => typeof ctx.artifacts.diff === "string" },
    ],
    invariants_hard: [],
    invariants_soft: [
      { name: "diff is non-trivial", check: (ctx) => (ctx.artifacts.diff as string).length > 10 },
    ],
  },
  retry: RETRY_AGENT,
  async execute(ctx: PipelineContext) {
    // Skip execution if cache hit
    if (ctx.metadata.cache_hit) {
      console.log(`    skipping agent (cache hit)`);
      ctx.artifacts.diff = (ctx.artifacts.cached_result as Record<string, unknown>)?.diff as string ?? "cached-diff";
      return;
    }

    // Simulated agent execution (80% success)
    const success = Math.random() < 0.8;
    if (!success) throw new Error("Agent execution failed (simulated)");

    ctx.artifacts.diff = [
      `--- a/src/example.ts`,
      `+++ b/src/example.ts`,
      `@@ -1,3 +1,5 @@`,
      ` import { foo } from './foo';`,
      `+import { bar } from './bar';`,
      ` `,
      `-export const result = foo();`,
      `+export const result = foo() + bar();`,
      `+export const VERSION = '1.1.0';`,
    ].join("\n");
    ctx.artifacts.model_used = ctx.task.model;
  },
  async compensate(ctx: PipelineContext) {
    delete ctx.artifacts.diff;
  },
};

// B3 — Verify Output (SWE-bench style)
export const B3_verify: StageDefinition = {
  id: "B3",
  name: "Verify Output",
  kind: "analysis",
  group: "backend",
  requires: ["PROP_executed"],
  provides: "PROP_verified",
  contract: {
    preconditions: [
      { name: "diff exists", check: (ctx) => typeof ctx.artifacts.diff === "string" },
    ],
    postconditions: [
      { name: "verification result", check: (ctx) => typeof ctx.metadata.fail_to_pass === "boolean" },
    ],
    invariants_hard: [
      { name: "pass_to_pass holds", check: (ctx) => ctx.metadata.pass_to_pass !== false },
    ],
    invariants_soft: [],
  },
  retry: RETRY_NEVER,
  async execute(ctx: PipelineContext) {
    // Simulated SWE-bench verification
    ctx.metadata.fail_to_pass = true;
    ctx.metadata.pass_to_pass = true;
    console.log(`    FAIL_TO_PASS: ✓  PASS_TO_PASS: ✓`);
  },
};

// B4 — Security Review
export const B4_security: StageDefinition = {
  id: "B4",
  name: "Security Review",
  kind: "analysis",
  group: "backend",
  requires: ["PROP_verified"],
  provides: "PROP_security_reviewed",
  contract: {
    preconditions: [],
    postconditions: [
      { name: "security cleared", check: (ctx) => ctx.metadata.security_clear === true },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_NEVER,
  async execute(ctx: PipelineContext) {
    const diff = ctx.artifacts.diff as string;
    const hasSecrets = /password|secret|api_key|token/i.test(diff);
    if (hasSecrets) throw new Error("Security review FAILED: potential secret in diff");
    ctx.metadata.security_clear = true;
  },
};

// B5 — Merge
export const B5_merge: StageDefinition = {
  id: "B5",
  name: "Merge",
  kind: "transform",
  group: "backend",
  requires: ["PROP_security_reviewed"],
  provides: "PROP_merged",
  contract: {
    preconditions: [
      { name: "security cleared", check: (ctx) => ctx.metadata.security_clear === true },
    ],
    postconditions: [
      { name: "merge_commit set", check: (ctx) => typeof ctx.artifacts.merge_commit === "string" },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: RETRY_MERGE,
  async execute(ctx: PipelineContext) {
    // Simulated merge
    ctx.artifacts.merge_commit = `merge_${Date.now().toString(36)}`;
    console.log(`    merged → ${ctx.artifacts.merge_commit}`);
  },
  async compensate(ctx: PipelineContext) {
    console.log(`    reverting merge ${ctx.artifacts.merge_commit}`);
    delete ctx.artifacts.merge_commit;
  },
};

export const backendStages: StageDefinition[] = [B1_worktree, B2_execute, B3_verify, B4_security, B5_merge];
