import { Context, Data, type Effect } from "effect";

/** Paths owned or inspected by init; guidance paths are relative to the repository root. */
export type ProjectManagedPath =
  | "evals"
  | "niceeval.config.ts"
  | "AGENTS.md"
  | "CLAUDE.md"
  | "node_modules/niceeval/INDEX.md"
  | ".agents/skills/niceeval/SKILL.md"
  | ".claude/skills/niceeval/SKILL.md";

export const PROJECT_PATH_KINDS = ["missing", "file", "directory", "other"] as const;
/** Classifies an init target before reading or writing it. */
export type ProjectPathKind = (typeof PROJECT_PATH_KINDS)[number];

/** Reports a platform or guidance validation failure without losing its resource path. */
export class ProjectPlatformError extends Data.TaggedError("ProjectPlatformError")<{
  readonly operation:
    | "read-process-cwd"
    | "inspect-path"
    | "create-directory"
    | "read-file"
    | "write-file"
    | "inspect-package-manifest";
  readonly resource: string;
  readonly cause: unknown;
  readonly message?: string;
}> {}

/** Supply filesystem operations for init; readText returns null only for missing files. */
export interface ProjectFileSystemService {
  readonly pathKind: (input: {
    readonly root: string;
    readonly path: ProjectManagedPath;
  }) => Effect.Effect<ProjectPathKind, ProjectPlatformError>;
  readonly ensureDirectory: (input: {
    readonly root: string;
    readonly path: "evals";
  }) => Effect.Effect<"created" | "existing", ProjectPlatformError>;
  readonly readText: (input: {
    readonly root: string;
    readonly path: Exclude<ProjectManagedPath, "evals">;
  }) => Effect.Effect<string | null, ProjectPlatformError>;
  readonly writeText: (input: {
    readonly root: string;
    readonly path: Exclude<ProjectManagedPath, "evals">;
    readonly text: string;
  }) => Effect.Effect<void, ProjectPlatformError>;
}

/** Provide init filesystem access through this Effect service. */
export class ProjectFileSystem extends Context.Service<ProjectFileSystem, ProjectFileSystemService>()(
  "niceeval/project/ProjectFileSystem",
) {}

/** Read the package module kind used by initialization feedback. */
export interface ProjectManifestFactsService {
  readonly moduleKind: (
    projectRoot: string,
  ) => Effect.Effect<"esm" | "commonjs-or-unspecified", ProjectPlatformError>;
}

/** Provide package manifest facts to init without evaluating project configuration. */
export class ProjectManifestFacts extends Context.Service<ProjectManifestFacts, ProjectManifestFactsService>()(
  "niceeval/project/ProjectManifestFacts",
) {}

/** Resolve the invocation directory and repository-relative installed documentation entry. */
export interface ProjectProcessFactsService {
  readonly cwd: Effect.Effect<string, ProjectPlatformError>;
  readonly guidance: (cwd: string) => Effect.Effect<{
    readonly repositoryRoot: string;
    readonly indexPath: string;
    readonly command: string;
  }, ProjectPlatformError>;
}

/** Provide process and repository facts for initialization. */
export class ProjectProcessFacts extends Context.Service<ProjectProcessFacts, ProjectProcessFactsService>()(
  "niceeval/project/ProjectProcessFacts",
) {}
