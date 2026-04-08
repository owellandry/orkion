import type { ResearchIntent, ResearchIntentType } from "../types/agent.ts";

const CHAT_PATTERNS = [/^hola\b/i, /\bque onda\b/i, /\bsaluda\b/i];
const CALCULATION_PATTERNS = [/\bcalculate\b/i, /\bcalcula\b/i, /\bmath\b/i, /\bsum\b/i, /\bresta\b/i, /\bmultiply\b/i];
const COMMIT_PATTERN = /\bcomm?it(?:ear|ea|eando|eado|eados|eadas)?\b/i;
const GIT_PATTERNS = [/\bgit\b/i, COMMIT_PATTERN, /\bpush\b/i, /\bpull\b/i, /\bbranch\b/i, /\bmerge\b/i, /\bpr\b/i, /\brama\b/i, /\brepositorio local\b/i];
const SYSTEM_PATTERNS = [/\bcomando\b/i, /\bconsola\b/i, /\bterminal\b/i, /\bbash\b/i, /\bshell\b/i, /\bsistema\b/i, /\bcrea(r)? (una )?(carpeta|directorio|archivo|file)\b/i, /\bejecuta(r)?\b/i, /\blista(r)? archivos\b/i];
const DATE_TIME_PATTERNS = [
  /\bque dia es hoy\b/i,
  /\bque fecha es hoy\b/i,
  /\bque hora es\b/i,
  /\bque dia es\b/i,
  /\bque fecha es\b/i,
  /\bsabes el dia que es hoy\b/i,
  /\bhoy que dia es\b/i,
  /\btoday'?s date\b/i,
  /\bwhat day is it\b/i,
  /\bwhat time is it\b/i,
  /\bcurrent time\b/i,
  /\bcurrent date\b/i,
  /\bfecha de hoy\b/i,
  /\bdia de hoy\b/i,
  /\bhora actual\b/i
];
const CURRENT_INFO_PATTERNS = [/\bprecio\b/i, /\bactualmente\b/i, /\bcotizacion\b/i];
const HOW_IT_WORKS_PATTERNS = [/\bcomo funciona\b/i, /\bayudarme a entender\b/i, /\bhow it works\b/i];
const DEFINITION_PATTERNS = [/\bque es\b/i, /\bque trata\b/i, /\bwhat is\b/i];
const URL_PATTERNS = [/\bhttp(s)?:\/\//i, /\burl\b/i, /\bsitio\b/i, /\bwebsite\b/i, /\bpagina\b/i];
const COMPARISON_PATTERNS = [/\bvs\b/i, /\bcompar(a|ar|acion)\b/i, /\bversus\b/i, /\bmejor\b/i, /\bpeor\b/i, /\bconviene\b/i, /\bbetter\b/i, /\bworse\b/i];
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
  /\bnecesito saber\b/gi,
  /\bpuedes (revisar|decirme|explicarme|buscarme|decir|explicar|buscar|contarme|contar)\b/gi,
  /\bdime\b/gi,
  /\brevisar\b/gi,
  /\bse que\b/gi,
  /\bya se que\b/gi,
  /\btengo entendido que\b/gi,
  /\bme puedes (decir|explicar|contar|ayudar)\b/gi,
  /\bpuedes\b/gi
];

function cleanupWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeGoal(goal: string): string {
  const withoutFiller = FILLER_PATTERNS.reduce((current, pattern) => current.replace(pattern, " "), goal);
  return cleanupWhitespace(withoutFiller.replace(/[?!.]+/g, " "));
}

function detectIntentType(goal: string): ResearchIntentType {
  if (GIT_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "git_operation";
  }

  if (SYSTEM_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "system_operation";
  }

  if (DATE_TIME_PATTERNS.some((pattern) => pattern.test(goal))) {
    return "date_time";
  }

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

// Stopwords that signal the entity name has ended.
// e.g. "openvite se que es" → stop at "se", entity = "openvite"
const ENTITY_STOP_RE = /\s+(?:se|que|es|un|una|los|las|pero|por|con|en|sin|como|esto|este|esta|es que|is|a|an|the|but|for|with|and|or|if|when|its)\b/i;

// Common English/Spanish words that should never be an entity
const COMMON_WORDS = new Set([
  "puedes", "puede", "quiero", "quiere", "necesito", "necesita",
  "busca", "busco", "buscar", "revisar", "decir", "decirme", "dime",
  "explicar", "explicame", "contar", "contarme", "ayuda", "ayudar",
  "que", "es", "un", "una", "el", "la", "los", "las", "de", "del",
  "se", "si", "no", "pero", "por", "para", "con", "en", "a", "y", "o",
  "what", "is", "are", "how", "does", "do", "the", "a", "an", "of",
  "and", "or", "but", "for", "with", "about", "tell", "me", "can", "you"
]);

function extractTargetEntity(normalizedGoal: string): string {
  const directUrl = extractUrls(normalizedGoal)[0];
  if (directUrl) {
    try {
      return new URL(directUrl).hostname.replace(/^www\./, "");
    } catch {
      return directUrl;
    }
  }

  // Match after common phrase starters, but stop at the first stopword
  const phraseMatch = normalizedGoal.match(
    /\b(?:que es|como funciona|precio del?|precio de|informacion sobre|info de|what is|how (?:does|do|is)|tell me about)\s+(.+)/i
  );

  if (phraseMatch?.[1]) {
    const tail = phraseMatch[1]
      .split(",")[0]
      .split(/\by luego\b/i)[0]
      .split(/\bpara\b/i)[0]
      .split(/\bluego\b/i)[0];

    // Stop at the first stopword boundary
    const stopIdx = tail.search(ENTITY_STOP_RE);
    const candidate = (stopIdx > 0 ? tail.slice(0, stopIdx) : tail).trim();

    if (candidate.length > 0 && !COMMON_WORDS.has(candidate.toLowerCase())) {
      return cleanupWhitespace(candidate);
    }
  }

  // Look for kebab-case or dotted tech names first (high signal)
  const kebabMatch = normalizedGoal.match(/\b([a-z][a-z0-9]{1,}-[a-z][a-z0-9]+(?:-[a-z][a-z0-9]+)*)\b/i);
  if (kebabMatch?.[1] && !COMMON_WORDS.has(kebabMatch[1].toLowerCase())) {
    return kebabMatch[1];
  }

  // Look for CamelCase identifiers
  const camelMatch = normalizedGoal.match(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)\b/);
  if (camelMatch?.[1]) return camelMatch[1];

  // Fallback: find first token that is not a common word and is >= 3 chars
  const words = normalizedGoal.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z0-9._-]/gi, "");
    if (clean.length >= 3 && !COMMON_WORDS.has(clean.toLowerCase())) {
      return clean;
    }
  }

  // Last resort
  const tokenMatch = normalizedGoal.match(/\b([a-z0-9][a-z0-9._-]{2,})\b/i);
  return cleanupWhitespace(tokenMatch?.[1] ?? normalizedGoal);
}

export function interpretResearchIntent(goal: string): ResearchIntent {
  const normalizedGoal = normalizeGoal(goal);
  const type = detectIntentType(normalizedGoal);
  const contextHints = extractContextHints(normalizedGoal);
  const targetEntity = extractTargetEntity(normalizedGoal);
  const researchRequired = !["chat", "date_time"].includes(type) || extractUrls(goal).length > 0;

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
  return intent.researchRequired || intent.type === "calculation" || intent.type === "git_operation" || intent.type === "system_operation";
}
