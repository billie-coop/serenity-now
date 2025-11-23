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

// No hard-coded defaults - users must explicitly configure excludePatterns
// See config template for suggested patterns

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

/**
 * Strips comments from source code while respecting strings and template literals.
 * This prevents false positives from commented-out imports.
 */
function stripComments(source: string): string {
  let result = "";
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    // Skip single-line comments
    if (char === "/" && next === "/") {
      // Skip until end of line
      while (i < source.length && source[i] !== "\n") {
        i++;
      }
      if (i < source.length) {
        result += "\n"; // Preserve line structure
        i++;
      }
      continue;
    }

    // Skip multi-line comments
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length - 1) {
        if (source[i] === "\n") {
          result += "\n"; // Preserve lines
        }
        if (source[i] === "*" && source[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Preserve strings (single quote)
    if (char === "'") {
      result += char;
      i++;
      while (i < source.length) {
        result += source[i];
        if (source[i] === "\\") {
          i++;
          if (i < source.length) result += source[i];
        } else if (source[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Preserve strings (double quote)
    if (char === '"') {
      result += char;
      i++;
      while (i < source.length) {
        result += source[i];
        if (source[i] === "\\") {
          i++;
          if (i < source.length) result += source[i];
        } else if (source[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Preserve template literals
    if (char === "`") {
      result += char;
      i++;
      while (i < source.length) {
        result += source[i];
        if (source[i] === "\\") {
          i++;
          if (i < source.length) result += source[i];
        } else if (source[i] === "`") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

function parseSpecifiers(source: string, _filePath: string): SpecifierMatch[] {
  // Strip comments first to avoid false positives
  const cleanedSource = stripComments(source);
  const results: SpecifierMatch[] = [];

  const scanWith = (
    regex: RegExp,
    inferType: (match: string) => boolean,
  ) => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(cleanedSource)) !== null) {
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
  // Use globToRegExp for consistent pattern matching with proper directory boundaries
  const regex = globToRegExp(pattern, { extended: true, globstar: true });
  return regex.test(value);
}

// Default patterns to exclude from scanning
const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.output/**",
  "**/.vercel/**",
  "**/.netlify/**",
];

function shouldExcludeFile(relativePath: string, config: SyncConfig): boolean {
  // Combine default excludes with user-configured patterns
  const excludePatterns = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...(config.excludePatterns || []),
  ];

  // Normalize path separators to forward slashes for consistent matching across platforms
  const normalizedPath = relativePath.replace(/\\/g, "/");

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
      const specifiers = parseSpecifiers(content, entry.path);
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

      const totalImports = Object.values(usage.usage).reduce(
        (sum, record) =>
          sum + record.dependencies.length + record.typeOnlyDependencies.length,
        0,
      );
      const projectsWithImports = Object.values(usage.usage).filter(
        (record) =>
          record.dependencies.length > 0 ||
          record.typeOnlyDependencies.length > 0,
      ).length;

      logger.info(
        `✅ Scanned ${
          Object.keys(inventory.projects).length
        } projects, found ${totalImports} workspace imports across ${projectsWithImports} projects`,
      );
      return usage;
    },
  };
}
