import type { StageDefinition, PipelineContext } from "../types.js";
import * as cache from "../core/action-cache.js";
import { emit } from "../core/event-store.js";
import { gradeTraceForTask } from "../harness/trace-grader.js";
import { appendEntry } from "../memory/memory-log.js";
import { needsConsolidation, consolidate } from "../memory/memory-consolidator.js";
import type { MemoryEntry } from "../memory/types.js";

// L1 — Link / Finalize
export const L1_link: StageDefinition = {
  id: "L1",
  name: "Link & Finalize",
  kind: "transform",
  group: "linker",
  requires: ["PROP_merged"],
  provides: "PROP_linked",
  contract: {
    preconditions: [],
    postconditions: [],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: { when: "on_error", max_retries: 2 },
  async execute(ctx) {
    // Store result in action cache for future dedup
    const key = ctx.task.idempotency_key as string;
    cache.store(key, {
      diff: ctx.artifacts.diff,
      merge_commit: ctx.artifacts.merge_commit,
      model: ctx.task.model,
      completed_at: new Date().toISOString(),
    });
    emit("CacheStore", ctx.task.task_id as string, "L1", { key });

    console.log(`    cached result under key ${key.slice(0, 12)}...`);
  },
};

export const L2_grade: StageDefinition = {
  id: "L2",
  name: "Grade Trace",
  kind: "analysis",
  group: "linker",
  requires: ["PROP_linked"],
  provides: "PROP_graded",
  contract: {
    preconditions: [
      { name: "task has task_id", check: (ctx) => typeof ctx.task.task_id === "string" && ctx.task.task_id.length > 0 },
    ],
    postconditions: [
      {
        name: "trace grade computed",
        check: (ctx) =>
          typeof ctx.artifacts.trace_grade === "object" && ctx.artifacts.trace_grade !== null,
      },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: { when: "on_error", max_retries: 2 },
  async execute(ctx) {
    const taskId = ctx.task.task_id as string;
    const result = gradeTraceForTask(taskId);

    ctx.artifacts.trace_grade = result.grade;
    ctx.artifacts.trace_grade_path = result.output_path;

    emit("TraceGraded", taskId, "L2", {
      score: result.grade.score,
      retry_count: result.grade.retry_count,
      compensation_count: result.grade.compensation_count,
      duration_ms: result.grade.duration_ms,
      cache_hit: result.grade.cache_hit,
      warnings: result.grade.warnings,
      grade_path: result.output_path,
    });

    console.log(
      `    trace grade=${result.grade.score.toFixed(3)} retries=${result.grade.retry_count} compensations=${result.grade.compensation_count}`
    );
  },
};

// L3 — Persist Agent Memory
export const L3_memory: StageDefinition = {
  id: "L3",
  name: "Persist Memory",
  kind: "transform",
  group: "linker",
  requires: ["PROP_graded"],
  provides: "PROP_memory_persisted",
  contract: {
    preconditions: [
      { name: "task has task_id", check: (ctx) => typeof ctx.task.task_id === "string" && ctx.task.task_id.length > 0 },
    ],
    postconditions: [
      {
        name: "memory entry recorded",
        check: (ctx) => ctx.artifacts.memory_entry_written === true,
      },
    ],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: { when: "on_error", max_retries: 2 },
  async execute(ctx: PipelineContext) {
    const taskId = ctx.task.task_id as string;
    const agentId = (ctx.task.agent_id ?? ctx.task.assignee_agent_id ?? "default-agent") as string;
    const runId = (ctx.metadata.run_id ?? taskId) as string;

    const gradeData = ctx.artifacts.trace_grade as Record<string, unknown> | undefined;
    const score = typeof gradeData?.score === "number" ? gradeData.score : undefined;

    const outcome: MemoryEntry["outcome"] =
      score !== undefined && score >= 0.5 ? "success" : "failure";

    const decisions: string[] = [];
    if (typeof ctx.task.model === "string") decisions.push(`model: ${ctx.task.model}`);
    if (typeof ctx.task.blast_radius === "string") decisions.push(`blast_radius: ${ctx.task.blast_radius}`);
    if (score !== undefined) decisions.push(`trace_score: ${score.toFixed(3)}`);

    const artifacts: string[] = [];
    if (typeof ctx.artifacts.merge_commit === "string") artifacts.push(`commit:${ctx.artifacts.merge_commit}`);
    if (typeof ctx.artifacts.trace_grade_path === "string") artifacts.push(ctx.artifacts.trace_grade_path as string);

    const entry: MemoryEntry = {
      timestamp: new Date().toISOString(),
      run_id: runId,
      task_id: taskId,
      summary: (ctx.task.description as string) ?? taskId,
      outcome,
      key_decisions: decisions,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };

    appendEntry(agentId, entry);
    ctx.artifacts.memory_entry_written = true;

    // Consolidate if threshold reached
    if (needsConsolidation(agentId)) {
      const consolidated = consolidate(agentId);
      ctx.artifacts.memory_consolidated = true;
      console.log(
        `    memory consolidated: ${consolidated.entries_consolidated} entries, ~${consolidated.token_count} tokens`
      );
    }

    emit("MemoryPersisted", taskId, "L3", {
      agent_id: agentId,
      outcome,
      score,
    });

    console.log(`    memory appended for agent=${agentId} outcome=${outcome}`);
  },
};

export const linkerStages: StageDefinition[] = [L1_link, L2_grade, L3_memory];
