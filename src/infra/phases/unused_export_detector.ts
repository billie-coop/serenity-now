import type { LoggerPort, UnusedExportDetectorPort } from "../../core/ports.js";
import type {
	ExportAnalysis,
	ExportRecord,
	ProjectInventory,
	ProjectUsage,
	RepoManagerOptions,
	SyncConfig,
	UnusedExport,
	UnusedExportsReport,
} from "../../core/types.js";

/**
 * Extracts the package name from an import specifier.
 * Examples:
 *   "@scope/package" → "@scope/package"
 *   "@scope/package/subpath" → "@scope/package"
 *   "package" → "package"
 *   "package/subpath" → "package"
 */
function extractPackageName(specifier: string): string {
	if (specifier.startsWith("@")) {
		// Scoped package: @scope/package or @scope/package/subpath
		const parts = specifier.split("/");
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
	}
	// Regular package: package or package/subpath
	const parts = specifier.split("/");
	return parts[0] ?? specifier;
}

/**
 * Builds a map of which exports are imported by any project (including the same project).
 * Returns: Map of projectId → Set of imported export names
 */
function buildImportedExportsMap(
	usage: ProjectUsage,
	inventory: ProjectInventory,
): Map<string, Set<string>> {
	const importedExports = new Map<string, Set<string>>();

	// Initialize sets for all projects
	for (const projectId of Object.keys(inventory.projects)) {
		importedExports.set(projectId, new Set());
	}

	// Scan all usage records to find which exports are imported
	for (const [_importingProjectId, projectUsage] of Object.entries(
		usage.usage,
	)) {
		for (const usageDetail of projectUsage.usageDetails) {
			const packageName = extractPackageName(usageDetail.specifier);

			// Find the project that matches this package name
			const targetProject = Object.values(inventory.projects).find(
				(p) => p.packageJson.name === packageName,
			);

			if (!targetProject) {
				// Not a workspace package, skip
				continue;
			}

			const importedSet = importedExports.get(targetProject.id);
			if (!importedSet) continue;

			// Track internal usage: if a project imports from itself, mark those exports as used
			// This handles the case where a package exports something from its entry point
			// and also uses it internally

			// If we have named imports, track those specific symbols
			if (usageDetail.namedImports && usageDetail.namedImports.length > 0) {
				for (const namedImport of usageDetail.namedImports) {
					importedSet.add(namedImport);
				}
			} else {
				// No named imports tracked - assume the package is used generically
				// (could be require(), dynamic import, or we just don't have the data)
				// Mark with a special symbol to indicate "used but we don't know which exports"
				importedSet.add("__PACKAGE_IMPORTED__");
			}
		}
	}

	return importedExports;
}

/**
 * Determines if an export is unused based on the imported exports map.
 */
function isExportUnused(
	projectId: string,
	exportRecord: ExportRecord,
	importedExports: Map<string, Set<string>>,
): boolean {
	const importedSet = importedExports.get(projectId);
	if (!importedSet) return true;

	// If the package is imported generically, we can't determine if specific exports are unused
	if (importedSet.has("__PACKAGE_IMPORTED__")) {
		return false;
	}

	// Check if this specific export is imported
	if (importedSet.has(exportRecord.exportName)) {
		return false;
	}

	// Check for namespace imports (* as foo)
	if (importedSet.has("*")) {
		return false;
	}

	// Not imported anywhere
	return true;
}

export function createUnusedExportDetector(): UnusedExportDetectorPort {
	return {
		async detect(
			exports: ExportAnalysis,
			usage: ProjectUsage,
			inventory: ProjectInventory,
			_config: SyncConfig,
			_options: RepoManagerOptions,
			logger: LoggerPort,
		): Promise<UnusedExportsReport> {
			const unusedExports: UnusedExport[] = [];

			// Build a map of which exports are actually imported
			const importedExports = buildImportedExportsMap(usage, inventory);

			// Check each export to see if it's used
			for (const [projectId, projectExports] of Object.entries(
				exports.projects,
			)) {
				for (const exportRecord of projectExports.exports) {
					if (isExportUnused(projectId, exportRecord, importedExports)) {
						unusedExports.push({
							projectId,
							exportName: exportRecord.exportName,
							sourceFile: exportRecord.sourceFile,
							isTypeOnly: exportRecord.isTypeOnly,
							exportType: exportRecord.exportType,
							isReExport: exportRecord.isReExport,
						});
					}
				}
			}

			if (unusedExports.length > 0) {
				logger.info(
					`⚠️  Found ${unusedExports.length} potentially unused exports`,
				);
			} else {
				logger.info("✅ No unused exports detected");
			}

			return {
				unusedExports,
				warnings: [],
			};
		},
	};
}
