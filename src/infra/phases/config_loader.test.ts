import { createConfigLoader } from "./config_loader.ts";
import type { LoggerPort } from "../../core/ports.ts";
import type { FileSystemPort } from "../../core/ports.ts";
import type { WorkspaceTypeConfig } from "../../core/types.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    message ?? `Expected ${expectedJson} but received ${actualJson}`,
  );
}

async function assertRejects(
  fn: () => Promise<unknown>,
  substring?: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (substring && error instanceof Error) {
      assert(
        error.message.includes(substring),
        `Expected error message to include "${substring}" but received "${error.message}"`,
      );
    }
    return;
  }
  throw new Error("Expected promise to reject but it resolved");
}

class InMemoryFileSystem implements FileSystemPort {
  #files = new Map<string, string>();
  writtenPaths: string[] = [];

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, contents] of Object.entries(initialFiles)) {
      this.#files.set(path, contents);
    }
  }

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await this.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  fileExists(path: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(path));
  }

  readText(path: string): Promise<string> {
    if (!this.#files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return Promise.resolve(this.#files.get(path) as string);
  }

  writeText(path: string, contents: string): Promise<void> {
    this.writtenPaths.push(path);
    this.#files.set(path, contents);
    return Promise.resolve();
  }
}

function createTestLogger(): LoggerPort & { infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    infos,
    warns,
    phase: () => {},
    info: (msg) => infos.push(msg),
    warn: (msg) => warns.push(msg),
    error: () => {},
    debug: () => {},
    getWarnings: () => [...warns],
  };
}

Deno.test("config loader parses existing config", async () => {
  const fs = new InMemoryFileSystem({
    "/repo/serenity-now.config.jsonc": `{
      // comment line
      "defaultDependencies": ["react"],
      "workspaceTypes": {
        "apps/*": { "type": "app", "subType": "website" }
      }
    }`,
  });
  const logger = createTestLogger();
  const loader = createConfigLoader();

  const config = await loader.load({ rootDir: "/repo" }, logger, fs);

  const expectedWorkspace: WorkspaceTypeConfig = {
    type: "app",
    subType: "website",
  };
  assertEquals(config.defaultDependencies, ["react"]);
  assertEquals(config.workspaceTypes?.["apps/*"], expectedWorkspace);
  assert(
    logger.infos.some((msg) => msg.includes("Loading serenity-now config")),
    "expected info log when loading config",
  );
});

Deno.test("config loader creates template when missing", async () => {
  const fs = new InMemoryFileSystem();
  const logger = createTestLogger();
  const loader = createConfigLoader();

  await assertRejects(
    () => loader.load({ rootDir: "/repo" }, logger, fs),
    "Configuration file created",
  );

  assertEquals(fs.writtenPaths, ["/repo/serenity-now.config.jsonc"]);
  assert(
    logger.infos.some((msg) =>
      msg.includes("Created serenity-now config template")
    ),
    "expected info log when template is created",
  );
});

Deno.test("config loader validates workspace type entries", async () => {
  const fs = new InMemoryFileSystem({
    "/repo/serenity-now.config.jsonc": `{
      "workspaceTypes": {
        "packages/*": { "type": "invalid" }
      }
    }`,
  });
  const logger = createTestLogger();
  const loader = createConfigLoader();

  await assertRejects(
    () => loader.load({ rootDir: "/repo" }, logger, fs),
    "workspaceTypes",
  );
});
