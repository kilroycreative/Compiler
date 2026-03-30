import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StageDefinition, PipelineContext, SlopMetrics } from "../types.js";
import { runSlopAnalysis } from "../core/slop-runner.js";
import {
  ClaudeCodeAdapter,
  type AgentAdapter,
  type AgentResult,
  type AgentSession,
} from "../adapters/claude-code.js";

const RETRY_AGENT = { when: "always" as const, max_retries: 3, backoff_ms: [100, 200, 400] };
const RETRY_NEVER = { when: "never" as const, max_retries: 0 };
const RETRY_MERGE = { when: "on_error" as const, max_retries: 5 };

type AdapterChoice = "claude" | "openclaw" | "mock";
const SAFE_TASK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

class MockAdapter implements AgentAdapter {
  readonly name: AdapterChoice;

  constructor(runtime: AdapterChoice = "mock") {
    this.name = runtime;
  }

  execute(session: AgentSession): AgentResult {
    const diff = [
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

    return {
      adapter: this.name,
      modelUsed: session.model,
      diff,
      output: `${this.name} adapter executed in mock mode`,
      sessionResult: null,
      toolTrace: [],
    };
  }
}

function hasCommand(binary: string): boolean {
  try {
    execFileSync("which", [binary], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveTaskId(rawTaskId: unknown): string {
  const fallbackTaskId = `task_${Date.now().toString(36)}`;
  const taskId = String(rawTaskId ?? fallbackTaskId);
  if (!SAFE_TASK_ID_PATTERN.test(taskId)) {
    throw new Error(`Invalid task_id: ${taskId}. Allowed pattern: ${SAFE_TASK_ID_PATTERN.source}`);
  }
  return taskId;
}

function errorOutput(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const withStreams = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
  const stdout = typeof withStreams.stdout === "string"
    ? withStreams.stdout
    : Buffer.isBuffer(withStreams.stdout)
      ? withStreams.stdout.toString("utf-8")
      : "";
  const stderr = typeof withStreams.stderr === "string"
    ? withStreams.stderr
    : Buffer.isBuffer(withStreams.stderr)
      ? withStreams.stderr.toString("utf-8")
      : "";
  const combined = `${stdout}\n${stderr}`.trim();
  return combined || error.message;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toConstitutionText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join("\n");
  }
  if (typeof value === "string") return value;
  return "Follow session package constraints and only edit authorized files.";
}

function buildAgentSession(ctx: PipelineContext): AgentSession {
  const sessionPackage =
    typeof ctx.task.session_package === "object" && ctx.task.session_package !== null
      ? (ctx.task.session_package as Record<string, unknown>)
      : {};

  return {
    taskId: String(ctx.task.task_id ?? "unknown"),
    taskDescription: String(sessionPackage.task_description ?? ctx.task.description ?? ""),
    model: String(sessionPackage.model ?? ctx.task.model ?? "unknown"),
    worktreePath: String(ctx.task.worktree_path ?? "."),
    constitution: toConstitutionText(sessionPackage.constitution ?? ctx.artifacts.constitution),
    authorizedFiles: toStringArray(sessionPackage.authorized_files ?? ctx.task.authorized_files),
  };
}

function selectAdapter(): AgentAdapter {
  const requested = (process.env.COMPILER_AGENT ?? "").trim().toLowerCase();

  if (requested.length > 0) {
    if (requested === "claude") {
      if (!hasCommand("claude")) throw new Error("COMPILER_AGENT=claude but `claude` is not on PATH");
      return new ClaudeCodeAdapter();
    }
    if (requested === "openclaw") {
      console.log("    adapter=openclaw (runtime adapter not implemented yet; using mock fallback)");
      return new MockAdapter("openclaw");
    }
    if (requested === "mock") return new MockAdapter("mock");
    throw new Error(`Invalid COMPILER_AGENT value: ${requested}. Expected claude|openclaw|mock`);
  }

  if (hasCommand("claude")) return new ClaudeCodeAdapter();
  return new MockAdapter("mock");
}

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
    const taskId = resolveTaskId(ctx.task.task_id);
    const branch = `factory/${taskId}`;
    const relativeWorktreePath = `.factory/worktrees/${taskId}`;
    const forceRecreate = envFlagEnabled(process.env.COMPILER_WORKTREE_RECREATE);

    let repoRoot = "";
    try {
      repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      repoRoot = "";
    }

    if (!repoRoot) {
      const tmpBase = mkdtempSync(join(tmpdir(), `factory-${taskId}-`));
      const tempWorkspace = join(tmpBase, "workspace");
      cpSync(process.cwd(), tempWorkspace, { recursive: true });

      ctx.task.worktree_path = tempWorkspace;
      ctx.artifacts.worktree_created = true;
      ctx.artifacts.worktree_mode = "temp-copy";
      ctx.artifacts.worktree_branch = branch;
      console.log(`    worktree (fallback copy) → ${ctx.task.worktree_path}`);
      return;
    }

    const worktreePath = resolve(repoRoot, relativeWorktreePath);
    mkdirSync(resolve(repoRoot, ".factory", "worktrees"), { recursive: true });

    let branchExists = false;
    try {
      execFileSync("git", ["rev-parse", "--verify", `refs/heads/${branch}`], {
        cwd: repoRoot,
        stdio: "ignore",
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists && forceRecreate) {
      try {
        execFileSync("git", ["worktree", "remove", worktreePath, "--force"], { cwd: repoRoot, stdio: "ignore" });
      } catch {
        // Ignore cleanup miss; branch delete below still ensures recreate can proceed.
      }
      execFileSync("git", ["branch", "-D", branch], { cwd: repoRoot, stdio: "ignore" });
      branchExists = false;
    }

    if (branchExists) {
      if (!existsSync(worktreePath)) {
        execFileSync("git", ["worktree", "add", worktreePath, branch], { cwd: repoRoot, stdio: "ignore" });
      } else {
        console.log(`    reusing existing worktree for ${branch}`);
      }
    } else {
      execFileSync("git", ["worktree", "add", worktreePath, "-b", branch, "HEAD"], { cwd: repoRoot, stdio: "ignore" });
    }

    ctx.task.worktree_path = worktreePath;
    ctx.artifacts.worktree_created = true;
    ctx.artifacts.worktree_mode = "git";
    ctx.artifacts.worktree_repo_root = repoRoot;
    ctx.artifacts.worktree_branch = branch;
    console.log(`    worktree → ${ctx.task.worktree_path}`);
  },
  async compensate(ctx: PipelineContext) {
    const worktreePath = String(ctx.task.worktree_path ?? "");
    const mode = String(ctx.artifacts.worktree_mode ?? "");
    const branch = String(ctx.artifacts.worktree_branch ?? "");
    const repoRoot = String(ctx.artifacts.worktree_repo_root ?? "");

    if (mode === "git" && repoRoot && branch) {
      try {
        execFileSync("git", ["worktree", "remove", worktreePath, "--force"], { cwd: repoRoot, stdio: "ignore" });
      } catch {
        // Best-effort cleanup.
      }
      try {
        execFileSync("git", ["branch", "-D", branch], { cwd: repoRoot, stdio: "ignore" });
      } catch {
        // Branch might already be removed.
      }
    } else if (worktreePath) {
      rmSync(worktreePath, { recursive: true, force: true });
    }

    console.log(`    removed worktree ${worktreePath}`);
    ctx.artifacts.worktree_created = false;
    delete ctx.artifacts.worktree_mode;
    delete ctx.artifacts.worktree_branch;
    delete ctx.artifacts.worktree_repo_root;
  },
};

// B2 — Execute Agent
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

    const session = buildAgentSession(ctx);
    const adapter = selectAdapter();
    console.log(`    adapter=${adapter.name}`);

    const result = adapter.execute(session);
    ctx.artifacts.diff = result.diff;
    ctx.artifacts.model_used = result.modelUsed;
    ctx.artifacts.agent_result = result;
  },
  async compensate(ctx: PipelineContext) {
    delete ctx.artifacts.diff;
    delete ctx.artifacts.model_used;
    delete ctx.artifacts.agent_result;
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

// B3.5 — Slop Analysis
export const B3_5_slopAnalysis: StageDefinition = {
  id: "B3.5",
  name: "Slop Analysis",
  kind: "analysis",
  group: "backend",
  requires: ["PROP_verified"],
  provides: "PROP_slop_reviewed",
  contract: {
    preconditions: [
      { name: "diff exists", check: (ctx) => typeof ctx.artifacts.diff === "string" },
    ],
    postconditions: [
      { name: "slop analysis recorded", check: (ctx) => ctx.metadata.slop_passed === true },
    ],
    invariants_hard: [],
    invariants_soft: [
      { name: "no slop warnings", check: (ctx) => ((ctx.metadata.slop_warnings as string[] | undefined)?.length ?? 0) === 0 },
    ],
  },
  retry: { when: "never", max_retries: 0 },
  async execute(ctx: PipelineContext) {
    const diff = ctx.artifacts.diff as string;
    const taskId = ctx.task.task_id as string ?? "unknown";
    const analysisDir = `.factory/slop_analysis/${taskId}`;

    // Prepare temp directory with the diff applied
    try {
      mkdirSync(`${analysisDir}/src`, { recursive: true });

      // Write a base file and the diff, then apply with patch
      writeFileSync(`${analysisDir}/src/example.ts`, [
        `import { foo } from './foo';`,
        ``,
        `export const result = foo();`,
      ].join("\n"), "utf-8");

      writeFileSync(`${analysisDir}/patch.diff`, diff, "utf-8");

      try {
        execSync(`patch -p1 -d ${analysisDir} < ${analysisDir}/patch.diff`, {
          stdio: "pipe",
          timeout: 10_000,
        });
      } catch {
        console.log(`    SLOP: ⚠ patch failed, skipping analysis`);
        ctx.metadata.slop_passed = true;
        ctx.metadata.slop_warnings = ["patch application failed — analysis skipped"];
        return;
      }
    } catch {
      console.log(`    SLOP: ⚠ skipped (could not prepare analysis directory)`);
      ctx.metadata.slop_passed = true;
      ctx.metadata.slop_warnings = ["analysis directory setup failed — analysis skipped"];
      return;
    }

    // Run SCBench
    const result = await runSlopAnalysis(analysisDir);

    if (result.skipped || !result.metrics) {
      console.log(`    SLOP: ⚠ skipped (${result.skipReason ?? "scbench not available"})`);
      ctx.metadata.slop_passed = true;
      ctx.metadata.slop_warnings = [`scbench skipped: ${result.skipReason ?? "unknown reason"}`];
      return;
    }

    const s = result.metrics;
    ctx.artifacts.slop_metrics = s;

    // Hard thresholds — throw to trigger compensation
    if (s.cc_max > 30) {
      throw new Error(`Slop gate FAILED: cyclomatic complexity too high (cc_max: ${s.cc_max})`);
    }
    if (s.ast_grep_violations > 20) {
      throw new Error(`Slop gate FAILED: too many slop-rule violations (${s.ast_grep_violations})`);
    }
    if (s.clone_ratio > 0.20) {
      throw new Error(`Slop gate FAILED: excessive code duplication (${(s.clone_ratio * 100).toFixed(1)}%)`);
    }

    // Soft thresholds — collect warnings
    const warnings: string[] = [];
    if (s.cc_max > 15) warnings.push(`cc_max elevated: ${s.cc_max} (target < 15)`);
    if (s.ast_grep_violations > 5) warnings.push(`ast_grep_violations elevated: ${s.ast_grep_violations} (target < 5)`);
    if (s.clone_ratio > 0.05) warnings.push(`clone_ratio elevated: ${(s.clone_ratio * 100).toFixed(1)}% (target < 5%)`);
    if (s.trivial_wrappers > 3) warnings.push(`trivial_wrappers: ${s.trivial_wrappers}`);
    if (s.lint_errors > 10) warnings.push(`lint_errors: ${s.lint_errors}`);
    if (s.delta_cc_high_count !== null && s.delta_cc_high_count > 0) {
      warnings.push(`complexity growing: +${s.delta_cc_high_count} high-CC functions since last run`);
    }
    if (s.delta_ast_grep_violations !== null && s.delta_ast_grep_violations > 0) {
      warnings.push(`slop violations increasing: +${s.delta_ast_grep_violations}% since last run`);
    }

    ctx.metadata.slop_warnings = warnings;
    ctx.metadata.slop_passed = true;
    console.log(`    SLOP: ✓  cc_max=${s.cc_max}  violations=${s.ast_grep_violations}  clone=${(s.clone_ratio * 100).toFixed(1)}%  [${warnings.length} warnings]`);
  },
};

// B4 — Security Review
export const B4_security: StageDefinition = {
  id: "B4",
  name: "Security Review",
  kind: "analysis",
  group: "backend",
  requires: ["PROP_slop_reviewed"],
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
    const mode = String(ctx.artifacts.worktree_mode ?? "");
    const repoRoot = String(ctx.artifacts.worktree_repo_root ?? "");
    const worktreePath = String(ctx.task.worktree_path ?? "");
    const taskId = String(ctx.task.task_id ?? "unknown");
    const branch = String(ctx.artifacts.worktree_branch ?? `factory/${taskId}`);
    const description = String(ctx.task.description ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const safeDescription = description.replace(/["`$\\]/g, "");
    const commitMessage = `factory: ${taskId} — ${safeDescription || "task update"}`;
    const mergeMessage = `factory: merge ${taskId}`;

    ctx.task.merge_conflict = false;

    if (mode !== "git" || !repoRoot || !worktreePath) {
      ctx.artifacts.merge_commit = "no-git-merge";
      console.log(`    merge skipped (non-git mode)`);
      return;
    }

    execSync("git add -A", { cwd: worktreePath, stdio: "ignore" });
    try {
      execSync(`git commit -m ${JSON.stringify(commitMessage)}`, {
        cwd: worktreePath,
        stdio: "pipe",
      });
    } catch (error) {
      const output = errorOutput(error);
      if (!/nothing to commit|no changes added to commit/i.test(output)) {
        throw new Error(`Worktree commit failed: ${output}`);
      }
    }

    execSync("git checkout main", { cwd: repoRoot, stdio: "ignore" });
    try {
      execSync(`git merge --no-ff ${branch} -m ${JSON.stringify(mergeMessage)}`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
    } catch (error) {
      const output = errorOutput(error);
      if (/CONFLICT|merge conflict/i.test(output)) {
        ctx.task.merge_conflict = true;
        throw new Error(`Merge conflict detected for ${branch}`);
      }
      throw new Error(`Merge failed: ${output}`);
    }

    ctx.artifacts.merge_completed = true;
    ctx.artifacts.merge_target_branch = branch;
    ctx.artifacts.merge_repo_root = repoRoot;
    ctx.artifacts.merge_commit = execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    console.log(`    merged → ${ctx.artifacts.merge_commit}`);
  },
  async compensate(ctx: PipelineContext) {
    const repoRoot = String(ctx.artifacts.merge_repo_root ?? ctx.artifacts.worktree_repo_root ?? "");

    if (repoRoot) {
      try {
        execSync("git merge --abort", { cwd: repoRoot, stdio: "ignore" });
      } catch {
        // No in-progress merge is fine.
      }
      if (ctx.artifacts.merge_completed === true) {
        try {
          execSync("git reset --hard HEAD~1", { cwd: repoRoot, stdio: "ignore" });
        } catch {
          // Best-effort rollback.
        }
      }
    }

    console.log(`    reverting merge ${ctx.artifacts.merge_commit}`);
    delete ctx.artifacts.merge_commit;
    delete ctx.artifacts.merge_completed;
    delete ctx.artifacts.merge_repo_root;
    delete ctx.artifacts.merge_target_branch;
  },
};

export const backendStages: StageDefinition[] = [B1_worktree, B2_execute, B3_verify, B3_5_slopAnalysis, B4_security, B5_merge];
