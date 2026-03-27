import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CACHE_DIR = ".factory/cache";

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function computeKey(parts: Record<string, unknown>): string {
  const content = JSON.stringify(parts, Object.keys(parts).sort());
  return createHash("sha256").update(content).digest("hex");
}

export function lookup(key: string): Record<string, unknown> | null {
  const path = `${CACHE_DIR}/${key}.json`;
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

export function store(key: string, value: Record<string, unknown>): void {
  ensureDir();
  writeFileSync(`${CACHE_DIR}/${key}.json`, JSON.stringify(value, null, 2));
}
