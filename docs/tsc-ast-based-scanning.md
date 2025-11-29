# TypeScript AST-Based Scanning Implementation Plan

## Problem

The current export/import scanning implementation uses regex-based parsing which is:
- Fragile and error-prone
- Misses edge cases (complex re-exports, aliases, etc.)
- Doesn't properly handle TypeScript syntax
- Goes against the project philosophy of "don't guess" and "fail fast"

## Solution

Replace regex-based scanners with TypeScript Compiler API for proper AST parsing.

## Dependencies

- TypeScript needs to be moved from `devDependencies` to `dependencies` (it's a runtime requirement)
- Already on TypeScript 5.7.2 (latest)

## Implementation Steps

### 1. Update Dependencies

```bash
npm install --save typescript
```

This moves TypeScript from dev to runtime dependencies.

### 2. Create TypeScript-Based Export Scanner

**File:** `src/infra/phases/typescript_export_scanner.ts`

**Approach:**
- For each project, check if `tsconfig.json` exists
- If it exists, parse it using `ts.parseConfigFileTextToJson()`
- Create a `ts.Program` using `ts.createProgram()`
- Get the `TypeChecker` via `program.getTypeChecker()`
- Get all source files in the project
- For each source file:
  - Get the module symbol using `typeChecker.getSymbolAtLocation(sourceFile)`
  - Get all exports using `typeChecker.getExportsOfModule(moduleSymbol)`
  - For each export symbol:
    - Extract export name
    - Determine if it's type-only by checking `SymbolFlags`
    - Determine export type (named/default/namespace)
    - Add to results

**Key TypeScript APIs:**
- `ts.parseConfigFileTextToJson()` - parse tsconfig.json
- `ts.parseJsonConfigFileContent()` - parse compiler options
- `ts.createProgram()` - create a program
- `program.getTypeChecker()` - get type checker
- `typeChecker.getSymbolAtLocation()` - get symbol from node
- `typeChecker.getExportsOfModule()` - get all exports from module
- `exportSymbol.flags & ts.SymbolFlags.Type` - check if type-only

### 3. Create TypeScript-Based Import Scanner

**File:** `src/infra/phases/typescript_import_scanner.ts`

**Approach:**
- For each project, check if `tsconfig.json` exists
- If it exists, create a `ts.Program` (same as export scanner)
- Get all source files in the project
- For each source file:
  - Traverse the AST using `ts.forEachChild()`
  - Look for `ts.isImportDeclaration()` nodes
  - Look for `ts.isExportDeclaration()` nodes (re-exports)
  - For each import/export:
    - Extract module specifier
    - Check if it's a workspace import
    - Determine if type-only
    - Extract named imports
    - Add to results

**Key TypeScript APIs:**
- `ts.forEachChild(node, callback)` - traverse AST
- `ts.isImportDeclaration(node)` - type guard for imports
- `ts.isExportDeclaration(node)` - type guard for exports
- `ts.isStringLiteral(node)` - type guard for string literals
- `ts.isNamedImports(namedBindings)` - check for named imports
- `ts.isNamespaceImport(namedBindings)` - check for namespace imports

### 4. Update Default Dependencies

**File:** `src/infra/default_deps.ts`

Replace:
```typescript
import { createExportScanner } from "./phases/export_scanner.js";
import { createImportScanner } from "./phases/import_scanner.js";
```

With:
```typescript
import { createTypeScriptExportScanner } from "./phases/typescript_export_scanner.js";
import { createTypeScriptImportScanner } from "./phases/typescript_import_scanner.js";
```

And update the factory:
```typescript
phases: {
  exportScanner: createTypeScriptExportScanner(),
  importScanner: createTypeScriptImportScanner(),
  // ... rest unchanged
}
```

### 5. Test the Implementation

```bash
npm run build
node dist/cli.js detect-unused-exports
```

Verify:
- Build succeeds without TypeScript errors
- Export scanning works correctly
- Import scanning works correctly
- Unused export detection produces accurate results

### 6. Remove Old Files

Once tested and working, delete the old regex-based scanners:
- `src/infra/phases/export_scanner.ts`
- `src/infra/phases/import_scanner.ts`

## Benefits

1. **Correctness**: TypeScript parser understands the syntax perfectly
2. **Reliability**: No regex edge cases to worry about
3. **Maintainability**: Simpler code, leverages TypeScript's own parser
4. **Philosophy alignment**: "Don't guess" - we let TypeScript tell us what's exported/imported
5. **Re-exports handled properly**: TypeScript resolves aliases and re-exports automatically

## Trade-offs

1. **Runtime dependency**: TypeScript becomes a runtime dependency (increases package size)
2. **Performance**: Creating TypeScript programs may be slower than regex (but more correct)
3. **tsconfig.json required**: Projects without tsconfig won't be scanned (acceptable per project philosophy)

## Notes

- The hexagonal architecture makes this swap easy - just implement the same ports
- The core domain and unused export detector don't need to change
- All the types (`ExportRecord`, `ProjectUsage`, etc.) stay the same
- This follows the project philosophy of being strict and explicit rather than guessing
