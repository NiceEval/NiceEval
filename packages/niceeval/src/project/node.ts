import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import {
  ProjectFileSystem,
  ProjectManifestFacts,
  ProjectPlatformError,
  ProjectProcessFacts,
  type ProjectFileSystemService,
  type ProjectManagedPath,
  type ProjectPathKind,
} from "./services.ts";

function failure(
  operation: ProjectPlatformError["operation"],
  resource: string,
  cause: unknown,
): ProjectPlatformError {
  return new ProjectPlatformError({ operation, resource, cause });
}

function managedPath(root: string, path: ProjectManagedPath): string {
  return join(root, path);
}

function nodePathKind(path: string): Effect.Effect<ProjectPathKind, ProjectPlatformError> {
  return Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((stats) => stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other"),
    Effect.catch((cause) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
        return Effect.succeed("missing" as const);
      }
      return Effect.fail(failure("inspect-path", path, cause));
    }),
  );
}

const nodeProjectFileSystem: ProjectFileSystemService = {
  pathKind: ({ root, path }) => nodePathKind(managedPath(root, path)),
  ensureDirectory: ({ root, path }) => Effect.gen(function* () {
    const target = managedPath(root, path);
    const before = yield* nodePathKind(target);
    yield* Effect.tryPromise({
      try: () => mkdir(target, { recursive: true }),
      catch: (cause) => failure("create-directory", target, cause),
    });
    return before === "missing" ? "created" as const : "existing" as const;
  }),
  readText: ({ root, path }) => {
    const target = managedPath(root, path);
    return nodePathKind(target).pipe(
      Effect.flatMap((kind) => kind === "missing"
        ? Effect.succeed(null)
        : Effect.tryPromise({
            try: () => readFile(target, "utf8"),
            catch: (cause) => failure("read-file", target, cause),
          })),
    );
  },
  writeText: ({ root, path, text }) => {
    const target = managedPath(root, path);
    return Effect.tryPromise({
      try: () => writeFile(target, text, "utf8"),
      catch: (cause) => failure("write-file", target, cause),
    });
  },
};

export const NodeProjectFileSystemLive = Layer.succeed(
  ProjectFileSystem,
  nodeProjectFileSystem,
);

export const NodeProjectManifestFactsLive = Layer.succeed(ProjectManifestFacts, {
  moduleKind: (projectRoot) => Effect.gen(function* () {
    let directory = resolve(projectRoot);
    while (true) {
      const manifestPath = join(directory, "package.json");
      const kind = yield* nodePathKind(manifestPath);
      if (kind === "file") {
        const source = yield* Effect.tryPromise({
          try: () => readFile(manifestPath, "utf8"),
          catch: (cause) => failure("inspect-package-manifest", manifestPath, cause),
        });
        let decoded: unknown;
        try {
          decoded = JSON.parse(source) as unknown;
        } catch {
          return "commonjs-or-unspecified" as const;
        }
        return typeof decoded === "object" && decoded !== null &&
            "type" in decoded && decoded.type === "module"
          ? "esm" as const
          : "commonjs-or-unspecified" as const;
      }
      const parent = dirname(directory);
      if (parent === directory) return "commonjs-or-unspecified" as const;
      directory = parent;
    }
  }),
});

export const NodeProjectProcessFactsLive = Layer.succeed(ProjectProcessFacts, {
  cwd: Effect.try({
    try: () => process.cwd(),
    catch: (cause) => failure("read-process-cwd", "cwd", cause),
  }),
});

export const NodeProjectLive = Layer.mergeAll(
  NodeProjectFileSystemLive,
  NodeProjectManifestFactsLive,
  NodeProjectProcessFactsLive,
);
