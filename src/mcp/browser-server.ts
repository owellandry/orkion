import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

export interface BrowserExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type BrowserRunner = (executable: string, args: string[]) => Promise<BrowserExecutionResult>;

function stripHtml(rawHtml: string, maxChars: number): string {
  return rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function extractLinks(html: string, pageUrl: string, maxLinks: number, keywords?: string[]): Array<{ url: string; text: string }> {
  const matches = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const base = new URL(pageUrl);
  const seen = new Set<string>();

  return matches
    .map((match) => {
      try {
        const url = new URL(match[1], base).toString();
        const text = stripHtml(match[2], 140);
        return { url, text };
      } catch {
        return undefined;
      }
    })
    .filter((value): value is { url: string; text: string } => Boolean(value))
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      if (!keywords?.length) return true;
      const haystack = `${item.url} ${item.text}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    })
    .slice(0, maxLinks);
}

function extractTitle(html: string): string {
  return stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "", 200);
}

function extractMetaDescription(html: string): string {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
  return stripHtml(match?.[1] ?? "", 320);
}

function extractHeadings(html: string, maxItems = 4): string[] {
  return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => stripHtml(match[1], 200))
    .filter(Boolean)
    .slice(0, maxItems);
}

async function defaultBrowserRunner(executable: string, args: string[]): Promise<BrowserExecutionResult> {
  const { stdout, stderr } = await execFileAsync(executable, args, {
    windowsHide: true,
    maxBuffer: 12 * 1024 * 1024
  });

  return {
    stdout,
    stderr,
    exitCode: 0
  };
}

function tryResolveFromWhere(command: string): string | undefined {
  try {
    const proc = Bun.spawnSync(["where", command], {
      stdout: "pipe",
      stderr: "pipe"
    });
    if (proc.exitCode !== 0) return undefined;
    const stdout = Buffer.from(proc.stdout).toString("utf8").trim();
    return stdout.split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
}

function detectBrowserExecutable(): string | undefined {
  const envPath = process.env.ORKION_BROWSER_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  const commands = ["msedge.exe", "chrome.exe", "msedge", "chrome", "google-chrome", "chromium"];
  for (const command of commands) {
    const resolved = tryResolveFromWhere(command);
    if (resolved && existsSync(resolved)) {
      return resolved;
    }
  }

  const commonPaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  return commonPaths.find((candidate) => existsSync(candidate));
}

async function dumpDom(
  browserExecutable: string,
  browserRunner: BrowserRunner,
  url: string,
  timeoutMs = 12000
): Promise<string> {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--virtual-time-budget=5000",
    `--timeout=${timeoutMs}`,
    "--dump-dom",
    url
  ];

  const result = await browserRunner(browserExecutable, args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "headless browser failed");
  }

  return result.stdout;
}

export function createBrowserMcpServer(browserRunner: BrowserRunner = defaultBrowserRunner): McpServer {
  const server = new McpServer({
    name: "orkion-browser-mcp",
    version: "0.1.0"
  });

  const browserExecutable = detectBrowserExecutable();

  server.registerTool(
    "browserStatus",
    {
      description: "Returns whether a local Chrome or Edge executable is available for headless inspection.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            available: Boolean(browserExecutable),
            executable: browserExecutable ?? ""
          })
        }
      ]
    })
  );

  if (!browserExecutable) {
    return server;
  }

  const pageSchema = z.object({
    url: z.string().url().describe("Page URL to inspect with a headless browser."),
    maxChars: z.number().int().min(300).max(16000).optional()
  });

  server.registerTool(
    "browserFetchPage",
    {
      description: "Fetches a page with a headless browser and returns rendered text content.",
      inputSchema: pageSchema
    },
    async ({ url, maxChars = 5000 }) => {
      const html = await dumpDom(browserExecutable, browserRunner, url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url,
              title: extractTitle(html),
              preview: stripHtml(html, maxChars)
            })
          }
        ]
      };
    }
  );

  server.registerTool(
    "browserExtractLinks",
    {
      description: "Renders a page in a headless browser and extracts links from the final DOM.",
      inputSchema: z.object({
        url: z.string().url(),
        maxLinks: z.number().int().min(1).max(16).optional(),
        keywords: z.array(z.string()).optional()
      })
    },
    async ({ url, maxLinks = 8, keywords = [] }) => {
      const html = await dumpDom(browserExecutable, browserRunner, url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url,
              links: extractLinks(html, url, maxLinks, keywords)
            })
          }
        ]
      };
    }
  );

  server.registerTool(
    "browserInspectPage",
    {
      description: "Returns a richer rendered snapshot: title, meta description, headings, preview and sample links.",
      inputSchema: z.object({
        url: z.string().url(),
        maxChars: z.number().int().min(300).max(16000).optional()
      })
    },
    async ({ url, maxChars = 5000 }) => {
      const html = await dumpDom(browserExecutable, browserRunner, url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              url,
              title: extractTitle(html),
              metaDescription: extractMetaDescription(html),
              headings: extractHeadings(html),
              preview: stripHtml(html, maxChars),
              links: extractLinks(html, url, 8)
            })
          }
        ]
      };
    }
  );

  return server;
}
