const TIER_1_TOOLS: readonly string[] = [
  "file_read",
  "file_write",
  "shell_exec",
  "git_diff",
  "git_commit",
];

const TIER_2_TOOLS: readonly string[] = [
  ...TIER_1_TOOLS,
  "web_search",
  "dependency_install",
];

const TIER_3_TOOLS: readonly string[] = [
  ...TIER_2_TOOLS,
  "git_merge",
  "env_modify",
];

const TIERS: Record<1 | 2 | 3, readonly string[]> = {
  1: TIER_1_TOOLS,
  2: TIER_2_TOOLS,
  3: TIER_3_TOOLS,
};

export function allowedToolsForTier(tier: 1 | 2 | 3): string[] {
  return [...TIERS[tier]];
}
