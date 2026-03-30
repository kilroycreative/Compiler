export interface DependencyResult {
  dependencies: string[];
  authorized_files: string[];
}

export interface ConflictResult {
  conflict_risk: string;
}

export interface VerifyResult {
  fail_to_pass: boolean;
  pass_to_pass: boolean;
}

export interface SecurityResult {
  security_clear: boolean;
}

export interface StageHooks {
  analyzeDependencies?: (task: Record<string, unknown>) => Promise<DependencyResult>;
  predictConflicts?: (task: Record<string, unknown>) => Promise<ConflictResult>;
  runVerification?: (task: Record<string, unknown>, worktreePath: string) => Promise<VerifyResult>;
  runSecurityScan?: (task: Record<string, unknown>, diff: string) => Promise<SecurityResult>;
}
