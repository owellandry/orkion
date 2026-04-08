import { interpretResearchIntent, normalizeGoal } from "./research-intent.ts";
import type { IntentAnalysis, ResearchIntent, TaskRequest } from "../types/agent.ts";

const IMPLIED_REFERENCE_PATTERNS = [/\beso\b/i, /\besa\b/i, /\bese\b/i, /\besto\b/i, /\bel framework\b/i, /\bel proyecto\b/i];
const INFORMATIVE_ENTITY_SUFFIXES = new Set([
  "framework",
  "library",
  "runtime",
  "router",
  "plugin",
  "package",
  "sdk",
  "api",
  "worker",
  "workers",
  "docs",
  "documentation",
  "cloudflare",
  "react",
  "vite",
  "next",
  "nextjs",
  "node",
  "bun",
  "cli",
  "toolkit",
  "kit"
]);
const WEAK_ENTITY_TOKENS = new Set(["que", "es", "what", "is", "como", "how", "el", "la", "un", "una"]);

function cleanupWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferEntityFromHistory(task: TaskRequest): string | undefined {
  if (!task.context?.length) {
    return undefined;
  }

  for (const line of [...task.context].reverse()) {
    const raw = line.replace(/^(user|assistant):\s*/i, "").trim();
    if (!raw) continue;
    const intent = interpretResearchIntent(raw);
    if (intent.targetEntity && intent.targetEntity.length >= 3 && intent.targetEntity !== intent.normalizedGoal) {
      return intent.targetEntity;
    }
  }

  return undefined;
}

function shouldPullEntityFromHistory(cleanedGoal: string): boolean {
  return IMPLIED_REFERENCE_PATTERNS.some((pattern) => pattern.test(cleanedGoal));
}

function isPlainWord(token: string): boolean {
  return /^[a-z]+$/i.test(token);
}

function buildCandidateGoals(goal: string): string[] {
  const cleaned = cleanupWhitespace(goal.replace(/[?!.]+/g, " "));
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const candidates = [cleaned];

  if (tokens.length >= 2 && isPlainWord(tokens[tokens.length - 1])) {
    candidates.push(tokens.slice(0, -1).join(" "));
  }

  if (tokens.length >= 3 && isPlainWord(tokens[tokens.length - 1]) && isPlainWord(tokens[tokens.length - 2])) {
    candidates.push(tokens.slice(0, -2).join(" "));
  }

  return [...new Set(candidates.filter(Boolean))];
}

function scoreIntent(intent: ResearchIntent): number {
  const entityTokens = intent.targetEntity.split(/\s+/).filter(Boolean);
  const lastToken = entityTokens[entityTokens.length - 1]?.toLowerCase() ?? "";
  const firstToken = entityTokens[0]?.toLowerCase() ?? "";
  const tokenCount = entityTokens.length;
  let score = 0;

  if (intent.targetEntity !== intent.normalizedGoal) score += 4;
  if (tokenCount === 1) score += 3;
  else if (tokenCount === 2) score += 1;
  else score -= 2;

  if (INFORMATIVE_ENTITY_SUFFIXES.has(lastToken)) {
    score += tokenCount === 2 ? 4 : 2;
  } else if (tokenCount > 1 && isPlainWord(lastToken)) {
    score -= 3;
  }

  if (WEAK_ENTITY_TOKENS.has(firstToken) || intent.targetEntity.length < 3) {
    score -= 8;
  }

  if (intent.researchRequired) score += 1;

  return score;
}

function chooseBestResolvedGoal(goal: string): { resolvedGoal: string; strippedTokens: string[]; intent: ResearchIntent } {
  const candidates = buildCandidateGoals(goal);
  const ranked = candidates
    .map((candidate) => {
      const normalizedCandidate = normalizeGoal(candidate);
      const intent = interpretResearchIntent(normalizedCandidate);
      return {
        goal: normalizedCandidate,
        intent,
        score: scoreIntent(intent)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.goal.length - right.goal.length;
    });

  const best = ranked[0];
  const originalTokens = cleanupWhitespace(goal.replace(/[?!.]+/g, " ")).split(/\s+/).filter(Boolean);
  const bestTokens = best.goal.split(/\s+/).filter(Boolean);
  const strippedTokens = originalTokens.slice(bestTokens.length).map((token) => token.toLowerCase());

  return {
    resolvedGoal: best.goal,
    strippedTokens,
    intent: best.intent
  };
}

function rewriteGoalForExecution(task: TaskRequest): { resolvedGoal: string; strippedTokens: string[]; inferredEntityFromHistory: boolean; intent: ResearchIntent } {
  const candidate = chooseBestResolvedGoal(task.goal);
  let resolvedGoal = candidate.resolvedGoal;
  let inferredEntityFromHistory = false;
  let intent = candidate.intent;

  if (shouldPullEntityFromHistory(resolvedGoal)) {
    const historicalEntity = inferEntityFromHistory(task);
    if (historicalEntity) {
      inferredEntityFromHistory = true;
      resolvedGoal = normalizeGoal(cleanupWhitespace(`${resolvedGoal} ${historicalEntity}`));
      intent = interpretResearchIntent(resolvedGoal);
    }
  }

  return {
    resolvedGoal,
    strippedTokens: candidate.strippedTokens,
    inferredEntityFromHistory,
    intent
  };
}

export class IntentAgent {
  analyze(task: TaskRequest): IntentAnalysis {
    const rewrite = rewriteGoalForExecution(task);

    return {
      originalGoal: task.goal,
      resolvedGoal: rewrite.resolvedGoal,
      strippedTokens: rewrite.strippedTokens,
      inferredEntityFromHistory: rewrite.inferredEntityFromHistory,
      intent: rewrite.intent
    };
  }
}
