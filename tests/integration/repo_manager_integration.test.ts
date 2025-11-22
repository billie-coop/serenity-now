import { assert, assertEquals } from "@std/assert";
import { RepoManager } from "../../src/core/repo_manager.ts";
import { createDefaultDeps } from "../../src/infra/default_deps.ts";
import { runCli } from "../../src/interface/cli/run.ts";
import {
  captureConsole,
  createCycleRepo,
  createDiamondRepo,
  createTempRepo,
} from "./helpers.ts";

Deno.test("RepoManager dry-run produces expected diffs and stale info", async () => {
  const repo = await createTempRepo({ includeStale: true });
  try {
    assert(repo.appPackage && repo.appTsconfig);
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: repo.root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);
    const result = await manager.emitChanges(graph, inventory);

    assert(result.diffs, "Expected diffs in dry-run result");
    assert(repo.appPackage in result.diffs);
    assert(repo.appTsconfig in result.diffs);

    const stale = result.staleDependencies["@repo/app-web"];
    assert(stale, "Expected stale dependencies for app");
    assertEquals(stale.packageJsonDeps, ["@repo/unused"]);
    assertEquals(stale.tsconfigPaths, ["@repo/unused"]);
    assertEquals(stale.tsconfigReferences, ["../unused"]);

    assert(result.projectsUpdated.includes("@repo/app-web"));
  } finally {
    await repo.teardown();
  }
});

Deno.test("CLI dry-run with fail-on-stale returns non-zero and logs warning", async () => {
  const repo = await createTempRepo({ includeStale: true });
  const capture = captureConsole();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(repo.root);
    const exitCode = await runCli(["--dry-run", "--fail-on-stale"]);
    assertEquals(exitCode, 1);
    assert(
      capture.errors.some((line) =>
        line.includes("Stale dependencies detected")
      ),
    );
    assert(
      capture.logs.some((line) => line.includes("Dry run complete")),
    );
  } finally {
    capture.restore();
    Deno.chdir(originalCwd);
    await repo.teardown();
  }
});

Deno.test("CLI dry-run without stale dependencies reports no changes", async () => {
  const repo = await createTempRepo({ includeStale: false });
  const capture = captureConsole();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(repo.root);
    const exitCode = await runCli(["--dry-run"]);
    assertEquals(exitCode, 0);
    assert(
      capture.logs.some((line) => line.includes("No changes were necessary")),
      "Expected no-change summary",
    );
  } finally {
    capture.restore();
    Deno.chdir(originalCwd);
    await repo.teardown();
  }
});

Deno.test("RepoManager finds no stale dependencies when already synced", async () => {
  const repo = await createTempRepo({ includeStale: false });
  try {
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: repo.root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);
    const result = await manager.emitChanges(graph, inventory);

    assertEquals(Object.keys(result.staleDependencies).length, 0);
  } finally {
    await repo.teardown();
  }
});

Deno.test("RepoManager detects dependency cycles between packages", async () => {
  const repo = await createCycleRepo();
  try {
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: repo.root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);

    assert(graph.cycles.length > 0, "Expected cycle to be detected");
  } finally {
    await repo.teardown();
  }
});

Deno.test("RepoManager handles diamond dependency structure", async () => {
  const repo = await createDiamondRepo();
  try {
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: repo.root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);
    const result = await manager.emitChanges(graph, inventory);

    assertEquals(Object.keys(result.staleDependencies).length, 0);
    assertEquals(graph.cycles.length, 0, "Diamond graph should be acyclic");
    assert(result.projectsUpdated.includes("@repo/web"));
  } finally {
    await repo.teardown();
  }
});

Deno.test("RepoManager enforces default dependencies", async () => {
  const repo = await createTempRepo({
    includeStale: false,
    defaultDependencies: ["@repo/shared"],
  });
  try {
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: repo.root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    const usage = await manager.scanImports(inventory);
    const graph = await manager.resolveGraph(inventory, usage);
    const result = await manager.emitChanges(graph, inventory);

    assertEquals(Object.keys(result.staleDependencies).length, 0);
    const appRecord = inventory.projects["@repo/app-web"];
    assert(appRecord, "App project missing from inventory");
    assertEquals(
      graph.projects["@repo/app-web"]?.dependencies["@repo/lib"]?.reason,
      "import",
    );
  } finally {
    await repo.teardown();
  }
});
Deno.test("Workspace discovery warns when tsconfig is missing", async () => {
  const repo = await createTempRepo({
    includeStale: false,
    missingTsconfig: true,
  });
  try {
    const deps = createDefaultDeps({ verbose: false });
    const manager = new RepoManager(
      { rootDir: repo.root, dryRun: true, verbose: false },
      deps,
    );

    await manager.loadConfig();
    const inventory = await manager.discoverWorkspace();
    assert(
      inventory.warnings.some((w) => w.includes("missing tsconfig")),
      "Expected missing tsconfig warning",
    );
  } finally {
    await repo.teardown();
  }
});
