import { CommandExecutor, FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, ParseResult, Schema } from "effect";

import {
  CandidateManifestSchema,
  DownstreamCommandInputSchema,
  type DownstreamError,
  DownstreamInputError,
  type DownstreamManifest,
  DownstreamManifestError,
  DownstreamManifestSchema,
  DownstreamPathError,
  type DownstreamReceipt,
  DownstreamValidationError,
  DownstreamVerificationError,
} from "./model.js";
import { requireSuccess } from "./process.js";

export * from "./model.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PACKAGE_ROOT = join(ROOT, "packages/niceeval");

type DownstreamServices = FileSystem.FileSystem | CommandExecutor.CommandExecutor;

function decodeInput(input: unknown) {
  return Schema.decodeUnknown(DownstreamCommandInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new DownstreamInputError({
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
  );
}

function readManifest<A, I>(path: string, schema: Schema.Schema<A, I>) {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(path).pipe(
      Effect.mapError((error) => new DownstreamManifestError({
        path,
        operation: "read",
        message: String(error),
      })),
    );
    const input = yield* Effect.try({
      try: () => JSON.parse(source) as unknown,
      catch: (error) => new DownstreamManifestError({
        path,
        operation: "parse",
        message: error instanceof Error ? error.message : String(error),
      }),
    });
    return yield* Schema.decodeUnknown(schema, { errors: "all" })(input).pipe(
      Effect.mapError((error) => new DownstreamManifestError({
        path,
        operation: "decode",
        message: ParseResult.TreeFormatter.formatErrorSync(error),
      })),
    );
  });
}

function declaresNiceeval(manifest: DownstreamManifest): boolean {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].some((dependencies) => dependencies !== undefined && Object.hasOwn(dependencies, "niceeval"));
}

function declaredPnpmVersion(manifest: DownstreamManifest): string | undefined {
  if (manifest.packageManager?.startsWith("pnpm@")) return manifest.packageManager.slice("pnpm@".length);
  const manager = manifest.devEngines?.packageManager;
  return manager?.name === "pnpm" ? manager.version : undefined;
}

function directory(path: string): Effect.Effect<boolean, DownstreamPathError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(path).pipe(
      Effect.mapError((error) => new DownstreamPathError({ path, message: String(error) })),
    ))) return false;
    const info = yield* fs.stat(path).pipe(
      Effect.mapError((error) => new DownstreamPathError({ path, message: String(error) })),
    );
    return info.type === "Directory";
  });
}

function realPath(path: string): Effect.Effect<string, DownstreamPathError, FileSystem.FileSystem> {
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.realPath(path)).pipe(
    Effect.mapError((error) => new DownstreamPathError({ path, message: String(error) })),
  );
}

function inspectDownstream(
  requested: string,
  operation: "check" | "link",
  dryRun: boolean,
): Effect.Effect<DownstreamReceipt, DownstreamError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const requestedRoot = isAbsolute(requested) ? requested : resolve(ROOT, requested);
    if (!(yield* directory(requestedRoot))) {
      return yield* new DownstreamPathError({ path: requestedRoot, message: "project directory does not exist" });
    }
    const [sourceRoot, projectRoot] = yield* Effect.all([realPath(ROOT), realPath(requestedRoot)]);
    if (sourceRoot === projectRoot) {
      return yield* new DownstreamPathError({
        path: projectRoot,
        message: "project must be different from the NiceEval checkout",
      });
    }
    const projectManifest = yield* readManifest(join(projectRoot, "package.json"), DownstreamManifestSchema);
    const candidateManifest = yield* readManifest(join(PACKAGE_ROOT, "package.json"), CandidateManifestSchema);
    const installedNodeModules = yield* directory(join(projectRoot, "node_modules"));
    const installedNiceeval = join(projectRoot, "node_modules/niceeval");
    const hasInstalledNiceeval = installedNodeModules && (yield* fs.exists(installedNiceeval).pipe(
      Effect.mapError((error) => new DownstreamPathError({ path: installedNiceeval, message: String(error) })),
    ));
    const currentNiceevalRoot = hasInstalledNiceeval ? yield* realPath(installedNiceeval) : undefined;
    const declared = declaresNiceeval(projectManifest);
    const problems = [
      ...(declared ? [] : ["project package.json does not declare niceeval"]),
      ...(installedNodeModules ? [] : ["project dependencies are not installed"]),
      ...(candidateManifest.name === "niceeval" ? [] : [`candidate package name is ${candidateManifest.name}, expected niceeval`]),
    ];
    return {
      domain: "link",
      operation,
      dryRun,
      ok: problems.length === 0,
      candidate: {
        name: candidateManifest.name,
        version: candidateManifest.version,
        sourceRoot: yield* realPath(PACKAGE_ROOT),
      },
      project: {
        name: projectManifest.name ?? basename(projectRoot),
        root: projectRoot,
        ...(declaredPnpmVersion(projectManifest) === undefined
          ? {}
          : { pnpmVersion: declaredPnpmVersion(projectManifest) }),
        declaresNiceeval: declared,
        nodeModulesInstalled: installedNodeModules,
        ...(currentNiceevalRoot === undefined ? {} : { currentNiceevalRoot }),
      },
      actions: operation === "link"
        ? ["build package", "build package index", "pack candidate", "link candidate into project", "verify resolved link"]
        : [],
      problems,
    };
  });
}

function sha256(path: string): Effect.Effect<string, DownstreamPathError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs.readFile(path).pipe(
      Effect.mapError((error) => new DownstreamPathError({ path, message: String(error) })),
    );
    return createHash("sha256").update(bytes).digest("hex");
  });
}

function linkDownstream(requested: string): Effect.Effect<DownstreamReceipt, DownstreamError, DownstreamServices> {
  return Effect.gen(function*() {
    const inspected = yield* inspectDownstream(requested, "link", false);
    if (!inspected.ok) return yield* new DownstreamValidationError({ receipt: inspected });
    const fs = yield* FileSystem.FileSystem;

    yield* requireSuccess("pnpm", ["run", "build:package"], ROOT);
    yield* requireSuccess("pnpm", ["run", "build:index"], ROOT);

    return yield* Effect.scoped(Effect.gen(function*() {
      const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-project-link-" }).pipe(
        Effect.mapError((error) => new DownstreamPathError({ path: ROOT, message: String(error) })),
      );
      yield* requireSuccess("pnpm", [
        "--config.ignore-scripts=true",
        "pack",
        "--pack-destination",
        scratch,
      ], PACKAGE_ROOT);
      const entries = yield* fs.readDirectory(scratch).pipe(
        Effect.mapError((error) => new DownstreamPathError({ path: scratch, message: String(error) })),
      );
      const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
      if (tarballs.length !== 1) {
        return yield* new DownstreamPathError({
          path: scratch,
          message: `pack produced ${tarballs.length} tarballs; expected exactly one`,
        });
      }
      const tarball = join(scratch, tarballs[0] ?? "");
      const digest = yield* sha256(tarball);
      const version = inspected.project.pnpmVersion;
      if (version === undefined) {
        yield* requireSuccess("pnpm", ["link", PACKAGE_ROOT], inspected.project.root);
      } else {
        yield* requireSuccess("corepack", [`pnpm@${version}`, "link", PACKAGE_ROOT], inspected.project.root);
      }
      const installed = yield* realPath(join(inspected.project.root, "node_modules/niceeval"));
      const expected = yield* realPath(PACKAGE_ROOT);
      if (installed !== expected) return yield* new DownstreamVerificationError({ expected, actual: installed });
      return {
        ...inspected,
        ok: true,
        candidate: { ...inspected.candidate, sha256: digest },
        project: { ...inspected.project, currentNiceevalRoot: installed },
      };
    }));
  });
}

export function runDownstreamCommand(
  input: unknown,
): Effect.Effect<DownstreamReceipt, DownstreamError, DownstreamServices> {
  return decodeInput(input).pipe(
    Effect.flatMap((decoded) => decoded.operation === "check"
      ? inspectDownstream(decoded.project, "check", false)
      : decoded.dryRun
      ? inspectDownstream(decoded.project, "link", true)
      : linkDownstream(decoded.project)),
  );
}

export const checkDownstream = (project: string) => runDownstreamCommand({
  operation: "check",
  project,
});

export const linkDownstreamCandidate = (project: string, dryRun: boolean) => runDownstreamCommand({
  operation: "link",
  project,
  dryRun,
});

export const downstreamCommandContribution = Object.freeze({
  name: "downstream",
  summary: "Check a project or build and link the current NiceEval candidate.",
  input: DownstreamCommandInputSchema,
  run: runDownstreamCommand,
  check: checkDownstream,
  link: linkDownstreamCandidate,
});
