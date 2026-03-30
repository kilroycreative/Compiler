// ── User Input Parser ─────────────────────────────────────────────

export interface ParsedInput {
  action: string;
  target: string;
  description: string;
}

const KNOWN_ACTIONS = [
  "add", "create", "implement",
  "delete", "remove", "drop",
  "refactor", "rename", "move",
  "fix", "update", "migrate",
] as const;

const ACTION_PATTERN = new RegExp(
  `^(${KNOWN_ACTIONS.join("|")})\\b`,
  "i",
);

export function parseUserInput(raw: string): ParsedInput {
  const description = raw.trim();
  if (!description) {
    throw new Error("Empty input");
  }

  const match = description.match(ACTION_PATTERN);
  const action = match ? match[1].toLowerCase() : "unknown";
  const target = match
    ? description.slice(match[0].length).trim()
    : description;

  return { action, target, description };
}
