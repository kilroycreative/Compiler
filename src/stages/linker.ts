import type { StageDefinition } from "../types.js";
import * as cache from "../core/action-cache.js";
import { emit } from "../core/event-store.js";

// L1 — Link / Finalize
export const L1_link: StageDefinition = {
  id: "L1",
  name: "Link & Finalize",
  kind: "transform",
  group: "linker",
  requires: ["PROP_merged"],
  provides: "PROP_linked",
  contract: {
    preconditions: [],
    postconditions: [],
    invariants_hard: [],
    invariants_soft: [],
  },
  retry: { when: "on_error", max_retries: 2 },
  async execute(ctx) {
    // Store result in action cache for future dedup
    const key = ctx.task.idempotency_key as string;
    cache.store(key, {
      diff: ctx.artifacts.diff,
      merge_commit: ctx.artifacts.merge_commit,
      model: ctx.task.model,
      completed_at: new Date().toISOString(),
    });
    emit("CacheStore", ctx.task.task_id as string, "L1", { key });

    console.log(`    cached result under key ${key.slice(0, 12)}...`);
  },
};

export const linkerStages: StageDefinition[] = [L1_link];
