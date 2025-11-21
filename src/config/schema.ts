// Config validation schema using Zod
import { z } from "zod";

// Schema for workspace type configuration
const WorkspaceTypeConfigSchema = z.object({
  type: z.enum(["app", "shared-package"]),
  subType: z.string().optional(), // Allow any string value for flexibility
  enforceNamePrefix: z.union([z.string(), z.literal(false)]).optional(),
  packageJsonTemplate: z.record(z.string(), z.unknown()).optional(),
  tsconfigTemplate: z.record(z.string(), z.unknown()).optional(),
});

// Main config schema
export const SyncConfigSchema = z.object({
  workspaceTypes: z.record(z.string(), WorkspaceTypeConfigSchema).refine(
    (types) => Object.keys(types).length > 0,
    { message: "At least one workspaceTypes pattern is required" },
  ),
  defaultDependencies: z.array(z.string()).optional().default([]),
  ignoreProjects: z.array(z.string()).optional().default([]),
  ignoreImports: z.array(z.string()).optional().default([]),
  // Deprecated but kept for backwards compatibility
  enforceNamePrefix: z.string().optional(),
  tsconfig: z.object({
    preserveOutDir: z.boolean().optional(),
    typeOnlyInDevDependencies: z.boolean().optional(),
    incremental: z.boolean().optional().default(true), // Default to true for better build performance
  }).optional(),
});

// Infer the type from the schema
export type ValidatedSyncConfig = z.infer<typeof SyncConfigSchema>;

// Export the workspace type config schema for use elsewhere if needed
export { WorkspaceTypeConfigSchema };
