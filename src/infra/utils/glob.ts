/**
 * Convert a glob pattern to a RegExp
 * Simplified version - handles basic glob patterns
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob;

  // Escape special regex characters except *, ?, [, ]
  pattern = pattern.replace(/[.+^${}()|\\]/g, "\\$&");

  // Convert glob patterns to regex
  pattern = pattern.replace(/\*\*/g, "@@GLOBSTAR@@");
  pattern = pattern.replace(/\*/g, "[^/]*");
  pattern = pattern.replace(/@@GLOBSTAR@@/g, ".*");
  pattern = pattern.replace(/\?/g, "[^/]");

  return new RegExp(`^${pattern}$`);
}
