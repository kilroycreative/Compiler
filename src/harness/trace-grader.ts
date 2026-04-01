import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { replayForTask } from "../core/event-store.js";
import type { PipelineEvent, SlopMetrics, TraceGrade } from "../types.js";

export type TraceGradeWeights = {
  base: number;
  retry_penalty: number;
  compensation_penalty: number;
  slop_warning_penalty: number;
  soft_invariant_penalty: number;
};

export type TraceGradeResult = {
  grade: TraceGrade;
  output_path: string;
};

const GRADES_DIR = ".factory/grades";

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toInteger(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.floor(parsed));
}

function fromEnv(name: string, fallback: number): number {
  const parsed = toFiniteNumber(process.env[name]);
  return parsed === undefined ? fallback : parsed;
}

function getWeights(overrides: Partial<TraceGradeWeights>): TraceGradeWeights {
  return {
    base: overrides.base ?? fromEnv("TRACE_GRADE_BASE", 1.0),
    retry_penalty: overrides.retry_penalty ?? fromEnv("TRACE_GRADE_RETRY_PENALTY", 0.1),
    compensation_penalty:
      overrides.compensation_penalty ?? fromEnv("TRACE_GRADE_COMPENSATION_PENALTY", 0.2),
    slop_warning_penalty:
      overrides.slop_warning_penalty ?? fromEnv("TRACE_GRADE_SLOP_WARNING_PENALTY", 0.1),
    soft_invariant_penalty:
      overrides.soft_invariant_penalty ?? fromEnv("TRACE_GRADE_SOFT_INVARIANT_PENALTY", 0.05),
  };
}

function parseTimestampMs(isoTimestamp: string): number | null {
  const ms = Date.parse(isoTimestamp);
  if (Number.isNaN(ms)) return null;
  return ms;
}

function getCountFromData(data: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = toInteger(data[key]);
    if (value !== undefined) return value;
  }
  return 0;
}

function inferRetryCount(events: PipelineEvent[]): number {
  let explicitCount = 0;
  const stageStarts = new Map<string, number>();

  for (const event of events) {
    if (event.type === "StageStarted" && typeof event.stage_id === "string") {
      stageStarts.set(event.stage_id, (stageStarts.get(event.stage_id) ?? 0) + 1);
    }
    explicitCount += getCountFromData(event.data, ["retry_count", "retries"]);
  }

  if (explicitCount > 0) return explicitCount;

  let inferred = 0;
  for (const count of stageStarts.values()) {
    if (count > 1) inferred += count - 1;
  }
  return inferred;
}

function inferCompensationCount(events: PipelineEvent[]): number {
  let explicitCount = 0;
  for (const event of events) {
    explicitCount += getCountFromData(event.data, ["compensation_count", "compensations"]);
  }
  if (explicitCount > 0) return explicitCount;

  return events.filter((event) => event.type === "CompensationStarted").length;
}

function inferSoftInvariantViolations(events: PipelineEvent[]): number {
  let count = 0;

  for (const event of events) {
    count += getCountFromData(event.data, ["soft_invariant_violations", "soft_invariant_count"]);

    const error = event.data.error;
    if (typeof error === "string" && error.includes("[invariant_soft]")) {
      count += 1;
    }
  }

  return count;
}

function inferSlopWarningCount(events: PipelineEvent[]): number {
  let warningCount = 0;

  for (const event of events) {
    warningCount = Math.max(
      warningCount,
      getCountFromData(event.data, ["slop_warning_count", "warning_count"])
    );

    const warnings = event.data.warnings;
    if (Array.isArray(warnings)) {
      warningCount = Math.max(
        warningCount,
        warnings.filter((item): item is string => typeof item === "string").length
      );
    }

    const slopWarnings = event.data.slop_warnings;
    if (Array.isArray(slopWarnings)) {
      warningCount = Math.max(
        warningCount,
        slopWarnings.filter((item): item is string => typeof item === "string").length
      );
    }
  }

  return warningCount;
}

function inferDurationMs(events: PipelineEvent[], warnings: string[]): number {
  let f1StartMs: number | null = null;
  let l1DoneMs: number | null = null;

  for (const event of events) {
    const eventMs = parseTimestampMs(event.timestamp);
    if (eventMs === null) continue;

    if (event.type === "StageStarted" && event.stage_id === "F1") {
      if (f1StartMs === null || eventMs < f1StartMs) f1StartMs = eventMs;
    }
    if (event.type === "StageCompleted" && event.stage_id === "L1") {
      if (l1DoneMs === null || eventMs > l1DoneMs) l1DoneMs = eventMs;
    }
  }

  if (f1StartMs === null) {
    warnings.push("missing F1 StageStarted event; duration_ms set to 0");
    return 0;
  }
  if (l1DoneMs === null) {
    warnings.push("missing L1 StageCompleted event; duration_ms set to 0");
    return 0;
  }
  if (l1DoneMs < f1StartMs) {
    warnings.push("L1 completion timestamp precedes F1 start; duration_ms set to 0");
    return 0;
  }

  return l1DoneMs - f1StartMs;
}

function parseSlopMetrics(value: unknown): SlopMetrics | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const record = value as Record<string, unknown>;
  const ccMax = toFiniteNumber(record.cc_max);
  const ccMean = toFiniteNumber(record.cc_mean);
  const ccHighCount = toFiniteNumber(record.cc_high_count);
  const lintErrors = toFiniteNumber(record.lint_errors);
  const astGrepViolations = toFiniteNumber(record.ast_grep_violations);
  const cloneRatio = toFiniteNumber(record.clone_ratio);
  const trivialWrappers = toFiniteNumber(record.trivial_wrappers);
  const singleUseFunctions = toFiniteNumber(record.single_use_functions);
  const loc = toFiniteNumber(record.loc);
  const deltaLoc = toFiniteNumber(record.delta_loc);
  const deltaCcHighCount = toFiniteNumber(record.delta_cc_high_count);
  const deltaAstGrepViolations = toFiniteNumber(record.delta_ast_grep_violations);
  const deltaChurnRatio = toFiniteNumber(record.delta_churn_ratio);

  if (
    ccMax === undefined ||
    ccMean === undefined ||
    ccHighCount === undefined ||
    lintErrors === undefined ||
    astGrepViolations === undefined ||
    cloneRatio === undefined ||
    trivialWrappers === undefined ||
    singleUseFunctions === undefined ||
    loc === undefined
  ) {
    return undefined;
  }

  return {
    cc_max: ccMax,
    cc_mean: ccMean,
    cc_high_count: ccHighCount,
    lint_errors: lintErrors,
    ast_grep_violations: astGrepViolations,
    clone_ratio: cloneRatio,
    trivial_wrappers: trivialWrappers,
    single_use_functions: singleUseFunctions,
    loc,
    delta_loc: deltaLoc ?? null,
    delta_cc_high_count: deltaCcHighCount ?? null,
    delta_ast_grep_violations: deltaAstGrepViolations ?? null,
    delta_churn_ratio: deltaChurnRatio ?? null,
  };
}

function inferSlopMetrics(events: PipelineEvent[]): SlopMetrics | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const direct = parseSlopMetrics(event.data.slop_metrics);
    if (direct) return direct;

    const nested = parseSlopMetrics(event.data.metrics);
    if (nested) return nested;
  }
  return undefined;
}

function inferAgentTokenUsage(
  events: PipelineEvent[]
): { input: number; output: number } | undefined {
  let input = 0;
  let output = 0;
  let found = false;

  for (const event of events) {
    const tokenUsage = event.data.token_usage;
    if (typeof tokenUsage === "object" && tokenUsage !== null) {
      const usage = tokenUsage as Record<string, unknown>;
      const inTokens = toInteger(usage.input ?? usage.input_tokens);
      const outTokens = toInteger(usage.output ?? usage.output_tokens);
      if (inTokens !== undefined || outTokens !== undefined) {
        found = true;
        input += inTokens ?? 0;
        output += outTokens ?? 0;
      }
    }

    const inTokens = toInteger(event.data.input_tokens);
    const outTokens = toInteger(event.data.output_tokens);
    if (inTokens !== undefined || outTokens !== undefined) {
      found = true;
      input += inTokens ?? 0;
      output += outTokens ?? 0;
    }
  }

  if (!found) return undefined;
  return { input, output };
}

function clampScore(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Math.round(value * 1000) / 1000;
}

export function computeTraceGrade(
  taskId: string,
  events: PipelineEvent[],
  overrides: Partial<TraceGradeWeights> = {}
): TraceGrade {
  const warnings: string[] = [];
  const weights = getWeights(overrides);

  if (events.length === 0) {
    warnings.push("no events found for task");
    return {
      task_id: taskId,
      score: clampScore(weights.base),
      retry_count: 0,
      compensation_count: 0,
      duration_ms: 0,
      cache_hit: false,
      warnings,
    };
  }

  const retryCount = inferRetryCount(events);
  const compensationCount = inferCompensationCount(events);
  const softInvariantCount = inferSoftInvariantViolations(events);
  const slopWarningCount = inferSlopWarningCount(events);
  const durationMs = inferDurationMs(events, warnings);
  const cacheHit = events.some((event) => event.type === "CacheHit");
  const slopMetrics = inferSlopMetrics(events);
  const tokenUsage = inferAgentTokenUsage(events);

  let score = weights.base;
  score -= retryCount * weights.retry_penalty;
  score -= compensationCount * weights.compensation_penalty;
  if (slopWarningCount > 3) score -= weights.slop_warning_penalty;
  score -= softInvariantCount * weights.soft_invariant_penalty;

  if (slopWarningCount > 0) {
    warnings.push(`slop warnings observed: ${slopWarningCount}`);
  }
  if (softInvariantCount > 0) {
    warnings.push(`soft invariant violations observed: ${softInvariantCount}`);
  }

  const grade: TraceGrade = {
    task_id: taskId,
    score: clampScore(score),
    retry_count: retryCount,
    compensation_count: compensationCount,
    duration_ms: durationMs,
    cache_hit: cacheHit,
    warnings,
  };

  if (slopMetrics) grade.slop_metrics = slopMetrics;
  if (tokenUsage) grade.agent_token_usage = tokenUsage;

  return grade;
}

export function writeTraceGrade(grade: TraceGrade): string {
  const outputPath = resolve(GRADES_DIR, `${grade.task_id}.json`);
  mkdirSync(resolve(GRADES_DIR), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(grade, null, 2) + "\n", "utf-8");
  return outputPath;
}

export function gradeTraceForTask(
  taskId: string,
  overrides: Partial<TraceGradeWeights> = {}
): TraceGradeResult {
  const events = replayForTask(taskId);
  const grade = computeTraceGrade(taskId, events, overrides);
  const output_path = writeTraceGrade(grade);
  return { grade, output_path };
}
