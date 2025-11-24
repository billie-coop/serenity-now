import { dirname, join, relative } from "node:path";
import type {
  ChangeEmitterPort,
  FileSystemPort,
  LoggerPort,
} from "../../core/ports.js";
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
} from "../../core/types.js";

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

  // Track which packages are workspace packages (either in inventory or declared with workspace:*)
  const workspacePackageNames = new Set<string>();

  for (const [dep, version] of Object.entries(allDeps)) {
    const isWorkspace =
      version?.includes("workspace:") || workspaceProjects.has(dep);
    if (isWorkspace) {
      workspacePackageNames.add(dep);
      if (!resolvedDeps.has(dep)) {
        stale.packageJsonDeps.push(dep);
      }
    }
  }

  if (currentTsconfig?.compilerOptions?.paths) {
    for (const key of Object.keys(currentTsconfig.compilerOptions.paths)) {
      const base = key.replace(/\/\*$/, "");
      // Check if this path is for a workspace package (from package.json or inventory)
      const isWorkspacePackage =
        workspacePackageNames.has(base) || workspaceProjects.has(base);
      if (isWorkspacePackage && !resolvedDeps.has(base)) {
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
      const relativePath = relative(tsconfigDir, dep.dependency.root).replace(
        /\\/g,
        "/",
      );
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
    updated.dependencies = sortedKeys.reduce(
      (acc, key) => {
        // biome-ignore lint/style/noNonNullAssertion: key comes from Object.keys(newDeps)
        acc[key] = newDeps[key]!;
        return acc;
      },
      {} as Record<string, string>,
    );
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
  const depRelative = relative(tsconfigDir, dep.dependency.root).replace(
    /\\/g,
    "/",
  );
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
  for (const [pathKey, targets] of Object.entries(
    currentTsconfig.compilerOptions?.paths || {},
  )) {
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
    groups.get(base)?.push(key);
  }
  for (const base of Array.from(groups.keys()).sort()) {
    // biome-ignore lint/style/noNonNullAssertion: base comes from groups.keys()
    const entries = groups.get(base)!;
    entries.sort((a, b) => {
      if (a === base) return -1;
      if (b === base) return 1;
      return a.localeCompare(b);
    });
    for (const key of entries) {
      // biome-ignore lint/style/noNonNullAssertion: key comes from entries which came from newPaths
      sortedPaths[key] = newPaths[key]!;
    }
  }

  const references = Object.values(project.dependencies)
    .map((dep) => {
      const tsconfigDir = dirname(
        project.project.tsconfigPath ??
          join(project.project.root, "tsconfig.json"),
      );
      return {
        path: relative(tsconfigDir, dep.dependency.root).replace(/\\/g, "/"),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  if (!updated.compilerOptions) updated.compilerOptions = {};
  updated.compilerOptions.paths =
    Object.keys(sortedPaths).length > 0 ? sortedPaths : undefined;
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
  if (!(await fs.fileExists(path))) return null;
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
    .filter(
      (name) => name in project.dependencies || name.includes("workspace:"),
    )
    .sort();
  const toAdd = imported.filter((dep) => !reported.includes(dep));
  const toRemove = reported.filter((dep) => !imported.includes(dep));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return;
  }

  logger.info(`\n📦 ${projectId}:`);
  logger.info(`  IMPORTED: ${imported.length ? imported.join(", ") : "NONE"}`);
  logger.info(`  REPORTED: ${reported.length ? reported.join(", ") : "NONE"}`);
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
        warnings: [],
      };

      logger.info("→ Analyzing changes needed...");

      for (const [projectId, project] of Object.entries(graph.projects)) {
        const packageJsonPath = join(project.project.root, "package.json");
        const tsconfigPath = project.project.tsconfigPath;

        const currentPackageJson = await readPackageJson(fs, packageJsonPath);
        if (!currentPackageJson) {
          result.warnings.push(`Failed to read package.json for ${projectId}`);
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
          logger.debug?.(
            `Stale dependencies in ${projectId}: ${JSON.stringify(
              stale,
              null,
              2,
            )}`,
          );
        }

        const { updated: updatedPackageJson, changed: packageJsonChanged } =
          updatePackageJson(project, currentPackageJson);

        const tsconfigResult = currentTsconfig
          ? updateTsConfig(project, currentTsconfig)
          : null;

        let projectModified = false;

        if (packageJsonChanged) {
          const updated = JSON.stringify(updatedPackageJson, null, 2);
          if (!dryRun) {
            await fs.writeText(packageJsonPath, `${updated}\n`);
          }
          result.filesModified++;
          projectModified = true;
          if (verbose) {
            logger.debug?.(`Updated package.json for ${projectId}`);
          }
        }

        if (tsconfigResult?.changed && tsconfigPath) {
          const updated = JSON.stringify(tsconfigResult.updated, null, 2);
          if (!dryRun) {
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

      const staleCount = Object.keys(result.staleDependencies).length;

      if (staleCount > 0 && verbose) {
        logger.info("\n⚠️  Stale Dependencies Detected:");
        for (const [projectId, stale] of Object.entries(
          result.staleDependencies,
        )) {
          logger.info(`\n  📦 ${projectId}:`);
          if (stale.packageJsonDeps.length > 0) {
            logger.info(
              `    package.json: ${stale.packageJsonDeps.join(", ")}`,
            );
          }
          if (stale.tsconfigPaths.length > 0) {
            logger.info(
              `    tsconfig paths: ${stale.tsconfigPaths.join(", ")}`,
            );
          }
          if (stale.tsconfigReferences.length > 0) {
            logger.info(
              `    tsconfig references: ${stale.tsconfigReferences.join(", ")}`,
            );
          }
        }
        logger.info("");
      }

      if (result.filesModified === 0 && staleCount === 0) {
        logger.info("✅ All dependencies are already in sync!");
      } else if (result.filesModified === 0 && staleCount > 0) {
        logger.warn(
          `⚠️  Found stale dependencies in ${staleCount} project(s), but no new dependencies to add`,
        );
      } else {
        logger.info(
          `📝 Planned updates touch ${result.filesModified} file(s) across ${result.projectsUpdated.length} project(s)`,
        );
      }

      return result;
    },
  };
}
