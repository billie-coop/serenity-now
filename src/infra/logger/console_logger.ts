import { bold, cyan, green, red, yellow } from "../utils/colors.js";
import type { LoggerPort } from "../../core/ports.js";

class ConsoleLogger implements LoggerPort {
  private warnings: string[] = [];

  constructor(
    private readonly verbose = false,
  ) {}

  phase(message: string): void {
    console.log(`\n${cyan(bold(`Phase: ${message}`))}`);
  }

  info(message: string): void {
    console.log(message);
  }

  warn(message: string): void {
    console.warn(yellow(`⚠ ${message}`));
    this.warnings.push(message);
  }

  error(message: string): void {
    console.error(red(`✗ ${message}`));
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  success(message: string): void {
    console.log(green(`✓ ${message}`));
  }
}

export function createConsoleLogger(verbose = false): LoggerPort {
  return new ConsoleLogger(verbose);
}
