import picomatch from "picomatch";

/**
 * Compiles glob patterns into a single matcher. Every pattern-based config
 * option (workspaceTypes, ignoreImports, excludePatterns) goes through here so
 * they all share one glob syntax.
 */
export function createMatcher(patterns: string[]): (value: string) => boolean {
	if (patterns.length === 0) return () => false;
	return picomatch(patterns, { dot: true });
}
