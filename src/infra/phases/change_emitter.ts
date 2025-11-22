import { dirname, join, relative } from "@std/path";
import type {
  ChangeEmitterPort,
  FileSystemPort,
  LoggerPort,
} from "../../core/ports.ts";
import type {
  EmitResult,
  PackageJson,
  ProjectInventory,
  RepoManagerOptions,
  ResolvedDependency,
  ResolvedGraph,
  ResolvedProject,
  StaleDependencies,
  SyncConfig,
  TsConfig,
} from "../../core/types.ts";

interface JsonLike {
  [key: string]: unknown;
}

interface PackageUpdateResult {
  updated: PackageJson;
  changed: boolean;
}

interface TsConfigUpdateResult {
  updated: TsConfig;
  changed: boolean;
}

function substituteTemplateVars(
  template: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof template === "string") {
    return Object.entries(vars).reduce(
      (acc, [key, value]) =>
        acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value),
      template,
    );
  }
  if (Array.isArray(template)) {
    return template.map((entry) => substituteTemplateVars(entry, vars));
  }
  if (template && typeof template === "object") {
    const next: JsonLike = {};
    for (const [key, value] of Object.entries(template)) {
      next[key] = substituteTemplateVars(value, vars);
    }
    return next;
  }
  return template;
}

function isPlainObject(value: unknown): value is JsonLike {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function deepMerge(target: JsonLike, source: JsonLike): JsonLike {
  const result: JsonLike = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const current = result[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function createDiff(
  original: string,
  updated: string,
  filePath: string,
): string {
  const originalLines = original.split("\n");
  const updatedLines = updated.split("\n");
  let diff = `--- ${filePath}\n+++ ${filePath} (updated)\n`;
  let inChange = false;
  let changeStart = 0;

  const maxLines = Math.max(originalLines.length, updatedLines.length);
  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] ?? "";
    const newLine = updatedLines[i] ?? "";
    if (origLine !== newLine) {
      if (!inChange) {
        inChange = true;
        changeStart = Math.max(0, i - 2);
        diff += `@@ -${changeStart + 1},${
          Math.min(7, originalLines.length - changeStart)
        } +${changeStart + 1},${
          Math.min(7, updatedLines.length - changeStart)
        } @@\n`;
        for (let j = changeStart; j < i; j++) {
          diff += ` ${originalLines[j] ?? ""}\n`;
        }
      }
      if (i < originalLines.length) diff += `-${origLine}\n`;
      if (i < updatedLines.length) diff += `+${newLine}\n`;
    } else if (inChange) {
      diff += ` ${origLine}\n`;
      let hasMoreChanges = false;
      for (let j = i + 1; j < maxLines && j <= i + 3; j++) {
        if ((originalLines[j] ?? "") !== (updatedLines[j] ?? "")) {
          hasMoreChanges = true;
          break;
        }
      }
      if (!hasMoreChanges) {
        inChange = false;
      }
    }
  }
  return diff;
}

function detectStaleDependencies(
  project: ResolvedProject,
  currentPackageJson: PackageJson,
  currentTsconfig: TsConfig | null,
  inventory: ProjectInventory,
): StaleDependencies {
  const resolvedDeps = new Set(Object.keys(project.dependencies));
  const workspaceProjects = new Set(Object.keys(inventory.projects));
  const stale: StaleDependencies = {
    packageJsonDeps: [],
    tsconfigPaths: [],
    tsconfigReferences: [],
  };

  const allDeps = {
    ...(currentPackageJson.dependencies || {}),
    ...(currentPackageJson.devDependencies || {}),
  };

  for (const [dep, version] of Object.entries(allDeps)) {
    const isWorkspace = version?.includes("workspace:") ||
      workspaceProjects.has(dep);
    if (isWorkspace && !resolvedDeps.has(dep)) {
      stale.packageJsonDeps.push(dep);
    }
  }

  if (currentTsconfig?.compilerOptions?.paths) {
    for (const key of Object.keys(currentTsconfig.compilerOptions.paths)) {
      const base = key.replace(/\/\*$/, "");
      const looksWorkspace = workspaceProjects.has(base) ||
        base.startsWith("@");
      if (looksWorkspace && !resolvedDeps.has(base)) {
        stale.tsconfigPaths.push(key);
      }
    }
  }

  if (currentTsconfig?.references) {
    const expectedRefs = new Set<string>();
    for (const dep of Object.values(project.dependencies)) {
      const tsconfigDir = dirname(
        project.project.tsconfigPath ??
          join(project.project.root, "tsconfig.json"),
      );
      const relativePath = relative(tsconfigDir, dep.dependency.root)
        .replace(/\\/g, "/");
      expectedRefs.add(relativePath);
      expectedRefs.add(`./${relativePath}`);
    }
    for (const ref of currentTsconfig.references) {
      if (!expectedRefs.has(ref.path)) {
        stale.tsconfigReferences.push(ref.path);
      }
    }
  }

  return stale;
}

function updatePackageJson(
  project: ResolvedProject,
  currentPackageJson: PackageJson,
): PackageUpdateResult {
  let updated = structuredClone(currentPackageJson);

  if (project.project.workspaceConfig?.packageJsonTemplate) {
    const projectDir = project.project.relativeRoot.split("/").pop() ?? "";
    const substituted = substituteTemplateVars(
      project.project.workspaceConfig.packageJsonTemplate,
      { projectDir },
    ) as Partial<PackageJson>;
    updated = deepMerge(
      updated as JsonLike,
      substituted as JsonLike,
    ) as PackageJson;
  }

  const newDeps: Record<string, string> = {};
  for (const [name, version] of Object.entries(updated.dependencies || {})) {
    if (!version.includes("workspace:")) {
      newDeps[name] = version;
    }
  }

  for (const depId of Object.keys(project.dependencies)) {
    newDeps[depId] = "workspace:*";
  }

  const sortedKeys = Object.keys(newDeps).sort();
  if (sortedKeys.length > 0) {
    updated.dependencies = sortedKeys.reduce((acc, key) => {
      acc[key] = newDeps[key]!;
      return acc;
    }, {} as Record<string, string>);
  } else if (
    currentPackageJson.dependencies &&
    Object.keys(currentPackageJson.dependencies).length === 0
  ) {
    updated.dependencies = {};
  } else {
    delete updated.dependencies;
  }

  const changed =
    JSON.stringify(updated) !== JSON.stringify(currentPackageJson);
  return { updated, changed };
}

function computePathsForDependency(
  project: ResolvedProject,
  dep: ResolvedDependency,
): { base: string; wildcard: string } {
  const tsconfigDir = dirname(
    project.project.tsconfigPath ?? join(project.project.root, "tsconfig.json"),
  );
  const depRelative = relative(tsconfigDir, dep.dependency.root)
    .replace(/\\/g, "/");
  const entryPoint = join(depRelative, dep.entryPoint.path).replace(/\\/g, "/");
  const wildcardBase = dep.entryPoint.path.startsWith("src/")
    ? `${depRelative}/src/*`
    : `${depRelative}/*`;
  return {
    base: entryPoint,
    wildcard: wildcardBase.replace(/\\/g, "/"),
  };
}

function updateTsConfig(
  project: ResolvedProject,
  currentTsconfig: TsConfig,
): TsConfigUpdateResult {
  let updated = structuredClone(currentTsconfig);

  if (project.project.workspaceConfig?.tsconfigTemplate) {
    const projectDir = project.project.relativeRoot.split("/").pop() ?? "";
    const substituted = substituteTemplateVars(
      project.project.workspaceConfig.tsconfigTemplate,
      { projectDir },
    ) as Partial<TsConfig>;
    updated = deepMerge(
      updated as JsonLike,
      substituted as JsonLike,
    ) as TsConfig;
  }

  const newPaths: Record<string, string[]> = {};
  const workspaceDepIds = new Set(Object.keys(project.dependencies));
  for (
    const [pathKey, targets] of Object.entries(
      currentTsconfig.compilerOptions?.paths || {},
    )
  ) {
    const base = pathKey.replace(/\/\*$/, "");
    if (!workspaceDepIds.has(base)) {
      newPaths[pathKey] = targets;
    }
  }

  for (const [depId, dep] of Object.entries(project.dependencies)) {
    const { base, wildcard } = computePathsForDependency(project, dep);
    newPaths[depId] = [base];
    newPaths[`${depId}/*`] = [wildcard];
  }

  const sortedPaths: Record<string, string[]> = {};
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(newPaths)) {
    const base = key.replace(/\/\*$/, "");
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(key);
  }
  for (const base of Array.from(groups.keys()).sort()) {
    const entries = groups.get(base)!;
    entries.sort((a, b) => {
      if (a === base) return -1;
      if (b === base) return 1;
      return a.localeCompare(b);
    });
    for (const key of entries) {
      sortedPaths[key] = newPaths[key]!;
    }
  }

  const references = Object.values(project.dependencies).map((dep) => {
    const tsconfigDir = dirname(
      project.project.tsconfigPath ??
        join(project.project.root, "tsconfig.json"),
    );
    return {
      path: relative(tsconfigDir, dep.dependency.root).replace(/\\/g, "/"),
    };
  }).sort((a, b) => a.path.localeCompare(b.path));

  if (!updated.compilerOptions) updated.compilerOptions = {};
  updated.compilerOptions.paths = Object.keys(sortedPaths).length > 0
    ? sortedPaths
    : undefined;
  updated.references = references;

  const changed = JSON.stringify(updated) !== JSON.stringify(currentTsconfig);
  return { updated, changed };
}

async function readPackageJson(
  fs: FileSystemPort,
  path: string,
): Promise<PackageJson | null> {
  try {
    return await fs.readJson<PackageJson>(path);
  } catch {
    return null;
  }
}

async function readTsconfig(
  fs: FileSystemPort,
  path?: string,
): Promise<TsConfig | null> {
  if (!path) return null;
  if (!await fs.fileExists(path)) return null;
  try {
    return await fs.readJson<TsConfig>(path);
  } catch {
    return null;
  }
}

function logDifferences(
  logger: LoggerPort,
  projectId: string,
  project: ResolvedProject,
  currentPackageJson: PackageJson,
) {
  const imported = Object.keys(project.dependencies).sort();
  const reported = Object.keys(currentPackageJson.dependencies || {})
    .filter((name) =>
      name in project.dependencies || name.includes("workspace:")
    )
    .sort();
  const toAdd = imported.filter((dep) => !reported.includes(dep));
  const toRemove = reported.filter((dep) => !imported.includes(dep));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return;
  }

  logger.info(`\n📦 ${projectId}:`);
  logger.info(
    `  IMPORTED: ${imported.length ? imported.join(", ") : "NONE"}`,
  );
  logger.info(
    `  REPORTED: ${reported.length ? reported.join(", ") : "NONE"}`,
  );
  if (toAdd.length > 0) logger.info(`  ➕ TO ADD: ${toAdd.join(", ")}`);
  if (toRemove.length > 0) {
    logger.info(`  ➖ TO REMOVE: ${toRemove.join(", ")}`);
  }
}

export function createChangeEmitter(): ChangeEmitterPort {
  return {
    async emit(
      graph: ResolvedGraph,
      inventory: ProjectInventory,
      _config: SyncConfig,
      options: RepoManagerOptions,
      logger: LoggerPort,
      fs: FileSystemPort,
    ): Promise<EmitResult> {
      const dryRun = options.dryRun ?? false;
      const verbose = options.verbose ?? false;
      const result: EmitResult = {
        filesModified: 0,
        projectsUpdated: [],
        staleDependencies: {},
        diffs: dryRun ? {} : undefined,
        warnings: [],
      };

      logger.info("Analyzing project files for updates...");

      for (const [projectId, project] of Object.entries(graph.projects)) {
        const packageJsonPath = join(project.project.root, "package.json");
        const tsconfigPath = project.project.tsconfigPath;

        const currentPackageJson = await readPackageJson(fs, packageJsonPath);
        if (!currentPackageJson) {
          result.warnings.push(
            `Failed to read package.json for ${projectId}`,
          );
          continue;
        }

        const currentTsconfig = await readTsconfig(fs, tsconfigPath);

        logDifferences(logger, projectId, project, currentPackageJson);
        const stale = detectStaleDependencies(
          project,
          currentPackageJson,
          currentTsconfig,
          inventory,
        );
        if (
          stale.packageJsonDeps.length > 0 ||
          stale.tsconfigPaths.length > 0 ||
          stale.tsconfigReferences.length > 0
        ) {
          result.staleDependencies[projectId] = stale;
        }

        const {
          updated: updatedPackageJson,
          changed: packageJsonChanged,
        } = updatePackageJson(project, currentPackageJson);

        const tsconfigResult = currentTsconfig
          ? updateTsConfig(project, currentTsconfig)
          : null;

        let projectModified = false;

        if (packageJsonChanged) {
          const original = JSON.stringify(currentPackageJson, null, 2);
          const updated = JSON.stringify(updatedPackageJson, null, 2);
          if (dryRun) {
            if (result.diffs) {
              result.diffs[packageJsonPath] = createDiff(
                original,
                updated,
                packageJsonPath,
              );
            }
          } else {
            await fs.writeText(packageJsonPath, `${updated}\n`);
          }
          result.filesModified++;
          projectModified = true;
          if (verbose) {
            logger.debug?.(`Updated package.json for ${projectId}`);
          }
        }

        if (tsconfigResult?.changed && tsconfigPath) {
          const original = JSON.stringify(currentTsconfig, null, 2);
          const updated = JSON.stringify(tsconfigResult.updated, null, 2);
          if (dryRun) {
            if (result.diffs) {
              result.diffs[tsconfigPath] = createDiff(
                original,
                updated,
                tsconfigPath,
              );
            }
          } else {
            await fs.writeText(tsconfigPath, `${updated}\n`);
          }
          result.filesModified++;
          projectModified = true;
          if (verbose) {
            logger.debug?.(`Updated tsconfig.json for ${projectId}`);
          }
        }

        if (projectModified) {
          result.projectsUpdated.push(projectId);
        }
      }

      if (Object.keys(result.staleDependencies).length > 0) {
        logger.warn(
          `Found stale dependencies in ${
            Object.keys(result.staleDependencies).length
          } project(s)`,
        );
      }

      if (result.filesModified === 0) {
        logger.info("All dependencies already in sync");
      } else {
        logger.info(
          `Planned updates touch ${result.filesModified} file(s) across ${result.projectsUpdated.length} project(s)`,
        );
      }

      return result;
    },
  };
}
