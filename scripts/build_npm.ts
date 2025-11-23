#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run

import { build, emptyDir } from "@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: ["./cli_node.ts"],
  outDir: "./npm",
  shims: {
    // Use Deno shims for Deno-specific APIs
    deno: true,
  },
  compilerOptions: {
    // Preserve shebangs in output
    lib: ["ES2022", "DOM"],
  },
  filterDiagnostic(diagnostic) {
    // Ignore shebang errors in CLI files
    const fileName = diagnostic.file?.fileName;
    const message = diagnostic.messageText.toString();
    if (
      (fileName?.endsWith("cli.ts") || fileName?.endsWith("cli_node.ts")) &&
      message.includes("'#!'")
    ) {
      return false;
    }
    return true;
  },
  package: {
    name: "serenity-now",
    version: Deno.args[0] ?? "0.1.0",
    description:
      "A monorepo dependency management tool that keeps workspace dependencies in sync",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/billie-coop/serenity-now.git",
    },
    bugs: {
      url: "https://github.com/billie-coop/serenity-now/issues",
    },
    keywords: [
      "monorepo",
      "workspace",
      "dependencies",
      "typescript",
      "tsconfig",
      "package-json",
    ],
    bin: {
      "serenity-now": "./esm/cli_node.js",
    },
    engines: {
      node: ">=18.0.0",
    },
  },
  postBuild() {
    // Copy additional files to npm package
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
  // Don't include test files
  test: false,
  // Generate type declarations
  declaration: "inline",
  // Use ESM output
  scriptModule: false,
});

console.log("\n✅ npm package built successfully in ./npm");
console.log("\nTo test locally:");
console.log("  cd npm && npm pack");
console.log("  npm install -g ./serenity-now-*.tgz");
console.log("  serenity-now --help");
console.log("\nTo publish:");
console.log("  cd npm && npm publish");
