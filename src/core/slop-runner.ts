import { execSync } from "node:child_process";
import type { SlopMetrics } from "../types.js";

export interface SlopRunnerResult {
  metrics: SlopMetrics | null;
  skipped: boolean;
  skipReason?: string;
}

export async function runSlopAnalysis(worktreePath: string): Promise<SlopRunnerResult> {
  try {
    // Check whether scbench is available
    try {
      execSync("python -m slop_code.metrics.driver --version", {
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch {
      return { metrics: null, skipped: true, skipReason: "scbench not installed" };
    }

    // Run measure-snapshot and capture JSON output
    const stdout = execSync(
      `python -m slop_code.metrics.driver measure-snapshot ${worktreePath}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 },
    );

    const raw = JSON.parse(stdout) as Record<string, unknown>;

    const metrics: SlopMetrics = {
      cc_max: Number(raw.cc_max ?? 0),
      cc_mean: Number(raw.cc_mean ?? 0),
      cc_high_count: Number(raw.cc_high_count ?? 0),
      lint_errors: Number(raw.lint_errors ?? 0),
      ast_grep_violations: Number(raw.ast_grep_violations ?? 0),
      clone_ratio: Number(raw.clone_ratio ?? 0),
      trivial_wrappers: Number(raw.trivial_wrappers ?? 0),
      single_use_functions: Number(raw.single_use_functions ?? 0),
      loc: Number(raw.loc ?? 0),
      delta_loc: raw.delta_loc != null ? Number(raw.delta_loc) : null,
      delta_cc_high_count: raw.delta_cc_high_count != null ? Number(raw.delta_cc_high_count) : null,
      delta_ast_grep_violations: raw.delta_ast_grep_violations != null ? Number(raw.delta_ast_grep_violations) : null,
      delta_churn_ratio: raw.delta_churn_ratio != null ? Number(raw.delta_churn_ratio) : null,
    };

    return { metrics, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { metrics: null, skipped: true, skipReason: message };
  }
}
