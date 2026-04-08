import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PermissionController,
  PermissionDeniedError,
  PermissionStore,
  ensureOrkionHome,
  type PermissionDecision,
  type PermissionPrompter
} from "../src/runtime/permission-control.ts";

function withTempDir(run: (dir: string) => void | Promise<void>): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "orkion-permissions-"));
  const result = run(dir);

  if (result instanceof Promise) {
    return result.finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  rmSync(dir, { recursive: true, force: true });
}

function createPrompter(decision: PermissionDecision, tracker: { calls: number }): PermissionPrompter {
  return {
    async requestPermission() {
      tracker.calls += 1;
      return decision;
    }
  };
}

describe("permission control", () => {
  test("creates .orkion and permissions.json on startup", () =>
    withTempDir((dir) => {
      const paths = ensureOrkionHome(dir);
      const raw = readFileSync(paths.permissionsFile, "utf8");
      const parsed = JSON.parse(raw) as { version: number; permissions: Record<string, unknown> };

      expect(paths.homeDir.endsWith(".orkion")).toBe(true);
      expect(parsed.version).toBe(1);
      expect(parsed.permissions).toEqual({});
    }));

  test("allow_once only lasts for the current task controller", async () =>
    withTempDir(async (dir) => {
      const tracker = { calls: 0 };
      const store = new PermissionStore(dir);

      const firstTask = new PermissionController(store, createPrompter("allow_once", tracker));
      await firstTask.ensureToolPermission("searchWeb");
      await firstTask.ensureToolPermission("fetchWebPage");
      expect(tracker.calls).toBe(1);

      const secondTask = new PermissionController(store, createPrompter("allow_once", tracker));
      await secondTask.ensureToolPermission("searchWeb");
      expect(tracker.calls).toBe(2);
    }));

  test("allow_always is persisted in permissions.json", async () =>
    withTempDir(async (dir) => {
      const tracker = { calls: 0 };
      const store = new PermissionStore(dir);
      const controller = new PermissionController(store, createPrompter("allow_always", tracker));

      await controller.ensureToolPermission("searchWeb");
      expect(tracker.calls).toBe(1);

      const persistedStore = new PermissionStore(dir);
      const reusedController = new PermissionController(persistedStore);
      await reusedController.ensureToolPermission("fetchWebPage");

      const raw = readFileSync(join(dir, ".orkion", "permissions.json"), "utf8");
      const parsed = JSON.parse(raw) as { permissions: Record<string, { allowed: boolean }> };
      expect(parsed.permissions["mcp.curl"]?.allowed).toBe(true);
    }));

  test("deny blocks the tool", async () =>
    withTempDir(async (dir) => {
      const store = new PermissionStore(dir);
      const controller = new PermissionController(store, createPrompter("deny", { calls: 0 }));

      await expect(controller.ensureToolPermission("searchWeb")).rejects.toBeInstanceOf(PermissionDeniedError);
    }));
});
