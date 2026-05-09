import { relative } from "node:path";
import ts from "typescript";
import type {
	FileSystemPort,
	ImportScannerPort,
	LoggerPort,
} from "../../core/ports.js";
import type {
	ProjectInfo,
	ProjectInventory,
	ProjectUsage,
	ProjectUsageRecord,
	RepoManagerOptions,
	SyncConfig,
} from "../../core/types.js";
import { globToRegExp } from "../utils/glob.js";

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

/**
 * Checks if a file should be excluded from scanning based on exclude patterns.
 */
function shouldExcludeFile(relativePath: string, config: SyncConfig): boolean {
	const excludePatterns = [
		...DEFAULT_EXCLUDE_PATTERNS,
		...(config.excludePatterns || []),
	];

	const normalizedPath = relativePath.replace(/\\/g, "/");

	return excludePatterns.some((pattern) => {
		const regex = globToRegExp(pattern);
		return regex.test(normalizedPath);
	});
}

/**
 * Checks if an import specifier should be ignored based on config.
 */
function shouldIgnore(specifier: string, config: SyncConfig): boolean {
	return Boolean(
		config.ignoreImports?.some((pattern) => {
			const regex = globToRegExp(pattern);
			return regex.test(specifier);
		}),
	);
}

/**
 * Checks if a specifier is an external dependency (not a relative import).
 */
function isExternal(specifier: string): boolean {
	return !specifier.startsWith(".") && !specifier.startsWith("/");
}

/**
 * Ensures a project usage record exists in the usage map.
 */
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

/**
 * Tracks a dependency in the project usage record.
 */
function trackDependency(
	record: ProjectUsageRecord,
	specifier: string,
	sourceFile: string,
	isTypeOnly: boolean,
	namedImports?: string[],
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
		namedImports,
	});
}

/**
 * Adds default dependencies to a project usage record.
 */
function addDefaults(record: ProjectUsageRecord, defaults?: string[]): void {
	if (!defaults) return;
	for (const dep of defaults) {
		if (!record.dependencies.includes(dep)) {
			record.dependencies.push(dep);
		}
	}
}

/**
 * Extracts named imports from an import clause.
 */
function extractNamedImports(
	importClause: ts.ImportClause | undefined,
): string[] | undefined {
	if (!importClause) return undefined;

	const named: string[] = [];

	// Check for default import
	if (importClause.name) {
		named.push("default");
	}

	// Check for named bindings
	if (importClause.namedBindings) {
		if (ts.isNamedImports(importClause.namedBindings)) {
			// Named imports: import { foo, bar }
			for (const element of importClause.namedBindings.elements) {
				const importedName = element.propertyName
					? element.propertyName.text
					: element.name.text;
				named.push(importedName);
			}
		} else if (ts.isNamespaceImport(importClause.namedBindings)) {
			// Namespace import: import * as ns
			named.push("*");
		}
	}

	return named.length > 0 ? named : undefined;
}

/**
 * Extracts named exports from an export clause (for re-exports).
 */
function extractNamedExports(
	exportClause: ts.NamedExports | ts.NamespaceExport | undefined,
): string[] | undefined {
	if (!exportClause) return ["*"]; // export * from

	if (ts.isNamespaceExport(exportClause)) {
		// export * as ns from
		return ["*"];
	}

	if (ts.isNamedExports(exportClause)) {
		// export { foo, bar } from
		const named: string[] = [];
		for (const element of exportClause.elements) {
			const exportedName = element.propertyName
				? element.propertyName.text
				: element.name.text;
			named.push(exportedName);
		}
		return named.length > 0 ? named : undefined;
	}

	return undefined;
}

/**
 * Processes a single source file to extract imports.
 */
function processSourceFile(
	sourceFile: ts.SourceFile,
	projectRoot: string,
	config: SyncConfig,
	usage: ProjectUsage,
	projectId: string,
): void {
	const record = ensureRecord(usage, projectId);
	const relativeFile = relative(projectRoot, sourceFile.fileName);

	// Check if file should be excluded
	if (shouldExcludeFile(relativeFile, config)) {
		return;
	}

	// Traverse the AST
	function visit(node: ts.Node): void {
		// Handle import declarations: import { foo } from 'pkg'
		if (ts.isImportDeclaration(node)) {
			const moduleSpecifier = node.moduleSpecifier;
			if (ts.isStringLiteral(moduleSpecifier)) {
				const specifier = moduleSpecifier.text;

				if (!isExternal(specifier) || shouldIgnore(specifier, config)) {
					return;
				}

				// Check if it's a type-only import
				const isTypeOnly = node.importClause?.isTypeOnly ?? false;

				// Extract named imports
				const namedImports = extractNamedImports(node.importClause);

				trackDependency(
					record,
					specifier,
					relativeFile,
					isTypeOnly,
					namedImports,
				);
			}
		}

		// Handle export declarations (re-exports): export { foo } from 'pkg'
		if (ts.isExportDeclaration(node)) {
			const moduleSpecifier = node.moduleSpecifier;
			if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
				const specifier = moduleSpecifier.text;

				if (!isExternal(specifier) || shouldIgnore(specifier, config)) {
					return;
				}

				// Check if it's a type-only export
				const isTypeOnly = node.isTypeOnly ?? false;

				// Extract named exports
				const namedImports = extractNamedExports(node.exportClause);

				trackDependency(
					record,
					specifier,
					relativeFile,
					isTypeOnly,
					namedImports,
				);
			}
		}

		// Continue traversing
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
}

/**
 * Scans imports from a single project using a shared TypeScript program.
 */
function scanProjectImports(
	project: ProjectInfo,
	program: ts.Program,
	config: SyncConfig,
	usage: ProjectUsage,
): void {
	const srcDir = `${project.root}/src`;

	// Process all source files in this project
	for (const sourceFile of program.getSourceFiles()) {
		// Skip declaration files and external files
		if (sourceFile.isDeclarationFile) continue;
		if (!sourceFile.fileName.startsWith(project.root)) continue;

		// Skip node_modules and dist/build directories
		if (sourceFile.fileName.includes("node_modules")) continue;
		if (sourceFile.fileName.includes("/dist/")) continue;
		if (sourceFile.fileName.includes("/build/")) continue;

		// CRITICAL: Only scan files in the project's src directory
		// This prevents scanning shared type files (like monorepo-root/types/*.d.ts)
		// that may import from this package, creating false circular dependencies
		if (!sourceFile.fileName.startsWith(srcDir)) continue;

		processSourceFile(sourceFile, project.root, config, usage, project.id);
	}

	// Add default dependencies
	const record = ensureRecord(usage, project.id);
	addDefaults(record, config.defaultDependencies);
}

/**
 * Creates a single TypeScript program for the entire monorepo.
 */
function createMonorepoProgram(inventory: ProjectInventory): ts.Program | null {
	try {
		// Collect all source files from all projects
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
 * Creates a TypeScript AST-based import scanner (hexagonal architecture adapter).
 */
export function createTypeScriptImportScanner(): ImportScannerPort {
	return {
		async scan(
			inventory: ProjectInventory,
			config: SyncConfig,
			_options: RepoManagerOptions,
			logger: LoggerPort,
			_fs: FileSystemPort,
		): Promise<ProjectUsage> {
			const usage: ProjectUsage = { usage: {}, warnings: [] };
			const warnings: string[] = [];

			// Create a single TypeScript program for the entire monorepo
			const program = createMonorepoProgram(inventory);

			if (!program) {
				warnings.push(
					"Failed to create TypeScript program - no valid tsconfig.json files found",
				);
				usage.warnings = warnings;
				return usage;
			}

			for (const [_projectId, project] of Object.entries(inventory.projects)) {
				scanProjectImports(project, program, config, usage);
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
