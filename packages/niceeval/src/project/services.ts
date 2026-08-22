import { Context, Data, type Effect } from "effect";

export type ProjectManagedPath =
  | "evals"
  | "niceeval.config.ts"
  | "AGENTS.md"
  | "CLAUDE.md";

export type ProjectPathKind = "missing" | "file" | "directory" | "other";

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
}> {}

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

export class ProjectFileSystem extends Context.Tag("niceeval/project/ProjectFileSystem")<
  ProjectFileSystem,
  ProjectFileSystemService
>() {}

export interface ProjectManifestFactsService {
  readonly moduleKind: (
    projectRoot: string,
  ) => Effect.Effect<"esm" | "commonjs-or-unspecified", ProjectPlatformError>;
}

export class ProjectManifestFacts extends Context.Tag("niceeval/project/ProjectManifestFacts")<
  ProjectManifestFacts,
  ProjectManifestFactsService
>() {}

export interface ProjectProcessFactsService {
  readonly cwd: Effect.Effect<string, ProjectPlatformError>;
}

export class ProjectProcessFacts extends Context.Tag("niceeval/project/ProjectProcessFacts")<
  ProjectProcessFacts,
  ProjectProcessFactsService
>() {}
