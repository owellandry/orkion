import { McpClientAdapter, type McpClientLike } from "../mcp/client-adapter.ts";
import { interpretResearchIntent } from "./research-intent.ts";
import type {
  AgentExecutionContext,
  AgentTaskResult,
  ConfidenceLevel,
  DelegationPlan,
  ExecutionEvent,
  ResearchIntent,
  ResearchSession,
  ResearchSource,
  ResearchSourceKind,
  SubAgent,
  TaskRequest,
  ToolCallRecord
} from "../types/agent.ts";

export const LYRA_AGENT_NAME = "lyra";
export const LYRA_AGENT_PROMPT = [
  "Eres Lyra, la agente de consultas web de Orkion.",
  "Investigas de forma persistente hasta agotar opciones razonables.",
  "Primero usas heuristicas baratas, luego reformulas consultas si la evidencia sigue debil.",
  "Prioriza fuente oficial, docs, repositorio, README, paquete npm o dominio principal antes de concluir.",
  "Nunca te rindas tras una sola busqueda fallida y no le pidas al usuario que te ayude si todavia puedes seguir investigando.",
  "Tu salida debe ser una conclusion concreta, mas una nota de incertidumbre breve solo si la evidencia no es fuerte."
].join(" ");

interface SearchResultItem {
  title: string;
  url: string;
}

interface ExtractedLinkItem {
  url: string;
  text: string;
}

interface GitHubReadmeResult {
  repoUrl?: string;
  readmeUrl?: string;
  preview?: string;
}

interface NpmPackageInfo {
  packageName?: string;
  description?: string;
  latestVersion?: string;
  homepage?: string;
  repositoryUrl?: string;
  keywords?: string[];
  license?: string;
}

function preview(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function shortText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function emit(
  context: AgentExecutionContext | undefined,
  scope: ExecutionEvent["scope"],
  message: string,
  data?: Record<string, unknown>
): void {
  context?.observer?.({ scope, kind: "status", message, data });
}

function extractMathExpression(goal: string): string | undefined {
  const mathMatch = goal.match(/([0-9()[\]\s+\-*/.]{3,})/);
  const candidate = mathMatch?.[1]?.trim();
  if (!candidate) return undefined;
  return /[+\-*/]/.test(candidate) ? candidate : undefined;
}

function extractUrls(goal: string): string[] {
  return [...goal.matchAll(/https?:\/\/[^\s)]+/gi)].map((match) => match[0]);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeEntityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizePathToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/@_-]/g, "");
}

function isGitHubRepoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("github.com")) return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length >= 2 && !parts[2]?.startsWith("issues");
  } catch {
    return false;
  }
}

function extractGitHubRepoUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("github.com")) return undefined;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return undefined;
    return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
  } catch {
    return undefined;
  }
}

function extractNpmPackageName(input: string): string | undefined {
  if (!input.startsWith("http")) {
    return input.trim() || undefined;
  }

  try {
    const parsed = new URL(input);
    if (!parsed.hostname.includes("npmjs.com")) return undefined;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const packageIndex = parts.findIndex((part) => part === "package");
    if (packageIndex === -1 || packageIndex === parts.length - 1) return undefined;
    return decodeURIComponent(parts.slice(packageIndex + 1).join("/"));
  } catch {
    return undefined;
  }
}

function classifySourceKind(url: string, intent: ResearchIntent, title = ""): ResearchSourceKind {
  const domain = getDomain(url).toLowerCase();
  const pathToken = normalizePathToken(url);
  const entityToken = normalizeEntityToken(intent.targetEntity);
  const contextTokens = intent.contextHints.map(normalizeEntityToken).filter(Boolean);
  const titleToken = normalizeEntityToken(title);

  if (entityToken) {
    if (domain.replace(/[^a-z0-9]/g, "").includes(entityToken)) return "official";
    if (pathToken.includes(entityToken)) return "official";
    if (titleToken.includes(entityToken)) return "official";
  }

  if (contextTokens.some((token) => domain.replace(/[^a-z0-9]/g, "").includes(token) || pathToken.includes(token))) {
    return "official";
  }

  if (isGitHubRepoUrl(url) || extractNpmPackageName(url)) {
    return pathToken.includes(entityToken) ? "official" : "secondary";
  }

  if (
    domain.includes("developers.cloudflare.com") ||
    domain.includes("docs.") ||
    domain.includes("readthedocs.io") ||
    domain.includes("jsr.io") ||
    domain.endsWith(".dev") ||
    domain.endsWith(".io")
  ) {
    return "secondary";
  }

  return "other";
}

function parseJsonSafely<T>(rawText: string): T | undefined {
  try {
    return JSON.parse(rawText) as T;
  } catch {
    return undefined;
  }
}

function parseSearchWebResult(rawText: string): SearchResultItem[] {
  const parsed = parseJsonSafely<{ results?: SearchResultItem[] }>(rawText);
  return parsed?.results ?? [];
}

function parseFetchPagePreview(rawText: string): string {
  const parsed = parseJsonSafely<{ preview?: string }>(rawText);
  return parsed?.preview ?? rawText;
}

function parseExtractedLinks(rawText: string): ExtractedLinkItem[] {
  const parsed = parseJsonSafely<{ links?: ExtractedLinkItem[] }>(rawText);
  return parsed?.links ?? [];
}

function parseGitHubReadme(rawText: string): GitHubReadmeResult {
  return parseJsonSafely<GitHubReadmeResult>(rawText) ?? {};
}

function parseNpmPackageInfo(rawText: string): NpmPackageInfo {
  return parseJsonSafely<NpmPackageInfo>(rawText) ?? {};
}

function buildInitialQueries(intent: ResearchIntent): string[] {
  const entity = intent.targetEntity;
  const context = intent.contextHints.join(" ").trim();
  const entityQuoted = `"${entity}"`;

  const candidates = [
    // Start with the simplest possible queries — just the entity name
    entity,
    entityQuoted,
    `${entity} github`,
    `${entity} npm`,
    `${entity} ${context}`.trim(),
    `what is ${entity}`,
    `${entity} ${context} framework`.trim(),
    `${entity} ${context} docs`.trim(),
    `${entity} ${context} readme`.trim(),
    `${entity} official documentation`.trim(),
    `site:github.com ${entity}`.trim(),
    `site:npmjs.com/package ${entity}`.trim(),
    `site:jsr.io ${entity}`.trim(),
    `${entityQuoted} ${context} package`.trim(),
    intent.normalizedGoal
  ];

  if (intent.type === "current_info") {
    candidates.unshift(`${entity} price today`);
    candidates.unshift(`${entity} precio actual`);
  }

  if (intent.type === "definition" || intent.type === "how_it_works" || intent.type === "general_research") {
    candidates.push(`${entity} ${context} how it works`.trim());
    candidates.push(`${entity} ${context} introduction`.trim());
    candidates.push(`${entity} ${context} getting started`.trim());
    candidates.push(`${entity} ${context} examples`.trim());
  }

  return unique(candidates.filter((query) => query.trim().length > 0));
}

function buildHeuristicReformulations(intent: ResearchIntent, round: number): string[] {
  const entity = intent.targetEntity;
  const context = intent.contextHints.join(" ").trim();
  const broadDomains = [
    `site:github.com ${entity} ${context}`.trim(),
    `site:github.com ${entity} README`.trim(),
    `site:npmjs.com/package ${entity}`.trim(),
    `site:registry.npmjs.org ${entity}`.trim(),
    `site:jsr.io ${entity}`.trim(),
    `site:readthedocs.io ${entity} ${context}`.trim(),
    `site:unpkg.com ${entity}`.trim(),
    `site:jsdelivr.net ${entity}`.trim()
  ];

  if (intent.contextHints.some((hint) => hint.toLowerCase().includes("cloudflare"))) {
    broadDomains.push(`site:developers.cloudflare.com ${entity}`);
    broadDomains.push(`site:blog.cloudflare.com ${entity}`);
    broadDomains.push(`site:github.com/cloudflare ${entity}`);
  }

  const phaseQuery =
    round >= 5
      ? `${entity} ${context} changelog`.trim()
      : round >= 4
        ? `${entity} ${context} installation`.trim()
        : round >= 3
          ? `${entity} ${context} guide`.trim()
          : `${entity} ${context} overview`.trim();

  return unique(
    [...broadDomains, phaseQuery, `${entity} ${context} docs readme`.trim(), `${entity} ${context} package repo`.trim()]
      .filter((query) => query.trim().length > 0)
  );
}

function buildEmptyResultsFallback(intent: ResearchIntent, session: ResearchSession): string[] {
  const entity = intent.targetEntity;
  const context = intent.contextHints.join(" ").trim();

  return unique([
    `"${entity}"`,
    `${entity} js`,
    `${entity} javascript ${context}`.trim(),
    `${entity} typescript ${context}`.trim(),
    `${entity} package`,
    `${entity} open source`,
    `${entity} repo`,
    `${entity} framework`
  ]).filter((query) => !session.queriesTried.includes(query));
}

function buildDirectUrlCandidates(intent: ResearchIntent): string[] {
  const slug = intent.targetEntity.toLowerCase().replace(/\s+/g, "-");
  const compact = intent.targetEntity.toLowerCase().replace(/\s+/g, "");
  const candidates: string[] = [
    // Same-name org/repo is the most common GitHub pattern (e.g. openvite/openvite)
    `https://github.com/${slug}/${slug}`,
    `https://github.com/${slug}`,
    `https://www.npmjs.com/package/${slug}`,
    `https://www.npmjs.com/package/${compact}`,
    `https://jsr.io/@${slug}`,
    `https://jsr.io/${slug}`,
    `https://${slug}.dev`,
    `https://${slug}.io`,
    `https://www.${slug}.dev`,
    `https://www.${slug}.io`
  ];

  for (const hint of intent.contextHints) {
    const normalizedHint = hint.toLowerCase().replace(/\s+/g, "-");
    if (normalizedHint.length < 3 || normalizedHint === slug) continue;
    candidates.push(`https://github.com/${normalizedHint}/${slug}`);
  }

  if (intent.contextHints.some((hint) => hint.toLowerCase().includes("cloudflare"))) {
    candidates.push(`https://developers.cloudflare.com/${slug}/`);
    candidates.push(`https://blog.cloudflare.com/${slug}`);
    candidates.push(`https://github.com/cloudflare/${slug}`);
  }

  return unique(candidates);
}

function prioritizeResults(results: SearchResultItem[], intent: ResearchIntent): SearchResultItem[] {
  const entityToken = normalizeEntityToken(intent.targetEntity);

  return results
    .map((result) => {
      const text = `${result.title} ${result.url}`.toLowerCase();
      let score = 0;

      if (entityToken && normalizeEntityToken(text).includes(entityToken)) score += 6;
      if (text.includes("official")) score += 4;
      if (text.includes("docs") || text.includes("documentation") || text.includes("readme")) score += 3;
      if (text.includes("github.com")) score += 3;
      if (text.includes("npmjs.com") || text.includes("registry.npmjs.org")) score += 3;
      if (text.includes("jsr.io")) score += 2;
      if (text.includes("developers.cloudflare.com") || text.includes("blog.cloudflare.com")) score += 2;
      if (intent.contextHints.some((hint) => text.includes(hint.toLowerCase()))) score += 2;

      return { result, score };
    })
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.result);
}

function scoreEvidence(session: ResearchSession): { confidence: ConfidenceLevel; reasoningSummary: string; stopReason: string } {
  const officialSources = session.sources.filter((source) => source.kind === "official").length;
  const secondarySources = session.sources.filter((source) => source.kind === "secondary").length;
  const readmeEvidence = session.evidence.filter((finding) => finding.reason.includes("github_readme")).length;
  const npmEvidence = session.evidence.filter((finding) => finding.reason.includes("npm_registry")).length;

  let score = 0;
  if (session.officialSourceFound) score += 4;
  score += Math.min(officialSources * 2, 6);
  score += Math.min(secondarySources * 2, 4);
  score += Math.min(session.visitedUrls.length, 4);
  score += Math.min(readmeEvidence * 2, 3);
  score += Math.min(npmEvidence * 2, 3);

  let confidence: ConfidenceLevel = "low";
  if (score >= 9) confidence = "high";
  else if (score >= 5) confidence = "medium";

  const reasoningSummary = [
    `Se analizaron ${session.queriesTried.length} consultas y ${session.visitedUrls.length} URLs.`,
    session.officialSourceFound
      ? "Se encontro al menos una fuente oficial, repo o dominio principal relevante."
      : "No se confirmo una fuente oficial clara.",
    readmeEvidence > 0 ? "Se inspecciono al menos un README de repositorio." : "",
    npmEvidence > 0 ? "Se consulto metadata del paquete npm cuando estuvo disponible." : "",
    `La evidencia acumulada sugiere confianza ${confidence}.`
  ]
    .filter(Boolean)
    .join(" ");

  const stopReason =
    confidence === "high"
      ? "sufficient_evidence"
      : session.roundsCompleted >= session.budget.maxRounds
        ? "budget_exhausted"
        : "need_more_research";

  return { confidence, reasoningSummary, stopReason };
}

function summarizeFindings(session: ResearchSession): string {
  if (session.evidence.length === 0) {
    return `No se encontro evidencia util despues de ${session.queriesTried.length} consultas.`;
  }

  return session.evidence
    .slice(0, 8)
    .map((finding) => {
      const source = finding.source ? finding.source.domain : "sin fuente";
      return `${finding.snippet} [${source}]`;
    })
    .join("\n");
}

async function requestLlmReformulations(
  context: AgentExecutionContext | undefined,
  plan: DelegationPlan,
  session: ResearchSession
): Promise<string[]> {
  if (!context?.provider) return [];

  const response = await context.provider.generateText({
    model: plan.model,
    temperature: 0.2,
    maxTokens: 220,
    systemPrompt:
      "Generate only short, effective English web search queries to find official documentation, a GitHub repository, a README, or an npm package. Return one query per line, no numbering.",
    prompt: [
      `Goal: ${session.intent.normalizedGoal}`,
      `Entity: ${session.intent.targetEntity}`,
      `Context hints: ${session.intent.contextHints.join(", ") || "none"}`,
      `Already tried: ${session.queriesTried.join(" | ") || "none"}`,
      "Generate up to 5 distinct new queries. Prefer English, use site: operators when helpful, and try README/package/repo variants."
    ].join("\n")
  });

  return unique(
    response.text
      .split("\n")
      .map((line) => line.replace(/^[\-\d.\s]+/, "").trim())
      .filter((line) => line.length > 0)
  );
}

export class ResearchAgent implements SubAgent {
  readonly name = LYRA_AGENT_NAME;
  readonly prompt = LYRA_AGENT_PROMPT;

  constructor(private readonly clientFactory: () => McpClientLike = () => new McpClientAdapter()) {}

  canHandle(_task: TaskRequest): boolean {
    return true;
  }

  async execute(task: TaskRequest, plan: DelegationPlan, context?: AgentExecutionContext): Promise<AgentTaskResult> {
    const client = this.clientFactory();
    const toolCalls: ToolCallRecord[] = [];
    const intent = interpretResearchIntent(task.goal);
    const budget = plan.researchBudget ?? {
      maxRounds: 6,
      maxVisitedUrls: 16,
      maxReformulations: 4,
      maxSearchQueriesPerRound: 3,
      maxPagesPerRound: 3
    };

    const session: ResearchSession = {
      intent,
      budget,
      queriesTried: [],
      visitedUrls: [],
      sources: [],
      evidence: [],
      officialSourceFound: false,
      confidence: "low",
      stopReason: "not_started",
      roundsCompleted: 0,
      reformulationsUsed: 0,
      reasoningSummary: ""
    };

    emit(context, "agent", `Lyra interpreto la consulta como ${intent.type}.`, {
      title: "pensando",
      detail: `intencion: ${intent.type} | entidad: ${intent.targetEntity}`
    });

    try {
      emit(context, "mcp", "Conectando con MCP y listando herramientas.", {
        title: "preparando herramientas",
        detail: "mcp local listo para investigar web"
      });
      const tools = await client.listTools();
      const expression = extractMathExpression(task.goal);
      const directUrls = extractUrls(task.goal);
      const queryQueue = [...buildInitialQueries(intent)];
      let emptySearchCount = 0;

      const addSource = (source: ResearchSource): void => {
        if (!session.sources.some((item) => item.url === source.url)) {
          session.sources.push(source);
        }
        if (source.kind === "official") {
          session.officialSourceFound = true;
        }
      };

      const collectGitHubReadme = async (repoUrl: string, query: string): Promise<void> => {
        if (!tools.includes("fetchGitHubReadme")) return;

        emit(context, "mcp", `Leyendo README del repo ${repoUrl}.`, {
          title: "lyra esta investigando",
          detail: `github readme | ${shortText(repoUrl)}`
        });
        const response = await client.callTool("fetchGitHubReadme", { repoUrl });
        toolCalls.push({ toolName: "fetchGitHubReadme", arguments: { repoUrl }, resultPreview: preview(response.text) });

        const readme = parseGitHubReadme(response.text);
        if (!readme.preview?.trim()) return;

        const source: ResearchSource = {
          url: readme.readmeUrl || repoUrl,
          domain: getDomain(repoUrl),
          kind: classifySourceKind(repoUrl, intent, "README"),
          title: "README"
        };
        addSource(source);
        session.evidence.push({
          query,
          source,
          snippet: readme.preview,
          reason: "github_readme"
        });
      };

      const collectNpmPackageInfo = async (packageName: string, query: string): Promise<void> => {
        if (!tools.includes("fetchNpmPackageInfo")) return;

        emit(context, "mcp", `Consultando metadata npm de ${packageName}.`, {
          title: "lyra esta investigando",
          detail: `npm package | ${packageName}`
        });
        const response = await client.callTool("fetchNpmPackageInfo", { packageName });
        toolCalls.push({ toolName: "fetchNpmPackageInfo", arguments: { packageName }, resultPreview: preview(response.text) });

        const npmInfo = parseNpmPackageInfo(response.text);
        if (!npmInfo.packageName && !npmInfo.description) return;

        const packageUrl = `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`;
        const source: ResearchSource = {
          url: packageUrl,
          domain: "npmjs.com",
          kind: classifySourceKind(packageUrl, intent, npmInfo.packageName),
          title: npmInfo.packageName
        };
        addSource(source);

        const summary = [
          npmInfo.packageName ? `Package: ${npmInfo.packageName}.` : "",
          npmInfo.description ? `Descripcion: ${npmInfo.description}` : "",
          npmInfo.latestVersion ? `Version: ${npmInfo.latestVersion}.` : "",
          npmInfo.license ? `Licencia: ${npmInfo.license}.` : "",
          npmInfo.keywords?.length ? `Keywords: ${npmInfo.keywords.slice(0, 8).join(", ")}.` : ""
        ]
          .filter(Boolean)
          .join(" ");

        session.evidence.push({
          query,
          source,
          snippet: summary,
          reason: "npm_registry"
        });

        if (npmInfo.repositoryUrl) {
          const repoUrl = npmInfo.repositoryUrl.replace(/^git\+/, "").replace(/\.git$/, "");
          if (!session.visitedUrls.includes(repoUrl)) {
            await fetchAndCollect(repoUrl, "npm_repository", query, "Repository from npm");
          }
        }

        if (npmInfo.homepage && !session.visitedUrls.includes(npmInfo.homepage)) {
          await fetchAndCollect(npmInfo.homepage, "npm_homepage", query, "Homepage from npm");
        }
      };

      const fetchAndCollect = async (url: string, reason: string, query: string, title?: string): Promise<void> => {
        if (session.visitedUrls.includes(url) || session.visitedUrls.length >= budget.maxVisitedUrls) return;

        emit(context, "mcp", `Leyendo ${url}.`, {
          title: "lyra esta investigando",
          detail: `fuente: ${getDomain(url)} | motivo: ${reason}`
        });
        session.visitedUrls.push(url);

        const pageResponse = await client.callTool("fetchWebPage", { url, maxChars: 3600 });
        toolCalls.push({ toolName: "fetchWebPage", arguments: { url, maxChars: 3600 }, resultPreview: preview(pageResponse.text) });

        const source: ResearchSource = { url, domain: getDomain(url), kind: classifySourceKind(url, intent, title), title };
        addSource(source);
        session.evidence.push({
          query,
          source,
          snippet: parseFetchPagePreview(pageResponse.text),
          reason
        });

        const repoUrl = extractGitHubRepoUrl(url);
        if (repoUrl) {
          await collectGitHubReadme(repoUrl, query);
        }

        const packageName = extractNpmPackageName(url);
        if (packageName) {
          await collectNpmPackageInfo(packageName, query);
        }

        if (tools.includes("extractLinksFromPage")) {
          const linksResponse = await client.callTool("extractLinksFromPage", {
            url,
            maxLinks: 8,
            keywords: [
              "docs",
              "documentation",
              "guide",
              "getting-started",
              "api",
              "github",
              "readme",
              "quickstart",
              "npm",
              "package",
              "installation"
            ]
          });
          toolCalls.push({ toolName: "extractLinksFromPage", arguments: { url, maxLinks: 8 }, resultPreview: preview(linksResponse.text) });

          const candidateLinks = parseExtractedLinks(linksResponse.text);
          for (const link of candidateLinks.slice(0, 4)) {
            if (session.visitedUrls.length >= budget.maxVisitedUrls) break;

            const shouldFollow =
              classifySourceKind(link.url, intent, link.text) !== "other" ||
              /docs|readme|guide|get-started|quickstart|github|npm|package|api/i.test(`${link.text} ${link.url}`);

            if (shouldFollow) {
              await fetchAndCollect(link.url, `linked_follow_up:${link.text || "related"}`, query, link.text);
            }
          }
        }

        if (tools.includes("fetchRobotsOrSitemap") && source.kind === "official") {
          const siteResponse = await client.callTool("fetchRobotsOrSitemap", { url });
          toolCalls.push({ toolName: "fetchRobotsOrSitemap", arguments: { url }, resultPreview: preview(siteResponse.text) });
          session.evidence.push({
            query,
            source,
            snippet: siteResponse.text,
            reason: "site_discovery"
          });
        }
      };

      if (expression && tools.includes("calculate")) {
        emit(context, "mcp", `Ejecutando calculate para ${expression}.`, {
          title: "pensando",
          detail: `calculo detectado | ${expression}`
        });
        const response = await client.callTool("calculate", { expression });
        toolCalls.push({ toolName: "calculate", arguments: { expression }, resultPreview: preview(response.text) });
        session.evidence.push({ query: expression, snippet: `Resultado numerico: ${response.text}`, reason: "calculation" });
      }

      for (const url of directUrls) {
        await fetchAndCollect(url, "direct_url", intent.normalizedGoal, "Direct URL");
      }

      if (intent.type === "definition" || intent.type === "how_it_works" || intent.type === "general_research") {
        const directCandidates = buildDirectUrlCandidates(intent);
        emit(context, "agent", `Probando ${directCandidates.length} URLs directas candidatas.`, {
          title: "lyra esta investigando",
          detail: `probe inicial | ${intent.targetEntity}`
        });

        const directProbeLimit = Math.ceil(budget.maxVisitedUrls * 0.35);
        for (const url of directCandidates) {
          if (session.visitedUrls.length >= directProbeLimit) break;
          try {
            await fetchAndCollect(url, "direct_probe", intent.normalizedGoal);
          } catch {
            continue;
          }
        }
      }

      while (session.roundsCompleted < budget.maxRounds) {
        session.roundsCompleted += 1;
        emit(context, "agent", `Ronda ${session.roundsCompleted} de investigacion.`, {
          title: "lyra esta investigando",
          detail: `ronda ${session.roundsCompleted}/${budget.maxRounds} | consultas: ${session.queriesTried.length}`
        });

        const roundQueries = queryQueue
          .filter((query) => !session.queriesTried.includes(query))
          .slice(0, budget.maxSearchQueriesPerRound);

        if (roundQueries.length === 0) {
          emit(context, "agent", "Cola de consultas agotada.", {
            title: "lyra esta investigando",
            detail: "no quedan queries frescas"
          });
          break;
        }

        for (const query of roundQueries) {
          session.queriesTried.push(query);
          if (!tools.includes("searchWeb")) continue;

          emit(context, "mcp", `Buscando: ${query}`, {
            title: "lyra esta investigando",
            detail: `query: ${shortText(query)}`
          });
          const response = await client.callTool("searchWeb", { query, maxResults: 6 });
          toolCalls.push({ toolName: "searchWeb", arguments: { query, maxResults: 6 }, resultPreview: preview(response.text) });

          const results = prioritizeResults(parseSearchWebResult(response.text), intent);
          if (results.length === 0) {
            emptySearchCount += 1;
            emit(context, "agent", `Sin resultados para: "${query}". Variante encolada.`, {
              title: "lyra esta investigando",
              detail: `sin resultados | ${shortText(query)}`
            });

            if (emptySearchCount >= 2) {
              const fallbacks = buildEmptyResultsFallback(intent, session);
              if (fallbacks.length > 0) {
                queryQueue.unshift(...fallbacks);
              }
              emptySearchCount = 0;
            }
            continue;
          }

          emptySearchCount = 0;
          session.evidence.push({ query, snippet: response.text, reason: "search_results" });

          for (const result of results.slice(0, budget.maxPagesPerRound)) {
            if (session.visitedUrls.length >= budget.maxVisitedUrls) break;
            await fetchAndCollect(result.url, `search_result:${result.title}`, query, result.title);
          }
        }

        const evaluation = scoreEvidence(session);
        session.confidence = evaluation.confidence;
        session.reasoningSummary = evaluation.reasoningSummary;
        session.stopReason = evaluation.stopReason;

        if (session.confidence === "high") {
          emit(context, "agent", "La evidencia ya es suficiente para responder.", {
            title: "lyra encontro suficiente contexto",
            detail: `confianza: ${session.confidence} | urls: ${session.visitedUrls.length}`
          });
          break;
        }

        if (session.roundsCompleted >= budget.maxRounds) {
          emit(context, "agent", "Se agoto el presupuesto de investigacion.", {
            title: "lyra termino de investigar",
            detail: `presupuesto agotado | confianza: ${session.confidence}`
          });
          break;
        }

        const llmQueries =
          session.reformulationsUsed < budget.maxReformulations
            ? await requestLlmReformulations(context, plan, session).catch(() => [])
            : [];
        const heuristicQueries = buildHeuristicReformulations(intent, session.roundsCompleted);
        const nextQueries = unique([...llmQueries, ...heuristicQueries]).filter(
          (query) => !session.queriesTried.includes(query)
        );

        if (llmQueries.length > 0) {
          session.reformulationsUsed += 1;
          emit(context, "agent", `${llmQueries.length} consultas nuevas del modelo para la siguiente ronda.`, {
            title: "lyra replantea la busqueda",
            detail: shortText(llmQueries[0] ?? "nueva query")
          });
        }

        if (nextQueries.length === 0) {
          emit(context, "agent", "No quedan consultas nuevas razonables para seguir investigando.", {
            title: "lyra termino de investigar",
            detail: "sin queries nuevas"
          });
          break;
        }

        queryQueue.unshift(...nextQueries);
      }

      const finalEvaluation = scoreEvidence(session);
      session.confidence = finalEvaluation.confidence;
      session.reasoningSummary = finalEvaluation.reasoningSummary;
      session.stopReason = finalEvaluation.stopReason;

      let summary = summarizeFindings(session);
      if (tools.includes("formatReport")) {
        emit(context, "mcp", "Formateando reporte final de Lyra.", {
          title: "lyra organiza hallazgos",
          detail: `evidencias: ${session.evidence.length} | confianza: ${session.confidence}`
        });
        const response = await client.callTool("formatReport", {
          title: "Lyra Research Report",
          bullets: session.evidence.slice(0, 8).map((finding) => finding.snippet),
          summary: session.reasoningSummary
        });
        toolCalls.push({ toolName: "formatReport", arguments: { title: "Lyra Research Report" }, resultPreview: preview(response.text) });
        summary = response.text;
      }

      context?.observer?.({
        scope: "agent",
        kind: "done",
        message: "Lyra termino la consulta.",
        data: {
          title: "lyra termino de investigar",
          detail: `confianza: ${session.confidence} | fuentes: ${session.sources.length}`
        }
      });

      return {
        status: "success",
        summary,
        data: { agentName: this.name, prompt: this.prompt, session },
        toolCalls,
        errors: [],
        confidence: session.confidence,
        sources: session.sources,
        queriesTried: session.queriesTried,
        visitedUrls: session.visitedUrls,
        officialSourceFound: session.officialSourceFound,
        reasoningSummary: session.reasoningSummary
      };
    } catch (error) {
      context?.observer?.({
        scope: "agent",
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        data: {
          title: "lyra encontro un problema",
          detail: "la investigacion fallo antes de completarse"
        }
      });

      return {
        status: "error",
        summary: "Lyra no pudo completar la investigacion delegada.",
        data: { agentName: this.name, prompt: this.prompt, session },
        toolCalls,
        errors: [error instanceof Error ? error.message : String(error)],
        confidence: session.confidence,
        sources: session.sources,
        queriesTried: session.queriesTried,
        visitedUrls: session.visitedUrls,
        officialSourceFound: session.officialSourceFound,
        reasoningSummary: session.reasoningSummary || "La investigacion termino con errores antes de consolidar evidencia."
      };
    } finally {
      await client.close();
    }
  }
}

export { ResearchAgent as WorkerAgent };
