import { join, relative } from "node:path";
import ts from "typescript";
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
    const exportsValue = pkg.exports;
    let exportPath: string | undefined;

    if (typeof exportsValue === "string") {
      exportPath = exportsValue;
    } else if (typeof exportsValue === "object") {
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

/**
 * Scans exports from a TypeScript program using the TypeScript Compiler API.
 * This uses the TypeChecker to get accurate export information, including re-exports.
 */
async function scanExportsFromProgram(
  program: ts.Program,
  entryPointPath: string,
  projectRoot: string,
): Promise<ExportRecord[]> {
  const typeChecker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entryPointPath);

  if (!sourceFile) {
    return [];
  }

  const exports: ExportRecord[] = [];
  const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) {
    return [];
  }

  // Get all exports from the module
  const exportSymbols = typeChecker.getExportsOfModule(moduleSymbol);

  for (const exportSymbol of exportSymbols) {
    const exportName = exportSymbol.getName();

    // Determine if this is a type-only export
    const isTypeOnly =
      !!(
        exportSymbol.flags & ts.SymbolFlags.Type ||
        exportSymbol.flags & ts.SymbolFlags.Interface ||
        exportSymbol.flags & ts.SymbolFlags.TypeAlias ||
        exportSymbol.flags & ts.SymbolFlags.TypeParameter
      ) &&
      !(
        exportSymbol.flags & ts.SymbolFlags.Value ||
        exportSymbol.flags & ts.SymbolFlags.Variable ||
        exportSymbol.flags & ts.SymbolFlags.Function ||
        exportSymbol.flags & ts.SymbolFlags.Class
      );

    // Determine export type
    let exportType: "named" | "default" | "namespace" = "named";
    if (exportName === "default") {
      exportType = "default";
    } else if (exportSymbol.flags & ts.SymbolFlags.Namespace) {
      exportType = "namespace";
    }

    const relativeFile = relative(projectRoot, entryPointPath);

    exports.push({
      exportName,
      sourceFile: relativeFile,
      isTypeOnly,
      exportType,
    });
  }

  return exports;
}

/**
 * Scans a single project's exports using a shared TypeScript program.
 */
async function scanProjectExports(
  project: ProjectInfo,
  program: ts.Program,
  fs: FileSystemPort,
  warnings: string[],
): Promise<ExportRecord[]> {
  // Resolve the entry point for this project
  const entryPoint = await resolveEntryPoint(project, fs);

  if (!entryPoint.exists) {
    return [];
  }

  // Scan exports using the TypeChecker
  return await scanExportsFromProgram(program, entryPoint.path, project.root);
}

/**
 * Creates a single TypeScript program for the entire monorepo.
 */
function createMonorepoProgram(
  inventory: ProjectInventory,
  repoRoot: string,
): ts.Program | null {
  // Collect all tsconfig paths
  const tsconfigPaths: string[] = [];
  for (const project of Object.values(inventory.projects)) {
    if (project.tsconfigPath) {
      tsconfigPaths.push(project.tsconfigPath);
    }
  }

  if (tsconfigPaths.length === 0) {
    return null;
  }

  // Create a solution-style program that understands the entire monorepo
  // Use the root tsconfig or create a virtual one
  const rootTsconfig = join(repoRoot, "tsconfig.json");

  try {
    // Use TypeScript's project references feature if available
    const host = ts.createSolutionBuilderHost(
      ts.sys,
      undefined,
      undefined,
      undefined,
    );

    // Create a simple program with all source files from all projects
    const allSourceFiles: string[] = [];
    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      composite: true,
    };

    for (const project of Object.values(inventory.projects)) {
      if (project.tsconfigPath) {
        try {
          const tsconfigText = ts.sys.readFile(project.tsconfigPath);
          if (!tsconfigText) continue;

          const tsconfigJson = ts.parseConfigFileTextToJson(
            project.tsconfigPath,
            tsconfigText,
          );
          if (tsconfigJson.error) continue;

          const parsedConfig = ts.parseJsonConfigFileContent(
            tsconfigJson.config,
            ts.sys,
            project.root,
            undefined,
            project.tsconfigPath,
          );

          allSourceFiles.push(...parsedConfig.fileNames);
        } catch {
          // Skip projects with config errors
        }
      }
    }

    if (allSourceFiles.length === 0) {
      return null;
    }

    // Create a single program with all source files
    return ts.createProgram({
      rootNames: allSourceFiles,
      options: compilerOptions,
    });
  } catch {
    return null;
  }
}

/**
 * Creates a TypeScript AST-based export scanner (hexagonal architecture adapter).
 */
export function createTypeScriptExportScanner(): ExportScannerPort {
  return {
    async scan(
      inventory: ProjectInventory,
      _config: SyncConfig,
      options: RepoManagerOptions,
      logger: LoggerPort,
      fs: FileSystemPort,
    ): Promise<ExportAnalysis> {
      const projects: Record<string, ProjectExports> = {};
      const warnings: string[] = [];

      // Create a single TypeScript program for the entire monorepo
      const program = createMonorepoProgram(inventory, options.rootDir);

      if (!program) {
        warnings.push(
          "Failed to create TypeScript program - no valid tsconfig.json files found",
        );
        return { projects, warnings };
      }

      for (const [projectId, project] of Object.entries(inventory.projects)) {
        const exports = await scanProjectExports(
          project,
          program,
          fs,
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
