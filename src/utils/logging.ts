// Simple logging utilities

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

export class Logger {
  private warnings: string[] = [];
  private verbose = false;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  info(message: string) {
    console.log(message);
  }

  success(message: string) {
    console.log(`${colors.green}✅${colors.reset} ${message}`);
  }

  warn(message: string) {
    this.warnings.push(message);
    console.log(`${colors.yellow}⚠️${colors.reset}  ${message}`);
  }

  error(message: string) {
    console.error(`${colors.red}❌${colors.reset} ${message}`);
  }

  debug(message: string) {
    if (this.verbose) {
      console.log(`${colors.gray}[debug]${colors.reset} ${message}`);
    }
  }

  phase(phaseName: string) {
    console.log(`\n${colors.cyan}═══ ${phaseName} ═══${colors.reset}\n`);
  }

  step(stepName: string) {
    console.log(`${colors.blue}→${colors.reset} ${stepName}`);
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  clearWarnings() {
    this.warnings = [];
  }

  printSummary(stats: {
    projectsScanned?: number;
    dependenciesFound?: number;
    staleRemoved?: number;
    filesModified?: number;
  }) {
    console.log(`\n${colors.cyan}═══ Summary ═══${colors.reset}`);
    if (stats.projectsScanned !== undefined) {
      console.log(`  Projects scanned: ${stats.projectsScanned}`);
    }
    if (stats.dependenciesFound !== undefined) {
      console.log(`  Dependencies found: ${stats.dependenciesFound}`);
    }
    if (stats.staleRemoved !== undefined && stats.staleRemoved > 0) {
      console.log(
        `  Stale dependencies removed: ${colors.yellow}${stats.staleRemoved}${colors.reset}`,
      );
    }
    if (stats.filesModified !== undefined) {
      console.log(`  Files modified: ${stats.filesModified}`);
    }
    if (this.warnings.length > 0) {
      console.log(`  Warnings: ${colors.yellow}${this.warnings.length}${colors.reset}`);
    }
  }

  section(title: string) {
    console.log(`\n${colors.magenta}▶ ${title}${colors.reset}`);
  }
}

// Default logger instance for convenience
export const log = new Logger();
