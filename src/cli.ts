import { rmSync } from "node:fs";
import type { PipelineContext, SlopMetrics } from "./types.js";
import { emit, replay } from "./core/event-store.js";
import { runPipeline } from "./core/pipeline.js";
import { frontendStages } from "./stages/frontend.js";
import { middleStages } from "./stages/middle.js";
import { backendStages } from "./stages/backend.js";
import { linkerStages } from "./stages/linker.js";

const allStages = [...frontendStages, ...middleStages, ...backendStages, ...linkerStages];

function freshContext(description: string): PipelineContext {
  return {
    task: { description },
    properties: new Set(),
    metadata: {},
    artifacts: {},
  };
}

async function main() {
  // Clean slate
  rmSync(".factory", { recursive: true, force: true });

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Factory Compiler Pipeline — Prototype");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Run 1: Fresh task ────────────────────────────────────────────
  console.log("── Run 1: Fresh task ──────────────────────────────────");
  const ctx1 = freshContext("Add a helper function to parse user input");
  emit("TaskCreated", "pending", undefined, { description: ctx1.task.description });

  const result1 = await runPipeline(allStages, ctx1, ctx1.task.task_id as string ?? "pending");
  console.log(`\n  Result: ${result1.success ? "SUCCESS" : "FAILED — " + result1.error}`);
  console.log(`  Properties: ${[...ctx1.properties].join(", ")}`);
  if (ctx1.artifacts.merge_commit) {
    console.log(`  Merge commit: ${ctx1.artifacts.merge_commit}`);
  }

  // ── Run 2: Same task (should hit cache) ──────────────────────────
  console.log("\n── Run 2: Same task (expect cache hit) ───────────────");
  const ctx2 = freshContext("Add a helper function to parse user input");
  emit("TaskCreated", "pending", undefined, { description: ctx2.task.description });

  const result2 = await runPipeline(allStages, ctx2, ctx2.task.task_id as string ?? "pending");
  console.log(`\n  Result: ${result2.success ? "SUCCESS" : "FAILED — " + result2.error}`);
  console.log(`  Cache hit: ${ctx2.metadata.cache_hit}`);

  // ── Slop Analysis Summary ─────────────────────────────────────────
  if (ctx1.artifacts.slop_metrics) {
    const s = ctx1.artifacts.slop_metrics as SlopMetrics;
    console.log(`\n── Slop Analysis (Run 1) ─────────────────────────────`);
    console.log(`   cc_max=${s.cc_max}  violations=${s.ast_grep_violations}  clone=${(s.clone_ratio * 100).toFixed(1)}%  loc=${s.loc}`);
    if (ctx1.metadata.slop_warnings && (ctx1.metadata.slop_warnings as string[]).length > 0) {
      console.log(`   Warnings:`);
      for (const w of ctx1.metadata.slop_warnings as string[]) console.log(`     ⚠ ${w}`);
    }
  }

  if (ctx2.artifacts.slop_metrics) {
    const s = ctx2.artifacts.slop_metrics as SlopMetrics;
    console.log(`\n── Slop Analysis (Run 2) ─────────────────────────────`);
    console.log(`   cc_max=${s.cc_max}  violations=${s.ast_grep_violations}  clone=${(s.clone_ratio * 100).toFixed(1)}%  loc=${s.loc}`);
    if (ctx2.metadata.slop_warnings && (ctx2.metadata.slop_warnings as string[]).length > 0) {
      console.log(`   Warnings:`);
      for (const w of ctx2.metadata.slop_warnings as string[]) console.log(`     ⚠ ${w}`);
    }
  }

  // ── Event log summary ────────────────────────────────────────────
  const events = replay();
  console.log(`\n── Event Log: ${events.length} events ──────────────────────────`);
  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  for (const [type, count] of byType) console.log(`  ${type}: ${count}`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Done.");
  console.log("═══════════════════════════════════════════════════════");
}

main().catch(console.error);
