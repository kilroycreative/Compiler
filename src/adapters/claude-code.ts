import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

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

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude" as const;

  execute(session: AgentSession): AgentResult {
    const worktreePath = resolve(session.worktreePath);
    const hooksDir = join(worktreePath, ".factory", "hooks");
    const claudeDir = join(worktreePath, ".claude");
    mkdirSync(hooksDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });

    writeFileSync(join(worktreePath, "CLAUDE.md"), session.constitution, "utf-8");
    this.writeHookScripts(worktreePath, hooksDir, session.authorizedFiles);
    this.writeClaudeHookConfig(worktreePath);

    const run = spawnSync(
      "claude",
      [
        "--print",
        "--dangerously-skip-permissions",
        "--max-turns",
        "30",
        session.taskDescription,
      ],
      {
        cwd: worktreePath,
        encoding: "utf-8",
      }
    );

    if (run.error) {
      throw run.error;
    }
    if (run.status !== 0) {
      throw new Error(
        `claude CLI failed (exit=${run.status}): ${run.stderr || run.stdout || "no output"}`
      );
    }

    const sessionResultPath = join(worktreePath, ".factory", "session-result.json");
    const toolTracePath = join(worktreePath, ".factory", "tool-trace.jsonl");
    const sessionResult = readJsonObject(sessionResultPath);
    const toolTrace = readJsonLines(toolTracePath);
    const diffFromSession = typeof sessionResult?.diff === "string" ? sessionResult.diff : "";
    const diff = diffFromSession || readGitDiff(worktreePath);
    const output = [run.stdout, run.stderr].filter(Boolean).join("\n");

    return {
      adapter: this.name,
      modelUsed: session.model,
      diff,
      output,
      sessionResult,
      toolTrace,
    };
  }

  private writeHookScripts(worktreePath: string, hooksDir: string, authorizedFiles: string[]): void {
    const replacements = {
      AUTHORIZED_GLOBS_JSON: JSON.stringify(authorizedFiles),
      WORKTREE_PATH: worktreePath,
    };
    const hookSpecs: Array<{ template: string; output: string }> = [
      {
        template: "enforce-authorized-files.sh.tmpl",
        output: "enforce-authorized-files.sh",
      },
      {
        template: "log-tool-call.sh.tmpl",
        output: "log-tool-call.sh",
      },
      {
        template: "capture-session-result.sh.tmpl",
        output: "capture-session-result.sh",
      },
    ];

    for (const spec of hookSpecs) {
      const template = loadTemplate(spec.template);
      const rendered = renderTemplate(template, replacements);
      const destination = join(hooksDir, spec.output);
      writeFileSync(destination, rendered, "utf-8");
      chmodSync(destination, 0o755);
    }
  }

  private writeClaudeHookConfig(worktreePath: string): void {
    const settingsPath = join(worktreePath, ".claude", "settings.json");
    const settings = {
      hooks: {
        PreToolCall: [
          {
            matcher: "file_write|file_edit|shell_exec",
            hook: ".factory/hooks/enforce-authorized-files.sh",
          },
        ],
        PostToolCall: [
          {
            hook: ".factory/hooks/log-tool-call.sh",
          },
        ],
        Stop: [
          {
            hook: ".factory/hooks/capture-session-result.sh",
          },
        ],
      },
    };
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  }
}

function loadTemplate(templateName: string): string {
  const templateUrl = new URL(`../cc-hooks/${templateName}`, import.meta.url);
  return readFileSync(templateUrl, "utf-8");
}

function renderTemplate(template: string, replacements: Record<string, string>): string {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_match, key: string) => replacements[key] ?? "");
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw: readFileSync(filePath, "utf-8") };
  }
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const out: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>);
      } else {
        out.push({ value: parsed });
      }
    } catch {
      out.push({ raw: line });
    }
  }
  return out;
}

function readGitDiff(cwd: string): string {
  try {
    return execSync("git diff --no-color", {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}
