import { dirname, join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { RepoManager } from "../../src/core/repo_manager.ts";
import { createDefaultDeps } from "../../src/infra/default_deps.ts";
import { runCli } from "../../src/interface/cli/run.ts";

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(path: string, value: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, value);
}

interface TempRepoOptions {
  includeStale?: boolean;
}

async function createTempRepo(
  options: TempRepoOptions = {},
): Promise<{
  root: string;
  appPackage: string;
  appTsconfig: string;
}> {
  const includeStale = options.includeStale ?? true;
  const root = await Deno.makeTempDir({ prefix: "serenity-integration-" });

  await writeJsonFile(join(root, "package.json"), {
    name: "serenity-integration",
    private: true,
    workspaces: ["apps/*", "packages/*"],
  });

  await writeTextFile(
    join(root, "serenity-now.config.jsonc"),
    JSON.stringify(
      {
        workspaceTypes: {
          "apps/*": { type: "app", subType: "website" },
          "packages/*": { type: "shared-package" },
        },
      },
      null,
      2,
    ),
  );

  const appDir = join(root, "apps/web");
  const appPackage = join(appDir, "package.json");
  const appTsconfig = join(appDir, "tsconfig.json");
  await writeJsonFile(appPackage, {
    name: "@repo/app-web",
    version: "0.0.0",
    dependencies: includeStale
      ? {
        "@repo/unused": "workspace:*",
        lodash: "^4.17.0",
      }
      : {
        "@repo/lib": "workspace:*",
        lodash: "^4.17.0",
      },
  });
  await writeJsonFile(appTsconfig, {
    compilerOptions: {
      baseUrl: ".",
      paths: includeStale ? { "@repo/unused": ["../unused/src/index.ts"] } : {
        "@repo/lib": ["../../packages/lib/src/index.ts"],
        "@repo/lib/*": ["../../packages/lib/src/*"],
      },
    },
    references: includeStale
      ? [{ path: "../unused" }]
      : [{ path: "../../packages/lib" }],
  });
  const staleImport = includeStale ? 'import "@repo/unused";\n' : "";
  await writeTextFile(
    join(appDir, "src/main.ts"),
    `${staleImport}import { greeting } from "@repo/lib";
console.log(greeting);`,
  );

  const libDir = join(root, "packages/lib");
  await writeJsonFile(join(libDir, "package.json"), {
    name: "@repo/lib",
    version: "0.0.0",
  });
  await writeJsonFile(join(libDir, "tsconfig.json"), {
    compilerOptions: {},
  });
  await writeTextFile(
    join(libDir, "src/index.ts"),
    `export const greeting = "hello";`,
  );

  return { root, appPackage, appTsconfig };
}

function captureConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = ((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  }) as typeof console.log;
  console.error = ((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  }) as typeof console.error;
  return {
    logs,
    errors,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

Deno.test("RepoManager dry-run produces expected diffs and stale info", async () => {
  const { root, appPackage, appTsconfig } = await createTempRepo({
    includeStale: true,
  });
  try {
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);
    const result = await manager.emitChanges(graph, inventory);

    assert(result.diffs, "Expected diffs in dry-run result");
    assert(
      appPackage in result.diffs,
      "Expected package.json diff for app package",
    );
    assert(
      result.diffs[appPackage]?.includes("@repo/lib"),
      "Diff should include dependency on @repo/lib",
    );
    assert(
      appTsconfig in result.diffs,
      "Expected tsconfig diff for app package",
    );

    const stale = result.staleDependencies["@repo/app-web"];
    assert(stale, "Expected stale dependencies for @repo/app-web");
    assertEquals(stale.packageJsonDeps, ["@repo/unused"]);
    assertEquals(stale.tsconfigPaths, ["@repo/unused"]);
    assertEquals(stale.tsconfigReferences, ["../unused"]);

    assertEquals(
      result.projectsUpdated.includes("@repo/app-web"),
      true,
      "App project should be marked as updated",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("CLI dry-run with fail-on-stale returns non-zero and logs warning", async () => {
  const { root } = await createTempRepo({ includeStale: true });
  const capture = captureConsole();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(root);
    const exitCode = await runCli(["--dry-run", "--fail-on-stale"]);
    assertEquals(exitCode, 1);
    assert(
      capture.errors.some((line) =>
        line.includes("Stale dependencies detected")
      ),
      "Expected stale dependency error output",
    );
    assert(
      capture.logs.some((line) => line.includes("Dry run complete")),
      "Expected dry run summary message",
    );
  } finally {
    capture.restore();
    Deno.chdir(originalCwd);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("RepoManager finds no stale dependencies when already synced", async () => {
  const { root } = await createTempRepo({ includeStale: false });
  try {
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);
    const result = await manager.emitChanges(graph, inventory);

    assertEquals(Object.keys(result.staleDependencies).length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
