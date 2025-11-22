import { relative } from "@std/path";
import { walk } from "@std/fs/walk";
import { globToRegExp } from "@std/path/glob-to-regexp";
import type {
  FileSystemPort,
  ImportScannerPort,
  LoggerPort,
} from "../../core/ports.ts";
import type {
  ProjectInventory,
  ProjectUsage,
  ProjectUsageRecord,
  RepoManagerOptions,
  SyncConfig,
} from "../../core/types.ts";

type FileEntry = { path: string; isFile: boolean };
type FileWalker = (root: string) => AsyncIterable<FileEntry>;

interface ImportScannerDeps {
  walker?: FileWalker;
  readFile?: (path: string, fs: FileSystemPort) => Promise<string>;
}

const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
];

const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/.moon/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
];

function createDefaultWalker(): FileWalker {
  return async function* (root: string) {
    for await (
      const entry of walk(root, {
        includeDirs: false,
        includeFiles: true,
        followSymlinks: false,
      })
    ) {
      yield { path: entry.path, isFile: entry.isFile };
    }
  };
}

const IMPORT_REGEX = /(import\s+(type\s+)?[^"'`]*?from\s*["'`]([^"'`]+)["'`])/g;
const EXPORT_FROM_REGEX = /(export\s+[^"'`]*?from\s*["'`]([^"'`]+)["'`])/g;
const DYNAMIC_IMPORT_REGEX = /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const REQUIRE_REGEX = /require\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

interface SpecifierMatch {
  specifier: string;
  isTypeOnly: boolean;
}

function parseSpecifiers(source: string): SpecifierMatch[] {
  const results: SpecifierMatch[] = [];

  const scanWith = (
    regex: RegExp,
    inferType: (match: string) => boolean,
  ) => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      const full = match[0] ?? "";
      const specifier = match[match.length - 1] ?? "";
      if (!specifier) continue;
      results.push({
        specifier,
        isTypeOnly: inferType(full),
      });
    }
  };

  scanWith(
    IMPORT_REGEX,
    (full) => full.startsWith("import type") || full.includes("import type"),
  );
  scanWith(EXPORT_FROM_REGEX, () => false);
  scanWith(DYNAMIC_IMPORT_REGEX, () => false);
  scanWith(REQUIRE_REGEX, () => false);

  return results;
}

function isExternal(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function shouldProcessFile(path: string): boolean {
  return DEFAULT_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
    return regex.test(value);
  }
  return value === pattern || value.startsWith(`${pattern}/`);
}

function shouldExcludeFile(relativePath: string, config: SyncConfig): boolean {
  // Normalize path separators to forward slashes for consistent matching across platforms
  const normalizedPath = relativePath.replace(/\\/g, "/");

  const excludePatterns = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...(config.excludePatterns ?? []),
  ];

  return excludePatterns.some((pattern) => {
    // Use Deno's standard library for proper glob-to-regex conversion
    // This correctly handles directory boundaries and doesn't match substrings
    const regex = globToRegExp(pattern, { extended: true, globstar: true });
    return regex.test(normalizedPath);
  });
}

function shouldIgnore(specifier: string, config: SyncConfig): boolean {
  return Boolean(
    config.ignoreImports?.some((pattern) => matchesPattern(specifier, pattern)),
  );
}

function ensureRecord(
  usage: ProjectUsage,
  projectId: string,
): ProjectUsageRecord {
  if (!usage.usage[projectId]) {
    usage.usage[projectId] = {
      dependencies: [],
      typeOnlyDependencies: [],
      usageDetails: [],
    };
  }
  return usage.usage[projectId];
}

function trackDependency(
  record: ProjectUsageRecord,
  specifier: string,
  sourceFile: string,
  isTypeOnly: boolean,
): void {
  const bucket = isTypeOnly ? record.typeOnlyDependencies : record.dependencies;
  if (!bucket.includes(specifier)) {
    bucket.push(specifier);
  }
  record.usageDetails.push({
    dependencyId: specifier,
    specifier,
    isTypeOnly,
    sourceFile,
  });
}

function addDefaults(record: ProjectUsageRecord, defaults?: string[]) {
  if (!defaults) return;
  for (const dep of defaults) {
    if (!record.dependencies.includes(dep)) {
      record.dependencies.push(dep);
    }
  }
}

async function scanProjectFiles(
  projectId: string,
  projectRoot: string,
  walker: FileWalker,
  fs: FileSystemPort,
  readFile: (path: string, fs: FileSystemPort) => Promise<string>,
  config: SyncConfig,
  usage: ProjectUsage,
  warnings: string[],
): Promise<void> {
  const record = ensureRecord(usage, projectId);
  for await (const entry of walker(projectRoot)) {
    if (!entry.isFile) continue;
    if (!shouldProcessFile(entry.path)) continue;

    const relativeFile = relative(projectRoot, entry.path);
    if (shouldExcludeFile(relativeFile, config)) continue;

    try {
      const content = await readFile(entry.path, fs);
      const specifiers = parseSpecifiers(content);
      for (const { specifier, isTypeOnly } of specifiers) {
        if (!isExternal(specifier) || shouldIgnore(specifier, config)) {
          continue;
        }
        trackDependency(record, specifier, relativeFile, isTypeOnly);
      }
    } catch (error) {
      warnings.push(
        `Failed to read ${entry.path} in ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  addDefaults(record, config.defaultDependencies);
}

export function createImportScanner(
  deps: ImportScannerDeps = {},
): ImportScannerPort {
  const walker = deps.walker ?? createDefaultWalker();
  const readFile = deps.readFile ??
    (async (path: string, fs: FileSystemPort): Promise<string> => {
      return await fs.readText(path);
    });

  return {
    async scan(
      inventory: ProjectInventory,
      config: SyncConfig,
      _options: RepoManagerOptions,
      logger: LoggerPort,
      fs: FileSystemPort,
    ): Promise<ProjectUsage> {
      const usage: ProjectUsage = { usage: {}, warnings: [] };
      const warnings: string[] = [];

      for (
        const [projectId, project] of Object.entries(
          inventory.projects,
        )
      ) {
        await scanProjectFiles(
          projectId,
          project.root,
          walker,
          fs,
          readFile,
          config,
          usage,
          warnings,
        );
      }

      usage.warnings = warnings;
      logger.info(
        `Scanned imports for ${
          Object.keys(inventory.projects).length
        } project(s)`,
      );
      return usage;
    },
  };
}
