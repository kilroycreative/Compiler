import type {
  StageHooks,
  DependencyResult,
  ConflictResult,
  VerifyResult,
  SecurityResult,
} from "./types.js";

export const defaultHooks: StageHooks = {
  async analyzeDependencies(_task: Record<string, unknown>): Promise<DependencyResult> {
    return { dependencies: [], authorized_files: ["src/**/*.ts"] };
  },

  async predictConflicts(_task: Record<string, unknown>): Promise<ConflictResult> {
    return { conflict_risk: "none" };
  },

  async runVerification(_task: Record<string, unknown>, _worktreePath: string): Promise<VerifyResult> {
    return { fail_to_pass: true, pass_to_pass: true };
  },

  async runSecurityScan(_task: Record<string, unknown>, diff: string): Promise<SecurityResult> {
    const hasSecrets = /password|secret|api_key|token/i.test(diff);
    return { security_clear: !hasSecrets };
  },
};
