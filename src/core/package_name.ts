/**
 * Extracts the package name from a bare import specifier, stripping subpaths.
 *
 *   "@scope/pkg"          → "@scope/pkg"
 *   "@scope/pkg/sub/path" → "@scope/pkg"
 *   "pkg"                 → "pkg"
 *   "pkg/sub"             → "pkg"
 */
export function packageNameFromSpecifier(specifier: string): string {
	const parts = specifier.split("/");
	if (specifier.startsWith("@") && parts.length >= 2) {
		return `${parts[0]}/${parts[1]}`;
	}
	return parts[0] ?? specifier;
}

/** Whether a specifier refers to a package rather than a relative or absolute path. */
export function isBareSpecifier(specifier: string): boolean {
	return (
		specifier.length > 0 &&
		!specifier.startsWith(".") &&
		!specifier.startsWith("/") &&
		!specifier.startsWith("#")
	);
}
