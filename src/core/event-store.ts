import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PipelineEvent } from "../types.js";

const LOG_PATH = ".factory/events.jsonl";

function ensureDir() {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function append(event: PipelineEvent): void {
  ensureDir();
  appendFileSync(LOG_PATH, JSON.stringify(event) + "\n");
}

export function replay(): PipelineEvent[] {
  if (!existsSync(LOG_PATH)) return [];
  return readFileSync(LOG_PATH, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as PipelineEvent);
}

export function replayForTask(taskId: string): PipelineEvent[] {
  return replay().filter((e) => e.task_id === taskId);
}

export function getLastEvent(taskId: string): PipelineEvent | undefined {
  const events = replayForTask(taskId);
  return events[events.length - 1];
}

export function emit(
  type: PipelineEvent["type"],
  taskId: string,
  stageId?: string,
  data: Record<string, unknown> = {}
): PipelineEvent {
  const event: PipelineEvent = {
    type,
    task_id: taskId,
    stage_id: stageId,
    timestamp: new Date().toISOString(),
    data,
  };
  append(event);
  return event;
}
