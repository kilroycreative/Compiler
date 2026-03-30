import type { PipelineContext } from "../types.js";

export interface AgentsMdOptions {
  taskId: string;
  constitution: string[];
  authorizedFiles: string[];
}

export function generateAgentsMd(options: AgentsMdOptions): string {
  const { taskId, constitution, authorizedFiles } = options;

  const instructionsBlock = constitution
    .map((line) => line)
    .join("\n");

  const filesBlock = authorizedFiles
    .map((glob) => `- \`${glob}\``)
    .join("\n");

  return `# AGENTS.md

## Agent: factory-worker-${taskId}

### Role
Coding agent executing a bounded task against a git worktree.

### Instructions
${instructionsBlock}

### Authorized Files
${filesBlock}

### Tools
- file_read
- file_write
- shell_exec (scoped to worktree)
- git_diff
- git_commit

### Constraints
- Do not modify files outside authorized globs
- Do not install new dependencies without explicit instruction
- Commit after each logical change
- All changes must pass verification before merge
`;
}

export function agentsMdFromContext(ctx: PipelineContext): string {
  const taskId = ctx.task.task_id as string;
  const constitution = ctx.artifacts.constitution as string[];
  const authorizedFiles = ctx.task.authorized_files as string[];

  return generateAgentsMd({ taskId, constitution, authorizedFiles });
}
