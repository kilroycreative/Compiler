import type { PipelineContext, StageDefinition } from "../types.js";
import { emit } from "./event-store.js";
import { checkPreconditions, checkPostconditions, checkInvariants } from "./contracts.js";
import { register, compensateFrom, clear } from "./compensation.js";

// ── Circuit Breaker ────────────────────────────────────────────────

const failureCounts = new Map<string, number>();
const CIRCUIT_BREAKER_THRESHOLD = 3;

function isCircuitOpen(stageId: string): boolean {
  return (failureCounts.get(stageId) ?? 0) >= CIRCUIT_BREAKER_THRESHOLD;
}

function recordFailure(stageId: string): number {
  const count = (failureCounts.get(stageId) ?? 0) + 1;
  failureCounts.set(stageId, count);
  return count;
}

// ── Single Stage Execution with Retry ──────────────────────────────

async function executeStageWithRetry(
  stage: StageDefinition,
  ctx: PipelineContext,
  taskId: string
): Promise<void> {
  const { retry } = stage;
  const maxAttempts = retry.when === "never" ? 1 : retry.max_retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await stage.execute(ctx);
      return;
    } catch (err) {
      const isLast = attempt === maxAttempts;
      if (retry.when === "never" || isLast) throw err;

      if (retry.when === "on_error" || retry.when === "always") {
        const delay = retry.backoff_ms?.[attempt - 1] ?? 1000;
        console.log(`    retry ${attempt}/${retry.max_retries} in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Pipeline Orchestrator ──────────────────────────────────────────

export async function runPipeline(
  stages: StageDefinition[],
  ctx: PipelineContext,
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  clear();

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];

    // Circuit breaker check
    if (isCircuitOpen(stage.id)) {
      const msg = `Circuit breaker OPEN for ${stage.id} — skipping pipeline`;
      console.log(`  ⛔ ${msg}`);
      emit("CircuitBreakerTripped", taskId, stage.id);
      await compensateFrom(taskId, ctx);
      emit("PipelineFailed", taskId, stage.id, { reason: msg });
      return { success: false, error: msg };
    }

    // Check required properties
    for (const req of stage.requires) {
      if (!ctx.properties.has(req)) {
        const msg = `Missing required property ${req} for stage ${stage.id}`;
        emit("PipelineFailed", taskId, stage.id, { reason: msg });
        return { success: false, error: msg };
      }
    }

    emit("StageStarted", taskId, stage.id);
    console.log(`  ▸ ${stage.id} (${stage.name})`);

    try {
      // Pre-checks
      checkPreconditions(stage.id, stage.contract, ctx);
      checkInvariants(stage.id, stage.contract, ctx);

      // Register compensation for transform stages
      if (stage.kind === "transform" && stage.compensate) {
        register(stage.id, stage.compensate);
      }

      // Execute with retry
      await executeStageWithRetry(stage, ctx, taskId);

      // Post-checks
      checkPostconditions(stage.id, stage.contract, ctx);
      checkInvariants(stage.id, stage.contract, ctx);

      // Mark property
      ctx.properties.add(stage.provides);
      emit("StageCompleted", taskId, stage.id);
    } catch (err) {
      const count = recordFailure(stage.id);
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${stage.id} failed: ${message} (failures: ${count}/${CIRCUIT_BREAKER_THRESHOLD})`);
      emit("StageFailed", taskId, stage.id, { error: message, failure_count: count });

      // rest_for_one: compensate from current stage backward
      if (stage.kind === "transform") {
        await compensateFrom(taskId, ctx);
      }

      emit("PipelineFailed", taskId, stage.id, { reason: message });
      return { success: false, error: message };
    }
  }

  emit("PipelineCompleted", taskId);
  return { success: true };
}
