import { describe, expect, test } from "vitest";
import { RepoManager } from "../../src/core/repo_manager.js";
import { createDefaultDeps } from "../../src/infra/default_deps.js";
import { runCli } from "../../src/interface/cli/run.js";
import {
  captureConsole,
  createComplexRepo,
  createCycleRepo,
  createRepoWithManyDiamondOccurrences,
  createRepoWithManyDiamonds,
  createRepoWithUnusedPackages,
  createTempRepo,
} from "./helpers.js";

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

      // Check that files would be modified
      expect(result.filesModified).toBeGreaterThan(0);
      expect(result.projectsUpdated).toContain("@repo/app-web");

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
      // Should have removed @repo/unused from package.json
      expect(packageJson.dependencies).not.toHaveProperty("@repo/unused");
      // Should have added @repo/lib to tsconfig paths
      expect(tsconfig.compilerOptions.paths).toHaveProperty("@repo/lib");
      // Note: stale tsconfig paths are detected but not automatically removed
      // Should have removed unused reference
      expect(tsconfig.references).not.toContainEqual({ path: "../unused" });
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
      // Run once to sync everything
      await runCli([]);
      // Clear captured logs
      capture.logs.length = 0;
      capture.errors.length = 0;
      // Run again - should now be synced
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

  test("CLI with --config flag uses custom config file", async () => {
    const repo = await createTempRepo({ includeStale: false });
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const { writeTextFile } = await import("./helpers.js");
      const { join } = await import("node:path");
      // Create custom config
      await writeTextFile(
        join(repo.root, "custom.jsonc"),
        JSON.stringify({
          workspaceTypes: {
            "apps/*": { type: "app", subType: "website" },
            "packages/*": { type: "shared-package" },
          },
        }),
      );
      const exitCode = await runCli(["--config", "custom.jsonc", "--dry-run"]);
      expect(exitCode).toBe(0);
      expect(capture.logs.some((line) => line.includes("custom.jsonc"))).toBe(
        true,
      );
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI handles errors gracefully and exits with code 1", async () => {
    const capture = captureConsole();
    const originalCwd = process.cwd();
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tempDir = await mkdtemp(join(tmpdir(), "serenity-error-"));
    try {
      process.chdir(tempDir);
      // No config file, should error
      const exitCode = await runCli(["--dry-run"]);
      expect(exitCode).toBe(1);
      expect(
        capture.errors.some((line) => line.includes("Error running")),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("CLI with --verbose shows error stack trace on failure", async () => {
    const capture = captureConsole();
    const originalCwd = process.cwd();
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tempDir = await mkdtemp(join(tmpdir(), "serenity-verbose-error-"));
    try {
      process.chdir(tempDir);
      const exitCode = await runCli(["--verbose", "--dry-run"]);
      expect(exitCode).toBe(1);
      // Should show stack trace with verbose
      expect(
        capture.errors.some(
          (line) => line.includes("at ") || line.includes("Error"),
        ),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("CLI shows diamond dependencies in verbose mode", async () => {
    const repo = await createCycleRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run", "--force", "--verbose"]);
      expect(exitCode).toBe(0);
      expect(
        capture.logs.some((line) => line.includes("Diamond Dependencies")),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI alias flags work correctly", async () => {
    const capture = captureConsole();
    try {
      // Test -h alias for --help
      const exitCode = await runCli(["-h"]);
      expect(exitCode).toBe(0);
      expect(capture.logs.some((line) => line.includes("serenity-now"))).toBe(
        true,
      );
    } finally {
      capture.restore();
    }
  });

  test("CLI verbose mode shows projects with most dependencies", async () => {
    const repo = await createComplexRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run", "--verbose"]);
      expect(exitCode).toBe(0);
      // Should show "Projects with most dependencies"
      expect(
        capture.logs.some((line) =>
          line.includes("Projects with most dependencies"),
        ),
      ).toBe(true);
      // Should show package a which has 3 dependencies
      expect(
        capture.logs.some(
          (line) => line.includes("@repo/a") && line.includes("3"),
        ),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI health report shows universal utilities", async () => {
    const repo = await createComplexRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--health"]);
      expect(exitCode).toBe(0);
      // Should show universal utilities section
      expect(
        capture.logs.some((line) => line.includes("Universal utilities")),
      ).toBe(true);
      expect(capture.logs.some((line) => line.includes("@repo/utils"))).toBe(
        true,
      );
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI health report shows missing tsconfig warnings", async () => {
    const repo = await createComplexRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--health"]);
      expect(exitCode).toBe(0);
      // Should show missing tsconfig section
      expect(
        capture.logs.some((line) => line.includes("Missing tsconfig.json")),
      ).toBe(true);
      expect(capture.logs.some((line) => line.includes("@repo/broken"))).toBe(
        true,
      );
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI verbose mode shows most depended-upon packages", async () => {
    const repo = await createComplexRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run", "--verbose"]);
      expect(exitCode).toBe(0);
      // Should show "Most depended-upon packages"
      expect(
        capture.logs.some((line) => line.includes("Most depended-upon")),
      ).toBe(true);
      // @repo/utils should be most depended upon (used by a, b, c)
      expect(capture.logs.some((line) => line.includes("@repo/utils"))).toBe(
        true,
      );
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI health report with cycles shows circular dependencies", async () => {
    const repo = await createCycleRepo();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      // Health report exits after showing the report, but before cycle check
      // so it will exit with code 2 due to cycles without --force
      const exitCode = await runCli(["--health", "--force"]);
      expect(exitCode).toBe(0);
      // Should show circular dependencies section in health report
      expect(
        capture.logs.some(
          (line) =>
            line.includes("Circular Dependencies") && line.includes("detected"),
        ),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI verbose mode shows potentially unused shared packages", async () => {
    const repo = await createRepoWithUnusedPackages();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--dry-run", "--verbose"]);
      expect(exitCode).toBe(0);

      // Should show "Potentially unused packages"
      expect(
        capture.logs.some((line) => line.includes("Potentially unused")),
      ).toBe(true);
      // Should show @repo/unused as an unused shared package
      expect(capture.logs.some((line) => line.includes("@repo/unused"))).toBe(
        true,
      );
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  }, 10000);

  test("CLI health report with many diamonds shows truncation message", async () => {
    const repo = await createRepoWithManyDiamonds();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--health"]);
      expect(exitCode).toBe(0);
      // Should show truncation message when there are >10 diamonds
      expect(
        capture.logs.some(
          (line) => line.includes("... and") && line.includes("more packages"),
        ),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });

  test("CLI health report shows truncation for package with many occurrences", async () => {
    const repo = await createRepoWithManyDiamondOccurrences();
    const capture = captureConsole();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const exitCode = await runCli(["--health"]);
      expect(exitCode).toBe(0);
      // Should show "... and X more" when a package has >3 occurrences
      expect(
        capture.logs.some(
          (line) => line.includes("... and") && line.includes("more"),
        ),
      ).toBe(true);
    } finally {
      capture.restore();
      process.chdir(originalCwd);
      await repo.teardown();
    }
  });
});
