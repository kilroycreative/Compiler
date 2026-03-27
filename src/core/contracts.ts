import type { PipelineContext, StageContract } from "../types.js";

export class ContractViolation extends Error {
  constructor(
    public stage: string,
    public kind: "precondition" | "postcondition" | "invariant_hard" | "invariant_soft",
    public check: string
  ) {
    super(`[${kind}] ${stage}: ${check}`);
    this.name = "ContractViolation";
  }
}

export function checkPreconditions(stageId: string, contract: StageContract, ctx: PipelineContext): void {
  for (const pc of contract.preconditions) {
    if (!pc.check(ctx)) {
      throw new ContractViolation(stageId, "precondition", pc.name);
    }
  }
}

export function checkPostconditions(stageId: string, contract: StageContract, ctx: PipelineContext): void {
  for (const pc of contract.postconditions) {
    if (!pc.check(ctx)) {
      throw new ContractViolation(stageId, "postcondition", pc.name);
    }
  }
}

export function checkInvariants(stageId: string, contract: StageContract, ctx: PipelineContext): void {
  for (const inv of contract.invariants_hard) {
    if (!inv.check(ctx)) {
      throw new ContractViolation(stageId, "invariant_hard", inv.name);
    }
  }
  for (const inv of contract.invariants_soft) {
    try {
      if (!inv.check(ctx)) {
        console.warn(`  ⚠ soft invariant warning: ${inv.name} (${stageId})`);
      }
    } catch {
      console.warn(`  ⚠ soft invariant warning: ${inv.name} (${stageId}) — check threw`);
    }
  }
}
