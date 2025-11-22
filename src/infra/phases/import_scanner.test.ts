import { createImportScanner } from "./import_scanner.ts";
import type { FileSystemPort, LoggerPort } from "../../core/ports.ts";
import type {
  ProjectInventory,
  RepoManagerOptions,
  SyncConfig,
} from "../../core/types.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`Expected ${b} but received ${a}`);
  }
}

class InMemoryFileSystem implements FileSystemPort {
  #files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.#files.set(path, content);
    }
  }

  readJson<T>(path: string): Promise<T> {
    return Promise.resolve(JSON.parse(this.#files.get(path) ?? "{}") as T);
  }

  writeJson(): Promise<void> {
    return Promise.resolve();
  }

  fileExists(path: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(path));
  }

  readText(path: string): Promise<string> {
    return Promise.resolve(this.#files.get(path) ?? "");
  }

  writeText(): Promise<void> {
    return Promise.resolve();
  }
}

function createLogger(): LoggerPort {
  return {
    phase: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

const baseInventory: ProjectInventory = {
  projects: {
    "@repo/app": {
      id: "@repo/app",
      root: "/repo/apps/app",
      relativeRoot: "apps/app",
      packageJson: { name: "@repo/app" },
      workspaceType: "app",
      workspaceSubType: "website",
      isPrivate: true,
    },
  },
  warnings: [],
  workspaceConfigs: {},
};

const baseConfig: SyncConfig = {
  defaultDependencies: [],
};

function createWalker(entries: Array<{ path: string }>) {
  return async function* (_root: string) {
    for (const entry of entries) {
      yield { path: entry.path, isFile: true };
    }
  };
}

Deno.test("import scanner captures dependencies", async () => {
  const fs = new InMemoryFileSystem({
    "/repo/apps/app/index.ts": `
      import React from "react";
      import type { Config } from "@types/config";
      export { something } from "@repo/shared";
      const module = await import("@repo/dynamic");
      const data = require("@repo/legacy");
      import "./local";
    `,
  });

  const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
  const scanner = createImportScanner({ walker });

  const usage = await scanner.scan(
    baseInventory,
    baseConfig,
    {} as RepoManagerOptions,
    createLogger(),
    fs,
  );

  const record = usage.usage["@repo/app"];
  assert(record !== undefined, "Usage record missing");
  assertEquals(record.dependencies.sort(), [
    "@repo/dynamic",
    "@repo/legacy",
    "@repo/shared",
    "react",
  ]);
  assertEquals(record.typeOnlyDependencies, ["@types/config"]);
  assertEquals(record.usageDetails.length, 5);
});

Deno.test("import scanner respects ignore list and defaults", async () => {
  const fs = new InMemoryFileSystem({
    "/repo/apps/app/index.ts": `
      import foo from "foo";
      import bar from "@internal/bar";
    `,
  });
  const walker = createWalker([{ path: "/repo/apps/app/index.ts" }]);
  const scanner = createImportScanner({ walker });

  const config: SyncConfig = {
    ignoreImports: ["@internal/bar"],
    defaultDependencies: ["@repo/env"],
  };

  const usage = await scanner.scan(
    baseInventory,
    config,
    {} as RepoManagerOptions,
    createLogger(),
    fs,
  );

  const record = usage.usage["@repo/app"];
  assert(record !== undefined, "Usage record missing");
  assertEquals(record.dependencies.sort(), ["@repo/env", "foo"]);
});
