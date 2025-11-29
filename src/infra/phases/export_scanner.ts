import { join, relative } from "node:path";
import fg from "fast-glob";
import type {
  FileSystemPort,
  ExportScannerPort,
  LoggerPort,
} from "../../core/ports.js";
import type {
  ProjectInventory,
  ExportAnalysis,
  ExportRecord,
  ProjectExports,
  RepoManagerOptions,
  SyncConfig,
  ProjectInfo,
  EntryPointInfo,
} from "../../core/types.js";
import { globToRegExp } from "../utils/glob.js";

type FileEntry = { path: string; isFile: boolean };
type FileWalker = (root: string) => AsyncIterable<FileEntry>;

interface ExportScannerDeps {
  walker?: FileWalker;
  readFile?: (path: string, fs: FileSystemPort) => Promise<string>;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];

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

function createDefaultWalker(): FileWalker {
  return async function* (root: string) {
    const entries = await fg("**/*", {
      cwd: root,
      onlyFiles: true,
      followSymbolicLinks: false,
      absolute: true,
    });

    for (const path of entries) {
      yield { path, isFile: true };
    }
  };
}

// Regex patterns for detecting exports
const NAMED_EXPORT_REGEX =
  /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
const EXPORT_LIST_REGEX = /export\s*\{\s*([^}]+)\s*\}/g;
const EXPORT_DEFAULT_REGEX = /export\s+default\s+/g;
const EXPORT_NAMESPACE_REGEX = /export\s*\*\s+as\s+(\w+)\s+from/g;
const EXPORT_TYPE_REGEX = /export\s+type\s+/g;

interface ExportMatch {
  exportName: string;
  isTypeOnly: boolean;
  exportType: "named" | "default" | "namespace";
}

/**
 * Strips comments from source code while respecting strings and template literals.
 * This prevents false positives from commented-out exports.
 */
function stripComments(source: string): string {
  let result = "";
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    // Skip single-line comments
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        i++;
      }
      if (i < source.length) {
        result += "\n";
        i++;
      }
      continue;
    }

    // Skip multi-line comments
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length - 1) {
        if (source[i] === "\n") {
          result += "\n";
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

/**
 * Parses export statements from source code and returns export information.
 */
function parseExports(source: string, _filePath: string): ExportMatch[] {
  const cleanedSource = stripComments(source);
  const results: ExportMatch[] = [];

  // Check for type-only exports
  const hasTypeKeyword = (text: string): boolean => {
    return EXPORT_TYPE_REGEX.test(text);
  };

  // Scan for named exports: export const foo = ...
  NAMED_EXPORT_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex pattern matching idiom
  while ((match = NAMED_EXPORT_REGEX.exec(cleanedSource)) !== null) {
    const exportName = match[1];
    if (exportName) {
      const isTypeOnly = hasTypeKeyword(match[0] ?? "");
      results.push({
        exportName,
        isTypeOnly,
        exportType: "named",
      });
    }
  }

  // Scan for export lists: export { foo, bar }
  EXPORT_LIST_REGEX.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex pattern matching idiom
  while ((match = EXPORT_LIST_REGEX.exec(cleanedSource)) !== null) {
    const listContent = match[1];
    if (listContent) {
      // Check if this is a type-only export
      const fullMatch = match[0] ?? "";
      const isTypeOnly = hasTypeKeyword(fullMatch);

      // Split by comma and extract names (handle "foo as bar" syntax)
      const names = listContent.split(",").map((item) => {
        const parts = item.trim().split(/\s+as\s+/);
        // If there's an "as" clause, use the alias, otherwise use the original name
        return parts.length > 1 ? parts[1]?.trim() : parts[0]?.trim();
      });

      for (const name of names) {
        if (name) {
          results.push({
            exportName: name,
            isTypeOnly,
            exportType: "named",
          });
        }
      }
    }
  }

  // Scan for default exports
  EXPORT_DEFAULT_REGEX.lastIndex = 0;
  if (EXPORT_DEFAULT_REGEX.test(cleanedSource)) {
    results.push({
      exportName: "default",
      isTypeOnly: false,
      exportType: "default",
    });
  }

  // Scan for namespace exports: export * as foo from "..."
  EXPORT_NAMESPACE_REGEX.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex pattern matching idiom
  while ((match = EXPORT_NAMESPACE_REGEX.exec(cleanedSource)) !== null) {
    const namespaceName = match[1];
    if (namespaceName) {
      results.push({
        exportName: namespaceName,
        isTypeOnly: false,
        exportType: "namespace",
      });
    }
  }

  return results;
}

/**
 * Resolves the entry point file for a project by checking package.json fields.
 * This determines the public API of the package.
 */
async function resolveEntryPoint(
  project: ProjectInfo,
  fs: FileSystemPort,
): Promise<EntryPointInfo> {
  const pkg = project.packageJson;

  // Check src/index.ts first (common convention)
  const srcIndex = join(project.root, "src", "index.ts");
  if (await fs.fileExists(srcIndex)) {
    return { path: srcIndex, exists: true, isTypeDefinition: false };
  }

  // Check package.json types/typings field
  if (pkg.types || pkg.typings) {
    const typesPath = join(project.root, pkg.types || pkg.typings || "");
    if (await fs.fileExists(typesPath)) {
      return { path: typesPath, exists: true, isTypeDefinition: true };
    }
  }

  // Check package.json exports field
  if (pkg.exports) {
    // Handle both string and object exports
    const exportsValue = pkg.exports;
    let exportPath: string | undefined;

    if (typeof exportsValue === "string") {
      exportPath = exportsValue;
    } else if (typeof exportsValue === "object") {
      // Try common keys
      exportPath =
        exportsValue["."]?.import ||
        exportsValue["."]?.require ||
        exportsValue["."]?.default ||
        exportsValue.import ||
        exportsValue.default;
    }

    if (exportPath) {
      const fullPath = join(project.root, exportPath);
      if (await fs.fileExists(fullPath)) {
        return { path: fullPath, exists: true, isTypeDefinition: false };
      }
    }
  }

  // Check package.json main/module field
  if (pkg.main || pkg.module) {
    const mainPath = join(project.root, pkg.main || pkg.module || "");
    if (await fs.fileExists(mainPath)) {
      return { path: mainPath, exists: true, isTypeDefinition: false };
    }
  }

  // Fallback: return src/index.ts even if it doesn't exist
  return { path: srcIndex, exists: false, isTypeDefinition: false };
}

async function scanProjectExports(
  project: ProjectInfo,
  fs: FileSystemPort,
  readFile: (path: string, fs: FileSystemPort) => Promise<string>,
  warnings: string[],
): Promise<ExportRecord[]> {
  const exports: ExportRecord[] = [];

  // Resolve the entry point for this project
  const entryPoint = await resolveEntryPoint(project, fs);

  // Only scan if the entry point exists
  if (!entryPoint.exists) {
    // Don't warn - many projects might not have entry points (apps, etc.)
    return exports;
  }

  // Only scan the entry point file
  try {
    const content = await readFile(entryPoint.path, fs);
    const exportMatches = parseExports(content, entryPoint.path);
    const relativeFile = relative(project.root, entryPoint.path);

    for (const { exportName, isTypeOnly, exportType } of exportMatches) {
      exports.push({
        exportName,
        sourceFile: relativeFile,
        isTypeOnly,
        exportType,
      });
    }
  } catch (error) {
    warnings.push(
      `Failed to read entry point ${entryPoint.path} in ${project.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return exports;
}

export function createExportScanner(
  deps: ExportScannerDeps = {},
): ExportScannerPort {
  const readFile =
    deps.readFile ??
    (async (path: string, fs: FileSystemPort): Promise<string> => {
      return await fs.readText(path);
    });

  return {
    async scan(
      inventory: ProjectInventory,
      _config: SyncConfig,
      _options: RepoManagerOptions,
      logger: LoggerPort,
      fs: FileSystemPort,
    ): Promise<ExportAnalysis> {
      const projects: Record<string, ProjectExports> = {};
      const warnings: string[] = [];

      for (const [projectId, project] of Object.entries(inventory.projects)) {
        const exports = await scanProjectExports(
          project,
          fs,
          readFile,
          warnings,
        );

        projects[projectId] = {
          projectId,
          exports,
        };
      }

      const totalExports = Object.values(projects).reduce(
        (sum, proj) => sum + proj.exports.length,
        0,
      );

      const projectsScanned = Object.keys(inventory.projects).length;
      const projectsWithExports = Object.values(projects).filter(
        (proj) => proj.exports.length > 0,
      ).length;

      logger.info(
        `✅ Scanned ${projectsScanned} projects: ${projectsWithExports} have exports (${totalExports} total)`,
      );

      return {
        projects,
        warnings,
      };
    },
  };
}
