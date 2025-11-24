/**
 * Convert a glob pattern to a RegExp
 * Simplified version - handles basic glob patterns
 */
export function globToRegExp(glob: string): RegExp {
	let pattern = glob;

	// Convert glob patterns to regex BEFORE escaping
	// Handle **/ at the start (matches any depth including root)
	pattern = pattern.replace(/^\*\*\//g, "@@START_GLOBSTAR@@");
	// Handle /** at the end (matches anything after)
	pattern = pattern.replace(/\/\*\*$/g, "@@END_GLOBSTAR@@");
	// Handle /**/ in the middle
	pattern = pattern.replace(/\/\*\*\//g, "@@MID_GLOBSTAR@@");
	// Handle remaining ** (shouldn't happen in well-formed globs, but just in case)
	pattern = pattern.replace(/\*\*/g, "@@GLOBSTAR@@");
	// Handle single *
	pattern = pattern.replace(/\*/g, "@@STAR@@");
	// Handle ?
	pattern = pattern.replace(/\?/g, "@@QUESTION@@");

	// Escape special regex characters
	pattern = pattern.replace(/[.+^${}()|\\[\]]/g, "\\$&");

	// Replace placeholders with regex
	pattern = pattern.replace(/@@START_GLOBSTAR@@/g, "(?:.*\\/)?");
	pattern = pattern.replace(/@@END_GLOBSTAR@@/g, "(?:\\/.*)?");
	pattern = pattern.replace(/@@MID_GLOBSTAR@@/g, "(?:\\/.*\\/)?");
	pattern = pattern.replace(/@@GLOBSTAR@@/g, ".*");
	pattern = pattern.replace(/@@STAR@@/g, "[^/]*");
	pattern = pattern.replace(/@@QUESTION@@/g, "[^/]");

	return new RegExp(`^${pattern}$`);
}
