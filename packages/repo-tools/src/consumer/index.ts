import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, FileSystem, Schema } from "effect";

import {
  CandidateManifestSchema,
  ConsumerCommandInputSchema,
  type ConsumerError,
  ConsumerInputError,
  type ConsumerManifest,
  ConsumerManifestError,
  ConsumerManifestSchema,
  ConsumerPathError,
  type ConsumerReceipt,
  ConsumerValidationError,
  ConsumerVerificationError,
} from "./model.js";
import { requireSuccess } from "./process.js";

export * from "./model.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PACKAGE_ROOT = join(ROOT, "packages/niceeval");

type ConsumerServices = FileSystem.FileSystem | import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner;

function decodeInput(input: unknown) {
  return Schema.decodeUnknownEffect(ConsumerCommandInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new ConsumerInputError({
      message: String(error),
    })),
  );
}

function readManifest<S extends Schema.Constraint>(path: string, schema: S) {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(path).pipe(
      Effect.mapError((error) => new ConsumerManifestError({
        path,
        operation: "read",
        message: String(error),
      })),
    );
    const input = yield* Effect.try({
      try: () => JSON.parse(source) as unknown,
      catch: (error) => new ConsumerManifestError({
        path,
        operation: "parse",
        message: error instanceof Error ? error.message : String(error),
      }),
    });
    return yield* Schema.decodeUnknownEffect(schema, { errors: "all" })(input).pipe(
      Effect.mapError((error) => new ConsumerManifestError({
        path,
        operation: "decode",
        message: String(error),
      })),
    );
  });
}

function declaresNiceeval(manifest: ConsumerManifest): boolean {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].some((dependencies) => dependencies !== undefined && Object.hasOwn(dependencies, "niceeval"));
}

function declaredPnpmVersion(manifest: ConsumerManifest): string | undefined {
  if (manifest.packageManager?.startsWith("pnpm@")) return manifest.packageManager.slice("pnpm@".length);
  const manager = manifest.devEngines?.packageManager;
  return manager?.name === "pnpm" ? manager.version : undefined;
}

function directory(path: string): Effect.Effect<boolean, ConsumerPathError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(path).pipe(
      Effect.mapError((error) => new ConsumerPathError({ path, message: String(error) })),
    ))) return false;
    const info = yield* fs.stat(path).pipe(
      Effect.mapError((error) => new ConsumerPathError({ path, message: String(error) })),
    );
    return info.type === "Directory";
  });
}

function realPath(path: string): Effect.Effect<string, ConsumerPathError, FileSystem.FileSystem> {
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.realPath(path)).pipe(
    Effect.mapError((error) => new ConsumerPathError({ path, message: String(error) })),
  );
}

function inspectConsumer(
  requested: string,
  operation: "check" | "link",
  dryRun: boolean,
): Effect.Effect<ConsumerReceipt, ConsumerError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const requestedRoot = isAbsolute(requested) ? requested : resolve(ROOT, requested);
    if (!(yield* directory(requestedRoot))) {
      return yield* new ConsumerPathError({ path: requestedRoot, message: "consumer directory does not exist" });
    }
    const [sourceRoot, consumerRoot] = yield* Effect.all([realPath(ROOT), realPath(requestedRoot)]);
    if (sourceRoot === consumerRoot) {
      return yield* new ConsumerPathError({
        path: consumerRoot,
        message: "consumer must be different from the NiceEval checkout",
      });
    }
    const consumerManifest = yield* readManifest(join(consumerRoot, "package.json"), ConsumerManifestSchema);
    const candidateManifest = yield* readManifest(join(PACKAGE_ROOT, "package.json"), CandidateManifestSchema);
    const installedNodeModules = yield* directory(join(consumerRoot, "node_modules"));
    const installedNiceeval = join(consumerRoot, "node_modules/niceeval");
    const hasInstalledNiceeval = installedNodeModules && (yield* fs.exists(installedNiceeval).pipe(
      Effect.mapError((error) => new ConsumerPathError({ path: installedNiceeval, message: String(error) })),
    ));
    const currentNiceevalRoot = hasInstalledNiceeval ? yield* realPath(installedNiceeval) : undefined;
    const declared = declaresNiceeval(consumerManifest);
    const problems = [
      ...(declared ? [] : ["consumer package.json does not declare niceeval"]),
      ...(installedNodeModules ? [] : ["consumer dependencies are not installed"]),
      ...(candidateManifest.name === "niceeval" ? [] : [`candidate package name is ${candidateManifest.name}, expected niceeval`]),
    ];
    return {
      domain: "consumer",
      operation,
      dryRun,
      ok: problems.length === 0,
      candidate: {
        name: candidateManifest.name,
        version: candidateManifest.version,
        sourceRoot: yield* realPath(PACKAGE_ROOT),
      },
      consumer: {
        name: consumerManifest.name ?? basename(consumerRoot),
        root: consumerRoot,
        ...(declaredPnpmVersion(consumerManifest) === undefined
          ? {}
          : { pnpmVersion: declaredPnpmVersion(consumerManifest) }),
        declaresNiceeval: declared,
        nodeModulesInstalled: installedNodeModules,
        ...(currentNiceevalRoot === undefined ? {} : { currentNiceevalRoot }),
      },
      actions: operation === "link"
        ? ["build package", "build package index", "pack candidate", "link candidate into consumer", "verify resolved link"]
        : [],
      problems,
    };
  });
}

function sha256(path: string): Effect.Effect<string, ConsumerPathError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs.readFile(path).pipe(
      Effect.mapError((error) => new ConsumerPathError({ path, message: String(error) })),
    );
    return createHash("sha256").update(bytes).digest("hex");
  });
}

function linkConsumer(requested: string): Effect.Effect<ConsumerReceipt, ConsumerError, ConsumerServices> {
  return Effect.gen(function*() {
    const inspected = yield* inspectConsumer(requested, "link", false);
    if (!inspected.ok) return yield* new ConsumerValidationError({ receipt: inspected });
    const fs = yield* FileSystem.FileSystem;

    yield* requireSuccess("pnpm", ["run", "build:package"], ROOT);
    yield* requireSuccess("pnpm", ["run", "build:index"], ROOT);

    return yield* Effect.scoped(Effect.gen(function*() {
      const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-consumer-link-" }).pipe(
        Effect.mapError((error) => new ConsumerPathError({ path: ROOT, message: String(error) })),
      );
      yield* requireSuccess("pnpm", [
        "--config.ignore-scripts=true",
        "pack",
        "--pack-destination",
        scratch,
      ], PACKAGE_ROOT);
      const entries = yield* fs.readDirectory(scratch).pipe(
        Effect.mapError((error) => new ConsumerPathError({ path: scratch, message: String(error) })),
      );
      const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
      if (tarballs.length !== 1) {
        return yield* new ConsumerPathError({
          path: scratch,
          message: `pack produced ${tarballs.length} tarballs; expected exactly one`,
        });
      }
      const tarball = join(scratch, tarballs[0] ?? "");
      const digest = yield* sha256(tarball);
      const version = inspected.consumer.pnpmVersion;
      if (version === undefined) {
        yield* requireSuccess("pnpm", ["link", PACKAGE_ROOT], inspected.consumer.root);
      } else {
        yield* requireSuccess("corepack", [`pnpm@${version}`, "link", PACKAGE_ROOT], inspected.consumer.root);
      }
      const installed = yield* realPath(join(inspected.consumer.root, "node_modules/niceeval"));
      const expected = yield* realPath(PACKAGE_ROOT);
      if (installed !== expected) return yield* new ConsumerVerificationError({ expected, actual: installed });
      return {
        ...inspected,
        ok: true,
        candidate: { ...inspected.candidate, sha256: digest },
        consumer: { ...inspected.consumer, currentNiceevalRoot: installed },
      };
    }));
  });
}

export function runConsumerCommand(
  input: unknown,
): Effect.Effect<ConsumerReceipt, ConsumerError, ConsumerServices> {
  return decodeInput(input).pipe(
    Effect.flatMap((decoded) => decoded.operation === "check"
      ? inspectConsumer(decoded.consumer, "check", false)
      : decoded.dryRun
      ? inspectConsumer(decoded.consumer, "link", true)
      : linkConsumer(decoded.consumer)),
  );
}

export const checkConsumer = (consumer: string) => runConsumerCommand({
  operation: "check",
  consumer,
});

export const linkConsumerCandidate = (consumer: string, dryRun: boolean) => runConsumerCommand({
  operation: "link",
  consumer,
  dryRun,
});

export const consumerCommandContribution = Object.freeze({
  name: "consumer",
  summary: "Check a consumer or build and link the current NiceEval candidate.",
  input: ConsumerCommandInputSchema,
  run: runConsumerCommand,
  check: checkConsumer,
  link: linkConsumerCandidate,
});
