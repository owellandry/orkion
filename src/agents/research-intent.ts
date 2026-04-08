import type { ResearchIntent, ResearchIntentType } from "../types/agent.ts";

const CHAT_PATTERNS = [/^hola\b/i, /\bque onda\b/i, /\bsaluda\b/i];
const CALCULATION_PATTERNS = [/\bcalculate\b/i, /\bcalcula\b/i, /\bmath\b/i, /\bsum\b/i, /\bresta\b/i, /\bmultiply\b/i];
const CURRENT_INFO_PATTERNS = [/\bprecio\b/i, /\bactualmente\b/i, /\bhoy\b/i, /\btoday\b/i, /\bcotizacion\b/i];
const HOW_IT_WORKS_PATTERNS = [/\bcomo funciona\b/i, /\bayudarme a entender\b/i, /\bhow it works\b/i];
const DEFINITION_PATTERNS = [/\bque es\b/i, /\bque trata\b/i, /\bwhat is\b/i];
const URL_PATTERNS = [/\bhttp(s)?:\/\//i, /\burl\b/i, /\bsitio\b/i, /\bwebsite\b/i, /\bpagina\b/i];
const COMPARISON_PATTERNS = [/\bvs\b/i, /\bcompar(a|ar|acion)\b/i, /\bversus\b/i];
const RESEARCH_HINT_PATTERNS = [
  /\bbusca(r)?\b/i,
  /\bsearch\b/i,
  /\binvestiga(r)?\b/i,
  /\baverigua(r)?\b/i,
  /\binfo\b/i,
  /\binformacion\b/i,
  /\bframework\b/i,
  /\blibreria\b/i,
  /\blibrary\b/i,
  /\bdocumentacion\b/i,
  /\bdocs?\b/i,
  /\bcloudflare\b/i,
  /\bweb\b/i,
  /\binternet\b/i,
  /\bnews\b/i,
  /\bnoticia\b/i
];

const FILLER_PATTERNS = [
  /\bhola\b/gi,
  /\bque onda\b/gi,
  /\bpuedes ayudarme\b/gi,
  /\bpor favor\b/gi,
  /\bme refiero a\b/gi,
  /\bquiero saber\b/gi,
  /\bnecesito saber\b/gi
];

function cleanupWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeGoal(goal: string): string {
  const withoutFiller = FILLER_PATTERNS.reduce((current, pattern) => current.replace(pattern, " "), goal);
  return cleanupWhitespace(withoutFiller.replace(/[?!.]+/g, " "));
}

function detectIntentType(goal: string): ResearchIntentType {
  if (CALCULATION_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "calculation";
  }

  if (CURRENT_INFO_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "current_info";
  }

  if (HOW_IT_WORKS_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "how_it_works";
  }

  if (DEFINITION_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "definition";
  }

  if (COMPARISON_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "comparison";
  }

  if (URL_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "url_verification";
  }

  if (RESEARCH_HINT_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "general_research";
  }

  return "chat";
}

function extractUrls(goal: string): string[] {
  return [...goal.matchAll(/https?:\/\/[^\s)]+/gi)].map((match) => match[0]);
}

function extractContextHints(goal: string): string[] {
  const lowered = goal.toLowerCase();
  const hints = new Set<string>();

  ["cloudflare", "framework", "docs", "documentation", "precio", "dolar", "web", "api", "github"].forEach((hint) => {
    if (lowered.includes(hint)) {
      hints.add(hint);
    }
  });

  return [...hints];
}

function extractTargetEntity(normalizedGoal: string): string {
  const directUrl = extractUrls(normalizedGoal)[0];
  if (directUrl) {
    try {
      return new URL(directUrl).hostname.replace(/^www\./, "");
    } catch {
      return directUrl;
    }
  }

  const match =
    normalizedGoal.match(/\b(?:que es|como funciona|framework de|precio del|precio de|informacion sobre|info de)\s+(.+)/i) ??
    normalizedGoal.match(/\b([a-z0-9][a-z0-9._-]{2,})\b/i);

  return cleanupWhitespace(match?.[1] ?? normalizedGoal);
}

export function interpretResearchIntent(goal: string): ResearchIntent {
  const normalizedGoal = normalizeGoal(goal);
  const type = detectIntentType(normalizedGoal);
  const contextHints = extractContextHints(normalizedGoal);
  const targetEntity = extractTargetEntity(normalizedGoal);
  const researchRequired = type !== "chat" || extractUrls(normalizedGoal).length > 0;

  return {
    type,
    normalizedGoal,
    targetEntity,
    contextHints,
    researchRequired
  };
}

export function hasResearchIntent(goal: string): boolean {
  return interpretResearchIntent(goal).researchRequired;
}

export function hasTaskExecutionIntent(goal: string): boolean {
  return CALCULATION_PATTERNS.some((pattern) => pattern.test(goal));
}

export function shouldDelegateTask(goal: string): boolean {
  const intent = interpretResearchIntent(goal);
  return intent.researchRequired || intent.type === "calculation";
}
