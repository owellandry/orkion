import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

const knowledgeBase = [
  {
    topic: "orkion",
    text: "Orkion es un prototipo de orquestador de agentes con manager, subagentes y herramientas MCP."
  },
  {
    topic: "mcp",
    text: "MCP permite exponer tools, recursos y prompts a clientes de agentes usando un protocolo estandar."
  },
  {
    topic: "openrouter",
    text: "OpenRouter permite enrutar solicitudes a varios modelos y ofrece modelos gratuitos y de pago."
  },
  {
    topic: "bun",
    text: "Bun ejecuta TypeScript de forma nativa y es una base ligera para CLIs y servicios locales."
  },
  {
    topic: "providers",
    text: "El manager de Orkion puede elegir provider y modelo segun config, credenciales y preferencias del usuario."
  }
];

export interface CurlExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CurlRunner = (args: string[]) => Promise<CurlExecutionResult>;

async function defaultCurlRunner(args: string[]): Promise<CurlExecutionResult> {
  const curlBinary = process.platform === "win32" ? "curl.exe" : "curl";
  const proc = Bun.spawn([curlBinary, ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  return {
    stdout,
    stderr,
    exitCode
  };
}

interface ParsedCurlMeta {
  http_code?: string;
  content_type?: string;
  url_effective?: string;
}

function parseCurlResponse(stdout: string): {
  body: string;
  meta: ParsedCurlMeta;
} {
  const marker = "\n__ORKION_META__";
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex === -1) {
    return {
      body: stdout,
      meta: {}
    };
  }

  const body = stdout.slice(0, markerIndex);
  const rawMeta = stdout.slice(markerIndex + marker.length).trim();

  try {
    return {
      body,
      meta: JSON.parse(rawMeta) as ParsedCurlMeta
    };
  } catch {
    return {
      body,
      meta: {}
    };
  }
}

function stripHtml(rawHtml: string, maxChars: number): string {
  return rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function decodeDuckDuckGoUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const encoded = parsed.searchParams.get("uddg");
    return encoded ? decodeURIComponent(encoded) : parsed.toString();
  } catch {
    return url;
  }
}

function parseDuckDuckGoResults(html: string, maxResults: number): Array<{ title: string; url: string }> {
  const matches = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

  return matches.slice(0, maxResults).map((match) => ({
    url: decodeDuckDuckGoUrl(match[1]),
    title: stripHtml(match[2], 180)
  }));
}

function extractLinks(html: string, pageUrl: string, maxLinks: number, keywords?: string[]): Array<{ url: string; text: string }> {
  const matches = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const base = new URL(pageUrl);
  const seen = new Set<string>();

  return matches
    .map((match) => {
      try {
        const url = new URL(match[1], base).toString();
        const text = stripHtml(match[2], 120);
        return { url, text };
      } catch {
        return undefined;
      }
    })
    .filter((value): value is { url: string; text: string } => Boolean(value))
    .filter((item) => {
      if (seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      if (!keywords || keywords.length === 0) {
        return true;
      }
      const haystack = `${item.url} ${item.text}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    })
    .slice(0, maxLinks);
}

function parseGitHubRepo(repoUrl: string): { owner: string; repo: string; normalizedUrl: string } | undefined {
  try {
    const parsed = new URL(repoUrl);
    if (!parsed.hostname.includes("github.com")) {
      return undefined;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return undefined;
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    return {
      owner,
      repo,
      normalizedUrl: `https://github.com/${owner}/${repo}`
    };
  } catch {
    return undefined;
  }
}

function extractNpmPackageName(packageUrlOrName: string): string {
  if (!packageUrlOrName.startsWith("http")) {
    return packageUrlOrName.trim();
  }

  try {
    const parsed = new URL(packageUrlOrName);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const packageIndex = parts.findIndex((part) => part === "package");
    if (packageIndex === -1 || packageIndex === parts.length - 1) {
      return "";
    }

    const nameParts = parts.slice(packageIndex + 1);
    return decodeURIComponent(nameParts.join("/"));
  } catch {
    return "";
  }
}

async function runCurlJson(
  runner: CurlRunner,
  args: string[],
  errorPrefix: string
): Promise<CurlExecutionResult> {
  const result = await runner(args);
  if (result.exitCode !== 0) {
    throw new Error(`${errorPrefix}: ${result.stderr.trim() || "curl failed"}`);
  }
  return result;
}

function safeEvaluateExpression(expression: string): number {
  const normalized = expression.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]+$/.test(normalized)) {
    throw new Error("Expression contains unsupported characters.");
  }

  const result = Function(`"use strict"; return (${normalized});`)();
  if (typeof result !== "number" || Number.isNaN(result) || !Number.isFinite(result)) {
    throw new Error("Expression did not produce a valid numeric result.");
  }

  return result;
}

export function createMcpUtilityServer(curlRunner: CurlRunner = defaultCurlRunner): McpServer {
  const server = new McpServer({
    name: "orkion-mcp",
    version: "0.3.0"
  });

  const calculateSchema = {
    expression: z.string().describe("Arithmetic expression with numbers and operators.")
  };

  server.registerTool(
    "calculate",
    {
      description: "Evaluates a simple arithmetic expression.",
      inputSchema: calculateSchema
    },
    async ({ expression }: z.infer<z.ZodObject<typeof calculateSchema>>) => {
      const result = safeEvaluateExpression(expression);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              expression,
              result
            })
          }
        ]
      };
    }
  );

  const searchSchema = {
    query: z.string().describe("Topic or question to search in the demo knowledge base."),
    maxResults: z.number().int().min(1).max(5).optional()
  };

  server.registerTool(
    "searchKnowledge",
    {
      description: "Searches a tiny internal knowledge base for prototype topics.",
      inputSchema: searchSchema
    },
    async ({ query, maxResults = 3 }: z.infer<z.ZodObject<typeof searchSchema>>) => {
      const loweredQuery = query.toLowerCase();
      const matches = knowledgeBase.filter(
        (entry) =>
          loweredQuery.includes(entry.topic) ||
          entry.text.toLowerCase().includes(loweredQuery) ||
          loweredQuery
            .split(/\s+/)
            .some((token: string) => token.length > 2 && entry.text.toLowerCase().includes(token))
      );

      const resolved = (matches.length > 0 ? matches : knowledgeBase.slice(0, maxResults)).map((entry) => ({
        topic: entry.topic,
        text: entry.text
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              query,
              results: resolved
            })
          }
        ]
      };
    }
  );

  const webSearchSchema = {
    query: z.string().describe("Search query for the open web."),
    maxResults: z.number().int().min(1).max(5).optional()
  };

  server.registerTool(
    "searchWeb",
    {
      description: "Performs a basic web search using curl against DuckDuckGo's HTML endpoint.",
      inputSchema: webSearchSchema
    },
    async ({ query, maxResults = 5 }: z.infer<z.ZodObject<typeof webSearchSchema>>) => {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const result = await runCurlJson(curlRunner, ["-L", "-sS", "--max-time", "20", url], "Web search failed");
      const parsedResults = parseDuckDuckGoResults(result.stdout, maxResults);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              query,
              engine: "duckduckgo-html",
              results: parsedResults
            })
          }
        ]
      };
    }
  );

  const fetchWebSchema = {
    url: z.string().url().describe("HTTP or HTTPS URL to fetch."),
    maxChars: z.number().int().min(300).max(12000).optional()
  };

  server.registerTool(
    "fetchWebPage",
    {
      description: "Fetches a web page via curl and returns a cleaned text preview.",
      inputSchema: fetchWebSchema
    },
    async ({ url, maxChars = 4000 }: z.infer<z.ZodObject<typeof fetchWebSchema>>) => {
      const result = await runCurlJson(
        curlRunner,
        ["-L", "-sS", "--max-time", "20", "-A", "orkion/0.3", url],
        "Web fetch failed"
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url,
              preview: stripHtml(result.stdout, maxChars)
            })
          }
        ]
      };
    }
  );

  const curlRequestSchema = {
    url: z.string().url().describe("HTTP or HTTPS URL to request with curl."),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    maxChars: z.number().int().min(200).max(20000).optional()
  };

  server.registerTool(
    "curlRequest",
    {
      description: "Runs a direct HTTP request with curl and returns status, content type and body preview.",
      inputSchema: curlRequestSchema
    },
    async ({ url, method = "GET", headers = {}, body, maxChars = 10000 }: z.infer<z.ZodObject<typeof curlRequestSchema>>) => {
      const args = ["-L", "-sS", "--max-time", "30", "-X", method, "-A", "orkion/0.4", "-H", "Accept: */*"];

      for (const [name, value] of Object.entries(headers)) {
        args.push("-H", `${name}: ${value}`);
      }

      if (body && method !== "GET" && method !== "HEAD") {
        args.push("--data-raw", body);
      }

      args.push(
        "-w",
        "\n__ORKION_META__{\"http_code\":\"%{http_code}\",\"content_type\":\"%{content_type}\",\"url_effective\":\"%{url_effective}\"}\n",
        url
      );

      const result = await runCurlJson(curlRunner, args, "Direct curl request failed");
      const parsed = parseCurlResponse(result.stdout);
      const bodyPreview = parsed.body.trim().slice(0, maxChars);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url,
              effectiveUrl: parsed.meta.url_effective || url,
              method,
              statusCode: Number.parseInt(parsed.meta.http_code ?? "0", 10) || 0,
              contentType: parsed.meta.content_type ?? "",
              bodyPreview
            })
          }
        ]
      };
    }
  );

  const extractLinksSchema = {
    url: z.string().url().describe("Page URL to inspect for links."),
    maxLinks: z.number().int().min(1).max(10).optional(),
    keywords: z.array(z.string()).optional()
  };

  server.registerTool(
    "extractLinksFromPage",
    {
      description: "Fetches a page and extracts absolute links, optionally filtered by keywords.",
      inputSchema: extractLinksSchema
    },
    async ({ url, maxLinks = 5, keywords = [] }: z.infer<z.ZodObject<typeof extractLinksSchema>>) => {
      const result = await runCurlJson(
        curlRunner,
        ["-L", "-sS", "--max-time", "20", "-A", "orkion/0.3", url],
        "Link extraction failed"
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url,
              links: extractLinks(result.stdout, url, maxLinks, keywords)
            })
          }
        ]
      };
    }
  );

  const sitemapSchema = {
    url: z.string().url().describe("Base site URL.")
  };

  server.registerTool(
    "fetchRobotsOrSitemap",
    {
      description: "Fetches robots.txt and sitemap.xml candidates for a base site.",
      inputSchema: sitemapSchema
    },
    async ({ url }: z.infer<z.ZodObject<typeof sitemapSchema>>) => {
      const base = new URL(url);
      const robotsUrl = new URL("/robots.txt", base).toString();
      const sitemapUrl = new URL("/sitemap.xml", base).toString();

      const [robots, sitemap] = await Promise.all([
        runCurlJson(curlRunner, ["-L", "-sS", "--max-time", "20", robotsUrl], "robots fetch failed").catch(() => undefined),
        runCurlJson(curlRunner, ["-L", "-sS", "--max-time", "20", sitemapUrl], "sitemap fetch failed").catch(() => undefined)
      ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url,
              robotsUrl,
              robotsPreview: robots ? robots.stdout.slice(0, 1200) : "",
              sitemapUrl,
              sitemapPreview: sitemap ? sitemap.stdout.slice(0, 1200) : ""
            })
          }
        ]
      };
    }
  );

  const githubReadmeSchema = {
    repoUrl: z.string().url().describe("GitHub repository URL.")
  };

  server.registerTool(
    "fetchGitHubReadme",
    {
      description: "Fetches a README preview from a GitHub repository using raw content fallbacks.",
      inputSchema: githubReadmeSchema
    },
    async ({ repoUrl }: z.infer<z.ZodObject<typeof githubReadmeSchema>>) => {
      const repo = parseGitHubRepo(repoUrl);
      if (!repo) {
        throw new Error("Invalid GitHub repository URL.");
      }

      const candidatePaths = [
        ["main", "README.md"],
        ["main", "README.mdx"],
        ["main", "readme.md"],
        ["master", "README.md"],
        ["master", "README.mdx"],
        ["master", "readme.md"]
      ];

      let matchedUrl = "";
      let preview = "";

      for (const [branch, fileName] of candidatePaths) {
        const rawUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/refs/heads/${branch}/${fileName}`;
        const result = await runCurlJson(
          curlRunner,
          ["-L", "-f", "-sS", "--max-time", "20", rawUrl],
          "GitHub README fetch failed"
        ).catch(() => undefined);

        if (result?.stdout.trim()) {
          matchedUrl = rawUrl;
          preview = stripHtml(result.stdout, 5000);
          break;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              repoUrl: repo.normalizedUrl,
              readmeUrl: matchedUrl,
              preview
            })
          }
        ]
      };
    }
  );

  const npmPackageSchema = {
    packageName: z.string().describe("npm package name or npm package URL.")
  };

  server.registerTool(
    "fetchNpmPackageInfo",
    {
      description: "Fetches npm registry metadata for a package and returns a compact summary.",
      inputSchema: npmPackageSchema
    },
    async ({ packageName }: z.infer<z.ZodObject<typeof npmPackageSchema>>) => {
      const resolvedName = extractNpmPackageName(packageName);
      if (!resolvedName) {
        throw new Error("Invalid npm package name.");
      }

      const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(resolvedName)}`;
      const result = await runCurlJson(
        curlRunner,
        ["-L", "-sS", "--max-time", "20", registryUrl],
        "npm registry fetch failed"
      );

      const raw = JSON.parse(result.stdout) as {
        name?: string;
        description?: string;
        license?: string;
        homepage?: string;
        repository?: string | { url?: string };
        keywords?: string[];
        "dist-tags"?: { latest?: string };
      };

      const repositoryUrl =
        typeof raw.repository === "string"
          ? raw.repository
          : raw.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              packageName: raw.name ?? resolvedName,
              description: raw.description ?? "",
              latestVersion: raw["dist-tags"]?.latest ?? "",
              homepage: raw.homepage ?? "",
              repositoryUrl: repositoryUrl ?? "",
              keywords: raw.keywords ?? [],
              license: raw.license ?? ""
            })
          }
        ]
      };
    }
  );

  const reportSchema = {
    title: z.string().describe("Report title."),
    bullets: z.array(z.string()).describe("Bullet points to include."),
    summary: z.string().optional().describe("Optional summary paragraph.")
  };

  server.registerTool(
    "formatReport",
    {
      description: "Formats a small markdown report from bullets and summary.",
      inputSchema: reportSchema
    },
    async ({ title, bullets, summary }: z.infer<z.ZodObject<typeof reportSchema>>) => {
      const body = [
        `# ${title}`,
        "",
        ...(summary ? [summary, ""] : []),
        ...bullets.map((bullet: string) => `- ${bullet}`)
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: body
          }
        ]
      };
    }
  );

  return server;
}
