import type { PipelineContext } from "../types.js";
import { emit } from "./event-store.js";

type CompensationEntry = {
  stageId: string;
  undo: (ctx: PipelineContext) => Promise<void>;
};

const stack: CompensationEntry[] = [];

export function register(stageId: string, undo: (ctx: PipelineContext) => Promise<void>): void {
  stack.push({ stageId, undo });
}

export async function compensateFrom(taskId: string, ctx: PipelineContext): Promise<void> {
  console.log(`  Compensating ${stack.length} stage(s) in LIFO order...`);
  emit("CompensationStarted", taskId, undefined, { count: stack.length });

  while (stack.length > 0) {
    const entry = stack.pop()!;
    try {
      console.log(`    ↩ undo ${entry.stageId}`);
      await entry.undo(ctx);
    } catch (err) {
      console.error(`    ✗ compensation failed for ${entry.stageId}:`, err);
    }
  }

  emit("CompensationCompleted", taskId);
}

export function clear(): void {
  stack.length = 0;
}
