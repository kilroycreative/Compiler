export type AgentRuntime = "claude" | "openclaw" | "mock";

export interface AgentSession {
  taskId: string;
  taskDescription: string;
  model: string;
  worktreePath: string;
  constitution: string;
  authorizedFiles: string[];
}

export interface AgentResult {
  adapter: AgentRuntime;
  modelUsed: string;
  diff: string;
  output: string;
  sessionResult: Record<string, unknown> | null;
  toolTrace: Array<Record<string, unknown>>;
}

export interface AgentAdapter {
  readonly name: AgentRuntime;
  execute(session: AgentSession): AgentResult;
}
