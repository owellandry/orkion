import type { ProviderName } from "../config/types.ts";
import type { LLMProvider } from "../providers/types.ts";

export interface TaskRequest {
  id: string;
  goal: string;
  context?: string[];
  constraints?: string[];
  preferredProvider?: ProviderName;
  preferredModel?: string;
  outputFormat?: "text" | "json";
  intentHint?: ResearchIntentType;
}

export type ResearchIntentType =
  | "definition"
  | "how_it_works"
  | "current_info"
  | "comparison"
  | "url_verification"
  | "general_research"
  | "calculation"
  | "git_operation"
  | "chat";

export interface ResearchBudget {
  maxRounds: number;
  maxVisitedUrls: number;
  maxReformulations: number;
  maxSearchQueriesPerRound: number;
  maxPagesPerRound: number;
}

export interface ResearchIntent {
  type: ResearchIntentType;
  normalizedGoal: string;
  targetEntity: string;
  contextHints: string[];
  researchRequired: boolean;
}

export type ResearchSourceKind = "official" | "secondary" | "other";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface ResearchSource {
  url: string;
  domain: string;
  kind: ResearchSourceKind;
  title?: string;
}

export interface ResearchFinding {
  query: string;
  source?: ResearchSource;
  snippet: string;
  reason: string;
}

export interface ResearchSession {
  intent: ResearchIntent;
  budget: ResearchBudget;
  queriesTried: string[];
  visitedUrls: string[];
  sources: ResearchSource[];
  evidence: ResearchFinding[];
  officialSourceFound: boolean;
  confidence: ConfidenceLevel;
  stopReason: string;
  roundsCompleted: number;
  reformulationsUsed: number;
  reasoningSummary: string;
}

export interface ExecutionEvent {
  scope: "manager" | "agent" | "mcp" | "provider";
  kind: "status" | "stream" | "done" | "error";
  message: string;
  chunk?: string;
  data?: Record<string, unknown>;
}

export type ExecutionObserver = (event: ExecutionEvent) => void;

export interface DelegationPlan {
  selectedAgent: string | null;
  instructions: string;
  expectedOutput: string;
  shouldDelegate: boolean;
  provider: ProviderName;
  model: string;
  fallbackUsed: boolean;
  warnings: string[];
  intentType: ResearchIntentType;
  researchRequired: boolean;
  researchBudget?: ResearchBudget;
}

export interface ToolCallRecord {
  toolName: string;
  arguments: Record<string, unknown>;
  resultPreview?: string;
}

export interface AgentTaskResult {
  status: "success" | "error";
  summary: string;
  data?: Record<string, unknown>;
  toolCalls: ToolCallRecord[];
  errors: string[];
  confidence: ConfidenceLevel;
  sources: ResearchSource[];
  queriesTried: string[];
  visitedUrls: string[];
  officialSourceFound: boolean;
  reasoningSummary: string;
}

export interface ManagerExecutionResult {
  text: string;
  delegated: boolean;
  plan: DelegationPlan;
  workerResult?: AgentTaskResult;
}

export interface AgentExecutionContext {
  observer?: ExecutionObserver;
  provider?: LLMProvider;
}

export interface SubAgent {
  readonly name: string;
  canHandle(task: TaskRequest): boolean;
  execute(task: TaskRequest, plan: DelegationPlan, context?: AgentExecutionContext): Promise<AgentTaskResult>;
}
