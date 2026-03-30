import type { AgentAdapter, AgentResult, AgentSession } from "./types.js";

export class OpenClawAdapter implements AgentAdapter {
  readonly name = "openclaw" as const;

  execute(_session: AgentSession): AgentResult {
    throw new Error("OpenClaw adapter not yet implemented");
  }
}
