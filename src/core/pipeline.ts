import type { PipelineContext, StageDefinition } from "../types.js";
import { emit } from "./event-store.js";
import { checkPreconditions, checkPostconditions, checkInvariants } from "./contracts.js";
import { register, compensateFrom, clear } from "./compensation.js";
import { qualityCircuitBreaker, type AgentOutput } from "../harness/quality-breaker.js";

// ── Circuit Breaker ────────────────────────────────────────────────

const failureCounts = new Map<string, number>();
const CIRCUIT_BREAKER_THRESHOLD = 3;
const recentOutputsByAgent = new Map<string, AgentOutput[]>();
const OUTPUT_HISTORY_LIMIT = 10;

function isCircuitOpen(stageId: string): boolean {
  return (failureCounts.get(stageId) ?? 0) >= CIRCUIT_BREAKER_THRESHOLD;
}

function recordFailure(stageId: string): number {
  const count = (failureCounts.get(stageId) ?? 0) + 1;
  failureCounts.set(stageId, count);
  return count;
}

function getAgentId(ctx: PipelineContext): string {
  const taskAgentId = ctx.task.agent_id ?? ctx.task.assignee_agent_id;
  if (typeof taskAgentId === "string" && taskAgentId.length > 0) return taskAgentId;
  return "default-agent";
}

function getRecentOutputs(agentId: string): AgentOutput[] {
  return recentOutputsByAgent.get(agentId) ?? [];
}

function recordAgentOutput(agentId: string, output: AgentOutput): void {
  const current = recentOutputsByAgent.get(agentId) ?? [];
  current.push(output);
  if (current.length > OUTPUT_HISTORY_LIMIT) {
    current.splice(0, current.length - OUTPUT_HISTORY_LIMIT);
  }
  recentOutputsByAgent.set(agentId, current);
}

function markAgentCommit(agentId: string, committedAt: string): void {
  const outputs = recentOutputsByAgent.get(agentId);
  if (!outputs || outputs.length === 0) return;
  outputs[outputs.length - 1] = { ...outputs[outputs.length - 1], lastCommittedAt: committedAt };
}

function captureAgentOutput(stageId: string, ctx: PipelineContext): AgentOutput | null {
  if (stageId !== "B2") return null;

  const taskDescription = typeof ctx.task.description === "string" ? ctx.task.description : "";
  const agentResult =
    typeof ctx.artifacts.agent_result === "object" && ctx.artifacts.agent_result !== null
      ? (ctx.artifacts.agent_result as Record<string, unknown>)
      : {};

  const output =
    typeof agentResult.output === "string"
      ? agentResult.output
      : typeof ctx.artifacts.diff === "string"
        ? ctx.artifacts.diff
        : taskDescription;

  if (!output) return null;

  return {
    description: taskDescription || output.slice(0, 200),
    output,
    createdAt: new Date().toISOString(),
    activeSession: true,
  };
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
    const agentId = getAgentId(ctx);
    const health = qualityCircuitBreaker.checkHealth(agentId, getRecentOutputs(agentId));

    if (health === "tripped") {
      const msg = `Quality circuit breaker TRIPPED for agent ${agentId} — pausing pipeline`;
      qualityCircuitBreaker.pauseAgent(agentId);
      console.log(`  ⛔ ${msg}`);
      emit("QualityCircuitBreakerTripped", taskId, stage.id, { agent_id: agentId });
      await compensateFrom(taskId, ctx);
      emit("PipelineFailed", taskId, stage.id, { reason: msg });
      return { success: false, error: msg };
    }
    if (health === "degraded") {
      console.log(`  ⚠ quality degraded for agent ${agentId}; continuing with caution`);
    }

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
      const capturedOutput = captureAgentOutput(stage.id, ctx);
      if (capturedOutput) {
        recordAgentOutput(agentId, capturedOutput);
      }
      if (stage.id === "B5" && typeof ctx.artifacts.merge_commit === "string" && ctx.artifacts.merge_commit !== "no-git-merge") {
        markAgentCommit(agentId, new Date().toISOString());
      }
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
