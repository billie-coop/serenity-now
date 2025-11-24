import { describe, expect, test } from "vitest";
import { RepoManager } from "../../src/core/repo_manager.js";
import { createDefaultDeps } from "../../src/infra/default_deps.js";
import { runCli } from "../../src/interface/cli/run.js";
import { captureConsole, createCycleRepo, createTempRepo } from "./helpers.js";

describe("Integration Tests", () => {
  test("RepoManager dry-run produces expected diffs and stale info", async () => {
    const repo = await createTempRepo({ includeStale: true });
    try {
      expect(repo.appPackage).toBeDefined();
      expect(repo.appTsconfig).toBeDefined();

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

      expect(result.diffs).toBeDefined();
      expect(result.diffs).toHaveProperty(repo.appPackage as string);
      expect(result.diffs).toHaveProperty(repo.appTsconfig as string);

      const stale = result.staleDependencies["@repo/app-web"];
      expect(stale).toBeDefined();
      expect(stale?.packageJsonDeps).toEqual(["@repo/unused"]);
      expect(stale?.tsconfigPaths).toEqual(["@repo/unused"]);
      expect(stale?.tsconfigReferences).toEqual(["../unused"]);

      expect(result.projectsUpdated).toContain("@repo/app-web");
    } finally {
      await repo.teardown();
    }
  });

  test("CLI dry-run with fail-on-stale returns non-zero and logs warning", async () => {
    const repo = await createTempRepo({ includeStale: true });
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run", "--fail-on-stale"]);
      expect(exitCode).toBe(1);
      expect(
        capture.errors.some((line) =>
          line.includes("Stale dependencies detected"),
        ),
      ).toBe(true);
      expect(
        capture.logs.some((line) => line.includes("Dry run complete")),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("RepoManager finds no stale dependencies when already synced", async () => {
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

      expect(Object.keys(result.staleDependencies).length).toBe(0);
    } finally {
      await repo.teardown();
    }
  });

  test("RepoManager detects dependency cycles between packages", async () => {
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

      expect(graph.cycles.length).toBeGreaterThan(0);
    } finally {
      await repo.teardown();
    }
  });

  test("CLI --help flag displays help and exits successfully", async () => {
    const capture = captureConsole();
    try {
      const exitCode = await runCli(["--help"]);
      expect(exitCode).toBe(0);
      expect(capture.logs.some((line) => line.includes("serenity-now"))).toBe(
        true,
      );
      expect(capture.logs.some((line) => line.includes("Usage:"))).toBe(true);
    } finally {
      capture.restore();
    }
  });

  test("CLI with circular dependencies exits with code 2 without --force", async () => {
    const repo = await createCycleRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run"]);
      expect(exitCode).toBe(2);
      expect(
        capture.errors.some((line) => line.includes("circular dependency")),
      ).toBe(true);
      expect(capture.errors.some((line) => line.includes("--force"))).toBe(
        true,
      );
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI with --force continues despite circular dependencies", async () => {
    const repo = await createCycleRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run", "--force"]);
      expect(exitCode).toBe(0);
      expect(capture.logs.some((line) => line.includes("Warning"))).toBe(true);
      expect(
        capture.logs.some((line) => line.includes("circular dependency")),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI with --verbose shows detailed analysis", async () => {
    const repo = await createTempRepo({ includeStale: false });
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run", "--verbose"]);
      expect(exitCode).toBe(0);
      expect(
        capture.logs.some((line) => line.includes("Import Analysis")),
      ).toBe(true);
      expect(
        capture.logs.some((line) => line.includes("Dependency Graph Analysis")),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI with --health shows health report and exits", async () => {
    const repo = await createTempRepo({ includeStale: false });
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--health"]);
      expect(exitCode).toBe(0);
      expect(capture.logs.some((line) => line.includes("Health Check"))).toBe(
        true,
      );
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI actually writes files when not in dry-run mode", async () => {
    const repo = await createTempRepo({ includeStale: true });
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli([]);
      expect(exitCode).toBe(0);
      expect(
        capture.logs.some((line) => line.includes("Files modified:")),
      ).toBe(true);
      expect(capture.logs.some((line) => line.includes("Updated"))).toBe(true);

      // Verify files were actually modified
      const { readFile } = await import("node:fs/promises");
      const packageJson = JSON.parse(
        await readFile(repo.appPackage as string, "utf-8"),
      );
      const tsconfig = JSON.parse(
        await readFile(repo.appTsconfig as string, "utf-8"),
      );

      // Should have added @repo/lib dependency
      expect(packageJson.dependencies).toHaveProperty("@repo/lib");
      // Should have removed @repo/unused
      expect(packageJson.dependencies).not.toHaveProperty("@repo/unused");
      expect(tsconfig.compilerOptions.paths).toHaveProperty("@repo/lib");
      expect(tsconfig.compilerOptions.paths).not.toHaveProperty("@repo/unused");
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI reports success when repo is already synced", async () => {
    const repo = await createTempRepo({ includeStale: false });
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli([]);
      expect(exitCode).toBe(0);
      expect(
        capture.logs.some((line) =>
          line.includes("All dependencies are already in sync"),
        ),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });
});
