/**
 * Simple argument parser
 */

export interface ParsedArgs {
  [key: string]: boolean | string | string[] | undefined;
  _: string[];
}

export interface ParseOptions {
  boolean?: string[];
  string?: string[];
  alias?: Record<string, string | string[]>;
}

export function parseArgs(
  args: string[],
  options: ParseOptions = {},
): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  const booleans = new Set(options.boolean || []);
  const strings = new Set(options.string || []);
  const aliases = new Map<string, string>();

  // Build alias map (both directions)
  if (options.alias) {
    for (const [key, value] of Object.entries(options.alias)) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        aliases.set(v, key);
        aliases.set(key, key);
      }
    }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg) continue;

    // Handle --flag or --flag=value
    if (arg.startsWith("--")) {
      const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
      if (match) {
        const key = aliases.get(match[1]) || match[1];
        const value = match[2];

        if (value !== undefined) {
          result[key] = value;
        } else if (booleans.has(key)) {
          result[key] = true;
        } else if (strings.has(key)) {
          result[key] = args[++i] || "";
        } else {
          result[key] = true;
        }
      }
      continue;
    }

    // Handle -f or -abc (combined flags)
    if (arg.startsWith("-") && arg.length > 1) {
      const flags = arg.slice(1);

      // If next arg doesn't start with -, it might be a value
      const nextArg = args[i + 1];
      const hasValue = nextArg && !nextArg.startsWith("-");

      if (flags.length === 1 && strings.has(flags) && hasValue) {
        const key = aliases.get(flags) || flags;
        result[key] = args[++i] || "";
      } else {
        // Process each flag
        for (const flag of flags) {
          const key = aliases.get(flag) || flag;
          result[key] = true;
        }
      }
      continue;
    }

    // Positional argument
    result._.push(arg);
  }

  return result;
}
