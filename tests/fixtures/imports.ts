/**
 * Shared test fixtures for import pattern testing
 */

export const IMPORT_EXAMPLES = {
  // ES6 static imports
  staticImports: `
import { foo, bar } from "lodash";
import React from "react";
import * as Utils from "@test/utils";
  `,

  // Type-only imports
  typeImports: `
import type { Something } from "types";
import type { User } from "@test/models";
  `,

  // Mixed type and runtime
  mixedImports: `
import type { Types } from "package-a";
import { runtime } from "package-a";
  `,

  // Export statements
  exportStatements: `
export { foo } from "module-a";
export * from "module-b";
export type { Bar } from "module-c";
  `,

  // Dynamic imports
  dynamicImports: `
const module = await import("dynamic-module");
const lazy = () => import("lazy-module");
  `,

  // CommonJS require
  requireStatements: `
const fs = require("fs");
const path = require("path");
  `,

  // Relative imports (should be ignored)
  relativeImports: `
import { foo } from "./local";
import { bar } from "../parent";
import { baz } from "../../grandparent";
  `,

  // Workspace imports
  workspaceImports: `
import { Button } from "@test/ui";
import { formatDate } from "@test/utils";
import type { Config } from "@test/types";
  `,

  // Subpath imports
  subpathImports: `
import { Button } from "@test/ui/components";
import { red } from "@test/ui/colors";
  `,

  // Node built-ins
  nodeBuiltins: `
import fs from "node:fs";
import path from "node:path";
import { readFile } from "fs";
  `,

  // Duplicate imports (should dedupe)
  duplicates: `
import { foo } from "lodash";
import { bar } from "lodash";
const more = require("lodash");
  `,

  // Real-world complex example
  realWorld: `
import React, { useState, useEffect } from "react";
import type { FC } from "react";
import { Button } from "@test/ui/components";
import { formatDate, parseDate } from "@test/utils";
import type { User, Post } from "@test/types";
import * as styles from "./styles.css";
import { api } from "../api";
  `,
};

/**
 * Mock workspace package sets for testing
 */
export const MOCK_WORKSPACES = {
  simple: new Set(["@test/utils", "@test/ui", "@test/core"]),

  complex: new Set([
    "@test/utils",
    "@test/ui",
    "@test/ui-components",
    "@test/types",
    "@test/models",
    "@test/api-client",
  ]),

  withNodeModules: new Set([
    "@test/utils",
    "lodash", // External but in workspace for some reason
    "react",
  ]),
};

/**
 * Common file path patterns for exclusion testing
 */
export const FILE_PATHS = {
  source: [
    "src/index.ts",
    "src/components/Button.tsx",
    "packages/ui/src/index.ts",
    "apps/web/src/main.ts",
  ],

  excluded: [
    "node_modules/lodash/index.js",
    "src/node_modules/foo/bar.ts",
    "dist/index.js",
    "packages/ui/dist/bundle.js",
    ".turbo/cache/file.ts",
    "build/output.js",
    "coverage/lcov.info",
    ".next/server/pages/index.js",
  ],

  tests: [
    "src/utils/helper.test.ts",
    "src/utils/helper.spec.ts",
    "components/Button.test.tsx",
    "tests/integration/app.spec.ts",
  ],

  generated: [
    "generated/api-types.ts",
    "src/generated/schema.ts",
  ],
};
