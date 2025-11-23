import { createConsoleLogger } from "./console_logger.ts";

function captureConsole() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];

  console.log = ((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  }) as typeof console.log;

  console.warn = ((...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  }) as typeof console.warn;

  console.error = ((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  }) as typeof console.error;

  return {
    logs,
    warns,
    errors,
    restore() {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

Deno.test("console logger logs phase messages", () => {
  const logger = createConsoleLogger();
  const capture = captureConsole();
  try {
    logger.phase("Test Phase");
    if (!capture.logs.some((line) => line.includes("Phase: Test Phase"))) {
      throw new Error("Expected phase message to be logged");
    }
  } finally {
    capture.restore();
  }
});

Deno.test("console logger logs info messages", () => {
  const logger = createConsoleLogger();
  const capture = captureConsole();
  try {
    logger.info("Test info");
    if (!capture.logs.some((line) => line.includes("Test info"))) {
      throw new Error("Expected info message to be logged");
    }
  } finally {
    capture.restore();
  }
});

Deno.test("console logger logs warnings and tracks them", () => {
  const logger = createConsoleLogger();
  const capture = captureConsole();
  try {
    logger.warn("Test warning");
    if (!capture.warns.some((line) => line.includes("Test warning"))) {
      throw new Error("Expected warning to be logged");
    }
    const warnings = logger.getWarnings?.();
    if (!warnings || warnings.length !== 1 || warnings[0] !== "Test warning") {
      throw new Error("Expected warning to be tracked");
    }
  } finally {
    capture.restore();
  }
});

Deno.test("console logger logs error messages", () => {
  const logger = createConsoleLogger();
  const capture = captureConsole();
  try {
    logger.error("Test error");
    if (!capture.errors.some((line) => line.includes("Test error"))) {
      throw new Error("Expected error message to be logged");
    }
  } finally {
    capture.restore();
  }
});

Deno.test("console logger logs debug messages when verbose=true", () => {
  const logger = createConsoleLogger(true);
  const capture = captureConsole();
  try {
    logger.debug("Test debug");
    if (!capture.logs.some((line) => line.includes("Test debug"))) {
      throw new Error("Expected debug message to be logged in verbose mode");
    }
  } finally {
    capture.restore();
  }
});

Deno.test("console logger skips debug messages when verbose=false", () => {
  const logger = createConsoleLogger(false);
  const capture = captureConsole();
  try {
    logger.debug("Test debug");
    if (capture.logs.some((line) => line.includes("Test debug"))) {
      throw new Error(
        "Expected debug message to be skipped in non-verbose mode",
      );
    }
  } finally {
    capture.restore();
  }
});
