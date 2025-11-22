import { assertEquals } from "@std/assert";
import { globToRegExp } from "@std/path/glob-to-regexp";

function shouldExclude(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const regex = globToRegExp(pattern, { extended: true, globstar: true });
  return regex.test(normalizedPath);
}

Deno.test("exclude pattern: **/node_modules/** should match node_modules at any level", () => {
  const pattern = "**/node_modules/**";

  // Should match
  assertEquals(
    shouldExclude("node_modules/foo/index.js", pattern),
    true,
    "Should match at root",
  );
  assertEquals(
    shouldExclude("src/node_modules/bar/main.js", pattern),
    true,
    "Should match nested",
  );
  assertEquals(
    shouldExclude("packages/app/node_modules/lib.js", pattern),
    true,
    "Should match deeply nested",
  );

  // Should NOT match - these are currently FAILING (incorrectly matching)
  assertEquals(
    shouldExclude("node_modules-helper/src/index.js", pattern),
    false,
    "Should NOT match node_modules-helper",
  );
  assertEquals(
    shouldExclude("packages/node_modules_backup/file.js", pattern),
    false,
    "Should NOT match node_modules_backup",
  );
  assertEquals(
    shouldExclude("src/my-node_modules/test.js", pattern),
    false,
    "Should NOT match my-node_modules",
  );
});

Deno.test("exclude pattern: **/dist/** should match dist directory, not substring", () => {
  const pattern = "**/dist/**";

  // Should match
  assertEquals(
    shouldExclude("dist/index.js", pattern),
    true,
    "Should match dist at root",
  );
  assertEquals(
    shouldExclude("packages/app/dist/bundle.js", pattern),
    true,
    "Should match nested dist",
  );

  // Should NOT match - these are currently FAILING (incorrectly matching)
  assertEquals(
    shouldExclude("packages/distribution/src/index.js", pattern),
    false,
    "Should NOT match distribution",
  );
  assertEquals(
    shouldExclude("src/distant/file.js", pattern),
    false,
    "Should NOT match distant",
  );
  assertEquals(
    shouldExclude("redis_toolkit/main.js", pattern),
    false,
    "Should NOT match redis_toolkit",
  );
});

Deno.test("exclude pattern: **/*.test.ts should match test files at any level", () => {
  const pattern = "**/*.test.ts";

  // Should match
  assertEquals(
    shouldExclude("foo.test.ts", pattern),
    true,
    "Should match at root",
  );
  assertEquals(
    shouldExclude("src/utils/helper.test.ts", pattern),
    true,
    "Should match nested",
  );
  assertEquals(
    shouldExclude("packages/app/__tests__/button.test.ts", pattern),
    true,
    "Should match deeply nested",
  );

  // Should NOT match
  assertEquals(
    shouldExclude("src/test.ts", pattern),
    false,
    "Should NOT match test.ts without .test",
  );
  assertEquals(
    shouldExclude("foo.test.tsx", pattern),
    false,
    "Should NOT match .tsx",
  );
});

Deno.test("exclude pattern: **/__tests__/** should match __tests__ directory only", () => {
  const pattern = "**/__tests__/**";

  // Should match
  assertEquals(
    shouldExclude("__tests__/foo.ts", pattern),
    true,
    "Should match at root",
  );
  assertEquals(
    shouldExclude("src/__tests__/bar.test.ts", pattern),
    true,
    "Should match nested",
  );

  // Should NOT match - these might be FAILING
  assertEquals(
    shouldExclude("src/__tests_helpers__/util.ts", pattern),
    false,
    "Should NOT match __tests_helpers__",
  );
  assertEquals(
    shouldExclude("my__tests__/file.ts", pattern),
    false,
    "Should NOT match my__tests__",
  );
});
