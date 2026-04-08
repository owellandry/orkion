import { McpClientAdapter, type McpClientLike } from "../mcp/client-adapter.ts";
import { interpretResearchIntent } from "./research-intent.ts";
import type {
  AgentExecutionContext,
  AgentTaskResult,
  ConfidenceLevel,
  DelegationPlan,
  ResearchFinding,
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
  "Prioriza fuente oficial, docs, repositorio o dominio principal antes de concluir.",
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

function preview(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function emit(context: AgentExecutionContext | undefined, scope: "agent" | "mcp", message: string): void {
  context?.observer?.({
    scope,
    kind: "status",
    message
  });
}

function extractMathExpression(goal: string): string | undefined {
  const mathMatch = goal.match(/([0-9()[\]\s+\-*/.]{3,})/);
  const candidate = mathMatch?.[1]?.trim();
  if (!candidate) {
    return undefined;
  }

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

function classifySourceKind(url: string, intent: ResearchIntent): ResearchSourceKind {
  const domain = getDomain(url).toLowerCase();
  const entityToken = normalizeEntityToken(intent.targetEntity);
  const contextTokens = intent.contextHints.map(normalizeEntityToken);

  if (entityToken && domain.replace(/[^a-z0-9]/g, "").includes(entityToken)) {
    return "official";
  }

  if (contextTokens.some((token) => token && domain.replace(/[^a-z0-9]/g, "").includes(token))) {
    return "official";
  }

  if (domain.includes("github.com") || domain.includes("npmjs.com") || domain.includes("developers.cloudflare.com")) {
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

function buildInitialQueries(intent: ResearchIntent): string[] {
  const entity = intent.targetEntity;
  const context = intent.contextHints.join(" ");

  const candidates = [
    intent.normalizedGoal,
    `${entity} ${context}`.trim(),
    `${entity} official`.trim(),
    `${entity} docs`.trim(),
    `${entity} github`.trim(),
    `${entity} cloudflare`.trim()
  ];

  if (intent.type === "current_info") {
    candidates.unshift(`${entity} precio actual`);
    candidates.push(`${entity} official price`);
  }

  if (intent.type === "how_it_works" || intent.type === "definition") {
    candidates.push(`${entity} framework`);
    candidates.push(`${entity} how it works`);
  }

  return unique(candidates.filter((query) => query.trim().length > 0));
}

function buildHeuristicReformulations(intent: ResearchIntent, round: number): string[] {
  const entity = intent.targetEntity;
  const context = intent.contextHints.join(" ");
  const suffix = round >= 2 ? "guide" : "overview";

  return unique([
    `${entity} ${context} ${suffix}`.trim(),
    `${entity} ${context} docs official`.trim(),
    `${entity} ${context} github readme`.trim(),
    `${entity} ${context} get started`.trim()
  ]);
}

async function requestLlmReformulations(
  context: AgentExecutionContext | undefined,
  plan: DelegationPlan,
  session: ResearchSession
): Promise<string[]> {
  if (!context?.provider) {
    return [];
  }

  const response = await context.provider.generateText({
    model: plan.model,
    temperature: 0.1,
    maxTokens: 180,
    systemPrompt:
      "Genera solo consultas de busqueda web cortas y utiles para encontrar una respuesta oficial o confiable. Devuelve una consulta por linea sin numeracion.",
    prompt: [
      `Objetivo: ${session.intent.normalizedGoal}`,
      `Entidad: ${session.intent.targetEntity}`,
      `Contexto: ${session.intent.contextHints.join(", ") || "sin contexto extra"}`,
      `Queries ya usadas: ${session.queriesTried.join(" | ") || "ninguna"}`,
      "Genera hasta 3 nuevas consultas distintas."
    ].join("\n")
  });

  return unique(
    response.text
      .split("\n")
      .map((line) => line.replace(/^[\-\d.\s]+/, "").trim())
      .filter((line) => line.length > 0)
  );
}

function prioritizeResults(results: SearchResultItem[], intent: ResearchIntent): SearchResultItem[] {
  const entityToken = normalizeEntityToken(intent.targetEntity);
  const scored = results.map((result) => {
    const url = result.url.toLowerCase();
    const title = result.title.toLowerCase();
    let score = 0;

    if (entityToken && normalizeEntityToken(url).includes(entityToken)) {
      score += 5;
    }

    if (title.includes("official") || url.includes("/docs") || title.includes("docs")) {
      score += 3;
    }

    if (url.includes("github.com") || url.includes("developers.cloudflare.com")) {
      score += 2;
    }

    if (intent.contextHints.some((hint) => `${title} ${url}`.includes(hint.toLowerCase()))) {
      score += 2;
    }

    return { result, score };
  });

  return scored
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.result);
}

function scoreEvidence(session: ResearchSession): { confidence: ConfidenceLevel; reasoningSummary: string; stopReason: string } {
  let score = 0;

  if (session.officialSourceFound) {
    score += 4;
  }

  score += Math.min(session.evidence.length, 4);
  score += Math.min(session.visitedUrls.length, 2);

  const hasSecondary = session.sources.some((source) => source.kind === "secondary");
  if (hasSecondary) {
    score += 1;
  }

  let confidence: ConfidenceLevel = "low";
  if (score >= 7) {
    confidence = "high";
  } else if (score >= 4) {
    confidence = "medium";
  }

  const reasoningSummary = [
    `Se analizaron ${session.queriesTried.length} consultas y ${session.visitedUrls.length} URLs.`,
    session.officialSourceFound ? "Se encontro al menos una fuente oficial o de dominio principal." : "No se confirmo una fuente oficial clara.",
    `La evidencia acumulada sugiere confianza ${confidence}.`
  ].join(" ");

  const stopReason =
    confidence === "high"
      ? "sufficient_evidence"
      : session.roundsCompleted >= session.budget.maxRounds
        ? "budget_exhausted"
        : "need_more_research";

  return {
    confidence,
    reasoningSummary,
    stopReason
  };
}

function summarizeFindings(session: ResearchSession): string {
  if (session.evidence.length === 0) {
    return `No se encontro evidencia util despues de ${session.queriesTried.length} consultas.`;
  }

  return session.evidence
    .slice(0, 5)
    .map((finding) => {
      const source = finding.source ? `${finding.source.domain}` : "sin fuente";
      return `${finding.snippet} [${source}]`;
    })
    .join("\n");
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
      maxRounds: 3,
      maxVisitedUrls: 6,
      maxReformulations: 2,
      maxSearchQueriesPerRound: 2,
      maxPagesPerRound: 2
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

    emit(context, "agent", `Lyra interpreto la consulta como ${intent.type}.`);
    emit(context, "agent", `Entidad detectada: ${intent.targetEntity}.`);

    try {
      emit(context, "mcp", "Conectando con MCP y listando herramientas.");
      const tools = await client.listTools();
      const expression = extractMathExpression(task.goal);
      const directUrls = extractUrls(task.goal);
      const queryQueue = buildInitialQueries(intent);

      if (expression && tools.includes("calculate")) {
        emit(context, "mcp", `Ejecutando calculate para ${expression}.`);
        const response = await client.callTool("calculate", { expression });
        toolCalls.push({
          toolName: "calculate",
          arguments: { expression },
          resultPreview: preview(response.text)
        });
        session.evidence.push({
          query: expression,
          snippet: `Resultado numerico: ${response.text}`,
          reason: "calculation"
        });
      }

      const fetchAndCollect = async (url: string, reason: string, query: string, title?: string): Promise<void> => {
        if (session.visitedUrls.includes(url) || session.visitedUrls.length >= budget.maxVisitedUrls) {
          return;
        }

        emit(context, "mcp", `Leyendo contenido relevante: ${url}`);
        session.visitedUrls.push(url);
        const pageResponse = await client.callTool("fetchWebPage", { url, maxChars: 2600 });
        toolCalls.push({
          toolName: "fetchWebPage",
          arguments: { url, maxChars: 2600 },
          resultPreview: preview(pageResponse.text)
        });

        const source: ResearchSource = {
          url,
          domain: getDomain(url),
          kind: classifySourceKind(url, intent),
          title
        };

        if (!session.sources.some((existing) => existing.url === source.url)) {
          session.sources.push(source);
        }
        if (source.kind === "official") {
          session.officialSourceFound = true;
        }

        session.evidence.push({
          query,
          source,
          snippet: parseFetchPagePreview(pageResponse.text),
          reason
        });

        if (tools.includes("extractLinksFromPage")) {
          const linksResponse = await client.callTool("extractLinksFromPage", {
            url,
            maxLinks: 4,
            keywords: ["docs", "documentation", "guide", "getting-started", "api", "github", "readme"]
          });
          toolCalls.push({
            toolName: "extractLinksFromPage",
            arguments: { url, maxLinks: 4 },
            resultPreview: preview(linksResponse.text)
          });

          const candidateLinks = parseExtractedLinks(linksResponse.text);
          for (const link of candidateLinks.slice(0, 2)) {
            if (session.visitedUrls.length >= budget.maxVisitedUrls) {
              break;
            }

            const linkKind = classifySourceKind(link.url, intent);
            if (linkKind === "official" || link.url.includes("docs") || link.url.includes("github.com")) {
              await fetchAndCollect(link.url, `linked_follow_up:${link.text || "related"}`, query, link.text);
            }
          }
        }

        if (tools.includes("fetchRobotsOrSitemap") && source.kind === "official") {
          const siteResponse = await client.callTool("fetchRobotsOrSitemap", { url });
          toolCalls.push({
            toolName: "fetchRobotsOrSitemap",
            arguments: { url },
            resultPreview: preview(siteResponse.text)
          });
          session.evidence.push({
            query,
            source,
            snippet: siteResponse.text,
            reason: "site_discovery"
          });
        }
      };

      for (const url of directUrls) {
        await fetchAndCollect(url, "direct_url", intent.normalizedGoal, "Direct URL");
      }

      while (session.roundsCompleted < budget.maxRounds) {
        session.roundsCompleted += 1;
        emit(context, "agent", `Ronda ${session.roundsCompleted} de investigacion.`);

        const roundQueries = queryQueue
          .filter((query) => !session.queriesTried.includes(query))
          .slice(0, budget.maxSearchQueriesPerRound);

        if (roundQueries.length === 0) {
          break;
        }

        for (const query of roundQueries) {
          session.queriesTried.push(query);

          if (tools.includes("searchWeb")) {
            emit(context, "mcp", `Buscando en la web: ${query}`);
            const response = await client.callTool("searchWeb", { query, maxResults: 4 });
            toolCalls.push({
              toolName: "searchWeb",
              arguments: { query, maxResults: 4 },
              resultPreview: preview(response.text)
            });

            const results = prioritizeResults(parseSearchWebResult(response.text), intent);
            session.evidence.push({
              query,
              snippet: response.text,
              reason: "search_results"
            });

            for (const result of results.slice(0, budget.maxPagesPerRound)) {
              if (session.visitedUrls.length >= budget.maxVisitedUrls) {
                break;
              }
              await fetchAndCollect(result.url, `search_result:${result.title}`, query, result.title);
            }
          }
        }

        const evaluation = scoreEvidence(session);
        session.confidence = evaluation.confidence;
        session.reasoningSummary = evaluation.reasoningSummary;
        session.stopReason = evaluation.stopReason;

        if (session.confidence === "high") {
          emit(context, "agent", "La evidencia ya es suficiente para responder.");
          break;
        }

        if (session.roundsCompleted >= budget.maxRounds) {
          emit(context, "agent", "Se agoto el presupuesto de investigacion.");
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
          emit(context, "agent", `Lyra reformulo consultas para la ronda ${session.roundsCompleted + 1}.`);
        }

        if (nextQueries.length === 0) {
          emit(context, "agent", "No quedan consultas nuevas razonables para seguir investigando.");
          break;
        }

        queryQueue.push(...nextQueries);
      }

      const finalEvaluation = scoreEvidence(session);
      session.confidence = finalEvaluation.confidence;
      session.reasoningSummary = finalEvaluation.reasoningSummary;
      session.stopReason = finalEvaluation.stopReason;

      let summary = summarizeFindings(session);

      if (tools.includes("formatReport")) {
        emit(context, "mcp", "Formateando reporte final de Lyra.");
        const response = await client.callTool("formatReport", {
          title: "Lyra Research Report",
          bullets: session.evidence.slice(0, 5).map((finding) => finding.snippet),
          summary: session.reasoningSummary
        });
        toolCalls.push({
          toolName: "formatReport",
          arguments: {
            title: "Lyra Research Report"
          },
          resultPreview: preview(response.text)
        });
        summary = response.text;
      }

      context?.observer?.({
        scope: "agent",
        kind: "done",
        message: "Lyra termino la consulta."
      });

      return {
        status: "success",
        summary,
        data: {
          agentName: this.name,
          prompt: this.prompt,
          session
        },
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
        message: error instanceof Error ? error.message : String(error)
      });

      return {
        status: "error",
        summary: "Lyra no pudo completar la investigacion delegada.",
        data: {
          agentName: this.name,
          prompt: this.prompt,
          session
        },
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
