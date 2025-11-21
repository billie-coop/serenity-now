// Logging utilities for the sync-deps tool
// Deno version - using built-in colors

import { bold, cyan, green, red, yellow } from "@std/fmt/colors";

export class Logger {
  private warnings: string[] = [];

  constructor(
    private verbose = false,
  ) {}

  step(message: string): void {
    console.log(cyan(bold("→ " + message)));
  }

  success(message: string): void {
    console.log(green("✓ " + message));
  }

  error(message: string): void {
    console.error(red("✗ " + message));
  }

  warn(message: string): void {
    console.warn(yellow("⚠ " + message));
    this.warnings.push(message);
  }

  info(message: string): void {
    console.log(message);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  section(title: string): void {
    console.log("\n" + bold(title));
    console.log("─".repeat(title.length));
  }

  phase(title: string): void {
    console.log("\n" + cyan(bold(`Phase: ${title}`)));
  }

  printSummary(
    stats: {
      projectsScanned: number;
      filesModified: number;
      staleRemoved: number;
    },
  ) {
    this.section("Summary");
    console.log(`  Projects scanned: ${stats.projectsScanned}`);
    console.log(`  Files modified: ${stats.filesModified}`);
    if (stats.staleRemoved > 0) {
      console.log(`  Stale dependencies removed: ${stats.staleRemoved}`);
    }
  }

  getWarnings(): string[] {
    return this.warnings;
  }
}

// Create singleton logger instance
export const log = new Logger();
