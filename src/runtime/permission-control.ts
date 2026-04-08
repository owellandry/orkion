import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PermissionDecision = "allow_once" | "allow_always" | "deny";

export interface PermissionRequest {
  key: string;
  title: string;
  description: string;
  toolName: string;
}

export interface PermissionPrompter {
  requestPermission(request: PermissionRequest): Promise<PermissionDecision>;
}

interface PermissionFile {
  version: 1;
  permissions: Record<string, { allowed: true; updatedAt: string }>;
}

const DEFAULT_PERMISSION_FILE: PermissionFile = {
  version: 1,
  permissions: {}
};

function readJsonFile(filePath: string): PermissionFile {
  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_PERMISSION_FILE);
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PermissionFile>;
    return {
      version: 1,
      permissions: parsed.permissions ?? {}
    };
  } catch {
    return structuredClone(DEFAULT_PERMISSION_FILE);
  }
}

export function ensureOrkionHome(baseDir = process.cwd()): { homeDir: string; permissionsFile: string } {
  const homeDir = join(baseDir, ".orkion");
  const permissionsFile = join(homeDir, "permissions.json");

  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true });
  }

  if (!existsSync(permissionsFile)) {
    writeFileSync(permissionsFile, JSON.stringify(DEFAULT_PERMISSION_FILE, null, 2) + "\n", "utf8");
  }

  return { homeDir, permissionsFile };
}

export class PermissionStore {
  private readonly filePath: string;
  private data: PermissionFile;

  constructor(baseDir = process.cwd()) {
    const { permissionsFile } = ensureOrkionHome(baseDir);
    this.filePath = permissionsFile;
    this.data = readJsonFile(this.filePath);
  }

  resetSession(): void {
    // Session-level grants are intentionally not persisted here.
    // "allow_once" is managed by PermissionController per task execution.
  }

  isAllowed(key: string): boolean {
    return Boolean(this.data.permissions[key]?.allowed);
  }

  allowAlways(key: string): void {
    this.data.permissions[key] = {
      allowed: true,
      updatedAt: new Date().toISOString()
    };
    this.write();
  }

  private write(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n", "utf8");
  }
}

export class PermissionDeniedError extends Error {
  constructor(public readonly request: PermissionRequest) {
    super(`Permission denied for ${request.toolName}`);
    this.name = "PermissionDeniedError";
  }
}

const TOOL_PERMISSIONS: Record<string, Omit<PermissionRequest, "toolName">> = {
  searchWeb: {
    key: "mcp.curl",
    title: "Permiso para investigar en la web",
    description: "Lyra quiere usar curl para buscar informacion en la web."
  },
  fetchWebPage: {
    key: "mcp.curl",
    title: "Permiso para leer paginas web",
    description: "Lyra quiere usar curl para leer el contenido de una pagina."
  },
  extractLinksFromPage: {
    key: "mcp.curl",
    title: "Permiso para analizar enlaces",
    description: "Lyra quiere usar curl para extraer enlaces relevantes de una pagina."
  },
  fetchRobotsOrSitemap: {
    key: "mcp.curl",
    title: "Permiso para descubrir rutas del sitio",
    description: "Lyra quiere usar curl para consultar robots.txt o sitemap.xml."
  },
  fetchGitHubReadme: {
    key: "mcp.curl",
    title: "Permiso para leer README en GitHub",
    description: "Lyra quiere usar curl para leer el README de un repositorio."
  },
  fetchNpmPackageInfo: {
    key: "mcp.curl",
    title: "Permiso para consultar npm",
    description: "Lyra quiere usar curl para consultar metadata de un paquete npm."
  },
  curlRequest: {
    key: "mcp.curl",
    title: "Permiso para ejecutar curl directo",
    description: "Lyra quiere ejecutar una request HTTP directa con curl."
  },
  browserStatus: {
    key: "mcp.browser",
    title: "Permiso para usar navegador MCP",
    description: "Lyra quiere comprobar si el navegador headless esta disponible."
  },
  browserInspectPage: {
    key: "mcp.browser",
    title: "Permiso para renderizar paginas",
    description: "Lyra quiere abrir una pagina con el navegador headless para investigarla mejor."
  },
  browserExtractLinks: {
    key: "mcp.browser",
    title: "Permiso para inspeccion de enlaces en navegador",
    description: "Lyra quiere extraer enlaces desde la pagina renderizada."
  },
  getOsContext: {
    key: "system.info",
    title: "Permiso para leer contexto del sistema",
    description: "System quiere consultar informacion basica del entorno y sistema operativo."
  },
  runCommand: {
    key: "system.command",
    title: "Permiso para ejecutar comandos del sistema",
    description: "System quiere ejecutar un comando en tu shell local."
  },
  gitExec: {
    key: "git.exec",
    title: "Permiso para ejecutar comandos de git",
    description: "Kyra quiere ejecutar comandos de git en el repositorio actual."
  }
};

function buildPermissionRequest(toolName: string): PermissionRequest | undefined {
  const config = TOOL_PERMISSIONS[toolName];
  if (!config) return undefined;
  return {
    ...config,
    toolName
  };
}

export class PermissionController {
  private readonly transientPermissions = new Set<string>();

  constructor(
    private readonly store: PermissionStore,
    private readonly prompter?: PermissionPrompter
  ) {}

  resetSession(): void {
    this.transientPermissions.clear();
    this.store.resetSession();
  }

  async ensureToolPermission(toolName: string): Promise<void> {
    const request = buildPermissionRequest(toolName);
    if (!request) {
      return;
    }

    if (this.transientPermissions.has(request.key) || this.store.isAllowed(request.key)) {
      return;
    }

    if (!this.prompter) {
      throw new PermissionDeniedError(request);
    }

    const decision = await this.prompter.requestPermission(request);
    if (decision === "allow_once") {
      this.transientPermissions.add(request.key);
      return;
    }

    if (decision === "allow_always") {
      this.store.allowAlways(request.key);
      return;
    }

    throw new PermissionDeniedError(request);
  }
}
