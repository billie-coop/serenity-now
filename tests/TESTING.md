# Testing Guide

This document explains the testing strategy and structure for the Serenity Now
monorepo dependency synchronization tool.

## Overview

Our testing approach uses two distinct types of tests:

- **Unit Tests** (`.test.ts`) - Fast, isolated tests using mocks
- **Integration Tests** (`.spec.ts`) - Real-world scenarios using actual
  filesystem operations

## Running Tests

```bash
# Run all tests with coverage (shows terminal summary + generates HTML report)
deno task test

# Watch mode for development
deno task test:watch

# Check types, formatting, and linting
deno task check
```

Coverage reports:

- Terminal summary shows immediately after tests
- HTML report generated at `coverage/html/index.html`
- Only `/src` files are included in coverage metrics

## Unit Tests

### Location

Unit tests are **colocated with source files** for easy maintenance:

```
src/
  scanner/
    workspace.ts        # Source code
    workspace.test.ts   # Unit tests
  resolver/
    graph.ts
    graph.test.ts
```

### Style

Unit tests use simple `Deno.test()` with descriptive names:

```typescript
import { assertEquals } from "@std/assert";
import { parseImports } from "./imports.ts";

Deno.test("parseImports detects ES6 imports", () => {
  const result = parseImports(`import { foo } from "@test/utils"`);
  assertEquals(result[0].source, "@test/utils");
});
```

### Approach

- Test individual functions in isolation
- Use mock data from `tests/fixtures/`
- Avoid filesystem operations (use in-memory data)
- Focus on logic and edge cases
- Run extremely fast (milliseconds)

### Test Data

Shared test fixtures in `tests/fixtures/`:

- `projects.ts` - Mock project structures
- `configs.ts` - Various configuration scenarios

Helper utilities in `tests/helpers/`:

- `setup.ts` - Filesystem setup helpers (for integration tests primarily)

Example using fixtures:

```typescript
import {
  createMockConfig,
  STRICT_CONFIG,
} from "../../tests/fixtures/configs.ts";
import { createMockProject } from "../../tests/fixtures/projects.ts";

Deno.test("validates package name prefixes", () => {
  const project = createMockProject({ name: "@wrong/utils" });
  const warnings = validatePackageName(project, STRICT_CONFIG);
  assertExists(warnings.find((w) => w.includes("should start with")));
});
```

## Integration Tests

### Location

Integration tests live in `tests/integration/`:

```
tests/
  integration/
    sync.spec.ts        # End-to-end synchronization tests
    cli.spec.ts         # CLI command tests
    incremental.spec.ts # Incremental compilation tests
```

### Style

Integration tests use **BDD (Behavior Driven Development)** style with
`describe/it`:

```typescript
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

describe("Serenity Now CLI", () => {
  let testDir: string;

  beforeEach(async () => {
    // Setup: Create a fresh copy of example directory
    testDir = await Deno.makeTempDir();
    await copy("./example", testDir);
  });

  afterEach(async () => {
    // Teardown: Clean up test directory
    await Deno.remove(testDir, { recursive: true });
  });

  describe("dependency synchronization", () => {
    it("should add missing workspace dependencies", async () => {
      // Modify example to create test scenario
      await createSourceFile(testDir, "apps/web/src/index.ts", [
        "@example/utils", // Import that creates dependency
      ]);

      // Run the actual CLI
      const result = await runCLI(testDir, ["--verbose"]);

      // Verify the final state
      const packageJson = await readJson(
        join(testDir, "apps/web/package.json"),
      );
      assertExists(packageJson.dependencies["@example/utils"]);
      assertEquals(result.exitCode, 0);
    });

    it("should detect circular dependencies", async () => {
      // Set up circular dependency scenario...
    });
  });
});
```

### Approach

- Test complete workflows end-to-end
- Use the `example/` directory as a base test fixture
- Create temporary copies for each test (isolation)
- Run the actual CLI commands
- Verify the final filesystem state
- Test error conditions and edge cases

### Test Scenarios

Common integration test scenarios:

1. **Dependency Synchronization**
   - Add imports → verify package.json updated
   - Remove imports → verify cleanup
   - Handle diamond dependencies
   - Detect circular dependencies

2. **Configuration**
   - Missing config file → prompt to create
   - Invalid config → proper error messages
   - Workspace pattern matching
   - Name prefix enforcement

3. **Incremental Compilation**
   - Verify tsconfig.json updates
   - Check composite flag management
   - Root tsconfig references

4. **CLI Behavior**
   - Dry run mode (no changes)
   - Verbose output
   - Exit codes for various scenarios

## Test Data Management

### Example Directory

The `example/` directory serves as a realistic test fixture:

- Complete monorepo structure (apps/, packages/)
- Valid configuration file
- TypeScript setup with incremental compilation
- Intentionally empty dependencies (for testing detection)

### Test Isolation

Each integration test:

1. Creates a temporary copy of the example
2. Modifies it for the specific scenario
3. Runs the test
4. Cleans up completely

This ensures tests don't interfere with each other and can run in parallel.

## Coverage Goals

Target coverage metrics:

- **Overall**: 80%+ line coverage
- **Core modules** (scanner, resolver, emitter): 90%+
- **Utilities**: 70%+ (some edge cases may be untestable)

Current coverage visible via:

```bash
deno task test  # Shows summary in terminal
# HTML report at coverage/html/index.html
```

## Best Practices

1. **Write tests first** when fixing bugs (regression prevention)
2. **Keep tests focused** - one concept per test
3. **Use descriptive names** that explain what's being tested
4. **Mock at boundaries** - only mock external dependencies
5. **Test behavior, not implementation** - tests shouldn't break with
   refactoring
6. **Keep fixtures realistic** - use actual monorepo patterns
7. **Document complex scenarios** with comments

## Adding New Tests

### Adding a Unit Test

1. Create `.test.ts` file next to source file
2. Import test utilities and assertions
3. Write focused tests for each function
4. Use fixtures for complex data

### Adding an Integration Test

1. Create `.spec.ts` file in `tests/integration/`
2. Use BDD structure with describe/it
3. Set up complete scenarios
4. Test actual CLI execution
5. Verify final state

## Continuous Integration

Tests should run in CI with:

```bash
deno task check  # Type checking, linting, formatting
deno task test   # All tests with coverage
```

Coverage reports can be uploaded to services like Codecov using the LCOV format:

```bash
deno test --allow-all --coverage=coverage
deno coverage coverage --lcov --output=coverage.lcov
```
