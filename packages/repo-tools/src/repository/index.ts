import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, FileSystem, Schema } from "effect";

import {
  type HostRequirementReceipt,
  RepositoryCommandInputSchema,
  type RepositoryError,
  RepositoryFileError,
  RepositoryInputError,
  RepositoryManifestError,
  RepositoryPrerequisiteError,
  type RepositoryReceipt,
} from "./model.js";
import { runProcess } from "./process.js";

export * from "./model.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST_PATH = join(ROOT, "package.json");

const TrimmedNonEmptyString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const RootManifestSchema = Schema.Struct({
  packageManager: TrimmedNonEmptyString,
  engines: Schema.Struct({ node: TrimmedNonEmptyString }),
});

type RepositoryServices = FileSystem.FileSystem | import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner;

function decodeInput(input: unknown) {
  return Schema.decodeUnknownEffect(RepositoryCommandInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new RepositoryInputError({
      message: String(error),
    })),
  );
}

function loadManifest() {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(MANIFEST_PATH).pipe(
      Effect.mapError((error) => new RepositoryManifestError({
        operation: "read",
        path: MANIFEST_PATH,
        message: String(error),
      })),
    );
    const input = yield* Effect.try({
      try: () => JSON.parse(source) as unknown,
      catch: (error) => new RepositoryManifestError({
        operation: "parse",
        path: MANIFEST_PATH,
        message: error instanceof Error ? error.message : String(error),
      }),
    });
    return yield* Schema.decodeUnknownEffect(RootManifestSchema, { errors: "all" })(input).pipe(
      Effect.mapError((error) => new RepositoryManifestError({
        operation: "decode",
        path: MANIFEST_PATH,
        message: String(error),
      })),
    );
  });
}

function numericVersion(output: string): readonly number[] | undefined {
  const match = output.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function atLeast(actual: readonly number[] | undefined, minimum: readonly number[]): boolean {
  if (actual === undefined) return false;
  for (let index = 0; index < Math.max(actual.length, minimum.length); index += 1) {
    const left = actual[index] ?? 0;
    const right = minimum[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

function inspectRepository(
  operation: "check" | "setup",
  dryRun: boolean,
): Effect.Effect<RepositoryReceipt, RepositoryError, RepositoryServices> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const manifest = yield* loadManifest();
    const gitMarker = join(ROOT, ".git");
    const hasGitMarker = yield* fs.exists(gitMarker).pipe(
      Effect.mapError((error) => new RepositoryFileError({ path: gitMarker, message: String(error) })),
    );
    if (!hasGitMarker) {
      return {
        domain: "repository" as const,
        operation,
        status: "skipped" as const,
        dryRun,
        ok: true,
        repositoryRoot: ROOT,
        hooks: { status: "skipped" as const, reason: "not-a-git-checkout" as const },
        host: [],
        actions: [],
        problems: [],
      } satisfies RepositoryReceipt;
    }
    const checkout = yield* runProcess(
      "git",
      ["rev-parse", "--show-toplevel"],
      ROOT,
      [0, 128],
    );
    const checkoutRoot = checkout.exitCode === 0
      ? yield* fs.realPath(checkout.stdout.trim()).pipe(
        Effect.mapError((error) => new RepositoryFileError({
          path: checkout.stdout.trim(),
          message: String(error),
        })),
      )
      : undefined;
    const packageRoot = yield* fs.realPath(ROOT).pipe(
      Effect.mapError((error) => new RepositoryFileError({ path: ROOT, message: String(error) })),
    );
    if (checkoutRoot === undefined || checkoutRoot !== packageRoot) {
      return {
        domain: "repository" as const,
        operation,
        status: "skipped" as const,
        dryRun,
        ok: true,
        repositoryRoot: ROOT,
        hooks: { status: "skipped" as const, reason: "not-a-git-checkout" as const },
        host: [],
        actions: [],
        problems: [],
      } satisfies RepositoryReceipt;
    }
    const commonGitDirectory = (yield* runProcess(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      ROOT,
    )).stdout.trim();
    const repositoryRoot = dirname(commonGitDirectory);
    const expectedHooks = join(repositoryRoot, ".husky", "_");
    const hookResult = yield* runProcess("git", ["config", "--local", "--get", "core.hooksPath"], ROOT, [0, 1]);
    const currentHooks = hookResult.exitCode === 0 && hookResult.stdout.trim().length > 0
      ? hookResult.stdout.trim()
      : undefined;
    const hooksExist = yield* fs.exists(expectedHooks).pipe(
      Effect.mapError((error) => new RepositoryFileError({ path: expectedHooks, message: String(error) })),
    );

    const [node, pnpm, gitVersion] = yield* Effect.all([
      runProcess("node", ["--version"], ROOT),
      runProcess("pnpm", ["--version"], ROOT),
      runProcess("git", ["--version"], ROOT),
    ], { concurrency: 3 });
    const requiredPnpm = manifest.packageManager.startsWith("pnpm@")
      ? manifest.packageManager.slice("pnpm@".length)
      : manifest.packageManager;
    const requiredNode = numericVersion(manifest.engines.node);
    const host: HostRequirementReceipt[] = [
      {
        tool: "node",
        expected: manifest.engines.node,
        actual: node.stdout.trim(),
        ok: atLeast(numericVersion(node.stdout), requiredNode ?? [24, 0, 0]),
      },
      {
        tool: "pnpm",
        expected: requiredPnpm,
        actual: pnpm.stdout.trim(),
        ok: pnpm.stdout.trim() === requiredPnpm,
      },
      {
        tool: "git",
        expected: ">=2.38.0",
        actual: gitVersion.stdout.trim(),
        ok: atLeast(numericVersion(gitVersion.stdout), [2, 38, 0]),
      },
    ];
    const hooksConfigured = currentHooks === expectedHooks;
    const problems = [
      ...(hooksExist ? [] : [`repository-owned hooks directory is missing: ${expectedHooks}`]),
      ...(hooksConfigured ? [] : [`core.hooksPath is ${currentHooks ?? "unset"}; expected ${expectedHooks}`]),
      ...host.filter((entry) => !entry.ok).map((entry) => `${entry.tool} ${entry.actual || "unavailable"} does not satisfy ${entry.expected}`),
    ];
    return {
      domain: "repository",
      operation,
      status: "checked",
      dryRun,
      ok: problems.length === 0,
      repositoryRoot,
      hooks: {
        status: "checked",
        expected: expectedHooks,
        ...(currentHooks === undefined ? {} : { current: currentHooks }),
        directoryExists: hooksExist,
        configured: hooksConfigured,
      },
      host,
      actions: operation === "setup"
        ? [
          ...(hooksExist ? [] : ["install repository-owned Git hook shims"]),
          ...((hooksConfigured && hooksExist) ? [] : [`set repository-local core.hooksPath to ${expectedHooks}`]),
        ]
        : [],
      problems,
    };
  });
}

function setupRepository(): Effect.Effect<RepositoryReceipt, RepositoryError, RepositoryServices> {
  return Effect.gen(function*() {
    const before = yield* inspectRepository("setup", false);
    if (before.status === "skipped") return before;
    const hostProblems = before.host.some((entry) => !entry.ok)
      || before.hooks.status === "skipped";
    if (hostProblems) return yield* new RepositoryPrerequisiteError({ receipt: before });
    if (before.hooks.status === "checked" && !before.hooks.directoryExists) {
      yield* runProcess("pnpm", ["exec", "husky"], ROOT);
    }
    if (before.hooks.status === "checked" && (!before.hooks.directoryExists || !before.hooks.configured)) {
      yield* runProcess("git", ["config", "--local", "core.hooksPath", before.hooks.expected], ROOT);
    }
    const after = yield* inspectRepository("setup", false);
    if (!after.ok) return yield* new RepositoryPrerequisiteError({ receipt: after });
    return { ...after, status: before.actions.length > 0 ? "configured" : "checked", actions: before.actions };
  });
}

export function runRepositoryCommand(
  input: unknown,
): Effect.Effect<RepositoryReceipt, RepositoryError, RepositoryServices> {
  return decodeInput(input).pipe(
    Effect.flatMap((decoded) => decoded.operation === "check"
      ? inspectRepository("check", false)
      : decoded.dryRun
      ? inspectRepository("setup", true)
      : setupRepository()),
  );
}

export const checkRepository = () => runRepositoryCommand({ operation: "check" });

export const setupRepositoryEnvironment = (dryRun: boolean) => runRepositoryCommand({
  operation: "setup",
  dryRun,
});

export const repositoryCommandContribution = Object.freeze({
  name: "repository",
  summary: "Check or configure repository hooks and host prerequisites.",
  input: RepositoryCommandInputSchema,
  run: runRepositoryCommand,
  check: checkRepository,
  setup: setupRepositoryEnvironment,
});
