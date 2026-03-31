// ── User Input Parser ─────────────────────────────────────────────

export interface AnalyzedInput {
  action: string;
  target: string;
  description: string;
  identifiers: string[];
  filePaths: string[];
}

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

// Matches code identifiers: camelCase, PascalCase, snake_case, SCREAMING_CASE
// Ignores plain English words (all lowercase, no underscores, ≤ 1 capital)
const IDENTIFIER_PATTERN = /\b([A-Z][\w]*[a-z][\w]*|[a-z]+(?:[A-Z][\w]*)+|[a-z]+(?:_[a-z]+)+|[A-Z][A-Z_]{2,})\b/g;

/**
 * Extract code-style identifiers from user input text.
 * Recognises camelCase, PascalCase, snake_case, and SCREAMING_SNAKE_CASE.
 * Returns unique identifiers in the order they first appear.
 */
export function extractIdentifiers(text: string): string[] {
  IDENTIFIER_PATTERN.lastIndex = 0;
  const seen = new Set<string>();
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = IDENTIFIER_PATTERN.exec(text)) !== null) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

// Matches paths like src/core/foo.ts, ./lib/bar.js, components/Baz.tsx
const FILE_PATH_PATTERN = /(?:^|\s)(\.?\.?(?:[\w.@-]+\/)+[\w.@-]+\.[\w]+)(?=\s|$)/g;

/**
 * Extract file path references from user input text.
 * Useful for inferring authorized_files and dependency scope.
 */
export function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  FILE_PATH_PATTERN.lastIndex = 0;
  while ((m = FILE_PATH_PATTERN.exec(text)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/**
 * Analyze raw user input into a structured result combining action parsing,
 * identifier extraction, and file path detection.
 */
export function analyzeInput(raw: string): AnalyzedInput {
  const { action, target, description } = parseUserInput(raw);
  const identifiers = extractIdentifiers(raw);
  const filePaths = extractFilePaths(raw);
  return { action, target, description, identifiers, filePaths };
}
