export type HealthStatus = "healthy" | "degraded" | "tripped";

export interface AgentOutput {
  description: string;
  output: string;
  createdAt: string;
  activeSession: boolean;
  lastCommittedAt?: string;
}

export interface QualityCircuitBreaker {
  checkHealth(agentId: string, recentOutputs: AgentOutput[], now?: Date): HealthStatus;
}

export interface QualityCircuitBreakerConfig {
  minOutputChars: number;
  shortOutputWindow: number;
  duplicateWindow: number;
  duplicateSimilarityThreshold: number;
  staleCommitMinutes: number;
}

const DEFAULT_CONFIG: QualityCircuitBreakerConfig = {
  minOutputChars: 50,
  shortOutputWindow: 3,
  duplicateWindow: 5,
  duplicateSimilarityThreshold: 0.9,
  staleCommitMinutes: 10,
};

type Vector = Map<string, number>;

function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function toVector(text: string): Vector {
  const vector = new Map<string, number>();
  for (const token of toWords(text)) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

function cosineSimilarity(left: Vector, right: Vector): number {
  if (left.size === 0 || right.size === 0) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const count of left.values()) {
    leftMagnitude += count * count;
  }
  for (const count of right.values()) {
    rightMagnitude += count * count;
  }
  for (const [token, leftCount] of left) {
    dot += leftCount * (right.get(token) ?? 0);
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasThreeShortOutputs(outputs: AgentOutput[], minOutputChars: number, window: number): boolean {
  if (outputs.length < window) return false;
  const recent = outputs.slice(-window);
  return recent.every((output) => output.output.trim().length < minOutputChars);
}

function hasNearDuplicateDescriptions(outputs: AgentOutput[], threshold: number, window: number): boolean {
  if (outputs.length < window) return false;
  const recent = outputs.slice(-window).map((output) => toVector(output.description));

  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const score = cosineSimilarity(recent[i], recent[j]);
      if (score <= threshold) return false;
    }
  }
  return true;
}

function hasStaleCommit(outputs: AgentOutput[], staleCommitMinutes: number, now: Date): boolean {
  const recentActive = outputs.slice().reverse().find((output) => output.activeSession);
  if (!recentActive) return false;

  const lastCommitTime =
    outputs
      .slice()
      .reverse()
      .map((output) => parseIsoDate(output.lastCommittedAt))
      .find((value): value is Date => value !== null) ?? parseIsoDate(recentActive.createdAt);

  if (!lastCommitTime) return false;
  return now.getTime() - lastCommitTime.getTime() > staleCommitMinutes * 60_000;
}

export class DefaultQualityCircuitBreaker implements QualityCircuitBreaker {
  private readonly pausedAgents = new Set<string>();
  private readonly config: QualityCircuitBreakerConfig;

  constructor(config: Partial<QualityCircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  pauseAgent(agentId: string): void {
    this.pausedAgents.add(agentId);
  }

  isPaused(agentId: string): boolean {
    return this.pausedAgents.has(agentId);
  }

  checkHealth(agentId: string, recentOutputs: AgentOutput[], now: Date = new Date()): HealthStatus {
    if (this.isPaused(agentId)) return "tripped";

    const nearDuplicateOutputs = hasNearDuplicateDescriptions(
      recentOutputs,
      this.config.duplicateSimilarityThreshold,
      this.config.duplicateWindow
    );
    if (nearDuplicateOutputs) return "tripped";

    const shortOutputs = hasThreeShortOutputs(
      recentOutputs,
      this.config.minOutputChars,
      this.config.shortOutputWindow
    );
    const staleCommit = hasStaleCommit(recentOutputs, this.config.staleCommitMinutes, now);
    if (shortOutputs || staleCommit) return "degraded";

    return "healthy";
  }
}

export const qualityCircuitBreaker = new DefaultQualityCircuitBreaker();
