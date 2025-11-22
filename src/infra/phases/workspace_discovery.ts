import { join, relative } from "@std/path";
import { expandGlob } from "@std/fs/expand-glob";
import type {
  FileSystemPort,
  LoggerPort,
  WorkspaceDiscoveryPort,
} from "../../core/ports.ts";
import type {
  PackageJson,
  ProjectInfo,
  ProjectInventory,
  RepoManagerOptions,
  SyncConfig,
  WorkspaceTypeConfig,
} from "../../core/types.ts";
import { assert } from "../../core/utils/assert.ts";

interface GlobEntry {
  path: string;
  name: string;
  isFile: boolean;
}

type Globber = (pattern: string) => AsyncIterable<GlobEntry>;

async function* defaultGlobber(pattern: string): AsyncIterable<GlobEntry> {
  for await (const entry of expandGlob(pattern)) {
    yield {
      path: entry.path,
      name: entry.name,
      isFile: entry.isFile,
    };
  }
}

function normalizeWorkspacePatterns(
  workspaces: PackageJson["workspaces"],
): string[] {
  if (!workspaces) {
    return [];
  }
  if (Array.isArray(workspaces)) {
    return workspaces.filter((pattern) => !pattern.startsWith("!"));
  }
  if (Array.isArray(workspaces.packages)) {
    return workspaces.packages.filter((pattern) => !pattern.startsWith("!"));
  }
  return [];
}

function matchWorkspaceConfig(
  projectRelativePath: string,
  workspaceTypes: SyncConfig["workspaceTypes"],
): WorkspaceTypeConfig | undefined {
  if (!workspaceTypes) {
    return undefined;
  }

  for (const [pattern, config] of Object.entries(workspaceTypes)) {
    const regex = new RegExp(`^${pattern.replaceAll("*", "[^/]+")}$`);
    if (regex.test(projectRelativePath)) {
      return config;
    }
  }
  return undefined;
}

function validateNamePrefix(
  packageName: string,
  relativeRoot: string,
  workspaceConfig?: WorkspaceTypeConfig,
): string[] {
  const warnings: string[] = [];
  if (!workspaceConfig?.enforceNamePrefix) {
    return warnings;
  }
  const prefix = workspaceConfig.enforceNamePrefix;
  if (prefix && !packageName.startsWith(prefix)) {
    warnings.push(
      `Package ${packageName} at ${relativeRoot} should start with "${prefix}" based on workspace configuration`,
    );
  }
  return warnings;
}

async function readJsonSafe<T>(
  fs: FileSystemPort,
  path: string,
  defaultValue: T,
): Promise<T> {
  try {
    return await fs.readJson<T>(path);
  } catch {
    return defaultValue;
  }
}

export function createWorkspaceDiscovery(
  globber: Globber = defaultGlobber,
): WorkspaceDiscoveryPort {
  return {
    async discover(
      config: SyncConfig,
      options: RepoManagerOptions,
      logger: LoggerPort,
      fs: FileSystemPort,
    ): Promise<ProjectInventory> {
      const rootDir = options.rootDir;
      const rootPackageJsonPath = join(rootDir, "package.json");
      if (!await fs.fileExists(rootPackageJsonPath)) {
        throw new Error("No package.json found in repo root");
      }

      const rootPackageJson = await readJsonSafe<PackageJson>(
        fs,
        rootPackageJsonPath,
        {},
      );

      const patterns = normalizeWorkspacePatterns(rootPackageJson.workspaces);
      if (patterns.length === 0) {
        logger.warn("No workspaces configured in package.json");
        return { projects: {}, warnings: [], workspaceConfigs: {} };
      }

      const projects: Record<string, ProjectInfo> = {};
      const warnings: string[] = [];
      const workspaceConfigs: Record<string, WorkspaceTypeConfig> = {};

      for (const pattern of patterns) {
        const searchPattern = pattern.includes("*") ? pattern : `${pattern}/*`;
        const globPattern = join(rootDir, searchPattern, "package.json");

        for await (const entry of globber(globPattern)) {
          if (!entry.isFile || entry.name !== "package.json") {
            continue;
          }
          const projectRoot = entry.path.replace(/\/package\.json$/, "");
          const relativeRoot = relative(rootDir, projectRoot);
          if (relativeRoot.startsWith("..")) {
            continue;
          }

          const packageJson = await readJsonSafe<PackageJson>(
            fs,
            entry.path,
            {},
          );
          const packageName = packageJson.name;
          if (!packageName) {
            warnings.push(
              `Skipping project at ${relativeRoot} with missing package name`,
            );
            continue;
          }

          const tsconfigPath = join(projectRoot, "tsconfig.json");
          const hasTsconfig = await fs.fileExists(tsconfigPath);
          if (!hasTsconfig) {
            warnings.push(
              `Project ${packageName} at ${relativeRoot} is missing tsconfig.json`,
            );
          }

          const workspaceConfig = matchWorkspaceConfig(
            relativeRoot,
            config.workspaceTypes,
          );
          if (!workspaceConfig) {
            warnings.push(
              `Project ${packageName} at ${relativeRoot} does not match any configured workspace type patterns`,
            );
            continue;
          }
          workspaceConfigs[relativeRoot] = workspaceConfig;

          warnings.push(
            ...validateNamePrefix(packageName, relativeRoot, workspaceConfig),
          );

          const workspaceType = workspaceConfig.type ?? "unknown";
          assert(
            workspaceType === "app" ||
              workspaceType === "shared-package" ||
              workspaceType === "unknown",
            () =>
              new Error(
                `Invalid workspace type for ${packageName}: ${workspaceType}`,
              ),
          );

          projects[packageName] = {
            id: packageName,
            root: projectRoot,
            relativeRoot,
            packageJson,
            tsconfigPath: hasTsconfig ? tsconfigPath : undefined,
            workspaceType: workspaceType,
            workspaceSubType: workspaceConfig.subType ?? "unknown",
            workspaceConfig,
            isPrivate: packageJson.private ?? false,
          };
        }
      }

      logger.info(
        `Discovered ${Object.keys(projects).length} workspace projects`,
      );
      return { projects, warnings, workspaceConfigs };
    },
  };
}
