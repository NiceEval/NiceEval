import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

import type { HarnessAsset } from "./contracts.ts";
import { assertContainedRealDirectory, lstatPath } from "./durable-path.ts";

interface HarnessAssetDefinition {
  readonly source: readonly string[];
  readonly destination: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

const HARNESS_ASSETS: Readonly<Record<HarnessAsset, HarnessAssetDefinition>> = {
  "docker-profile-host-scripts": {
    source: ["packaging", "docker-profile-host", "scripts"],
    destination: [".niceeval-e2e-harness", "docker-profile-host-scripts"],
    environment: {
      NICEEVAL_E2E_DOCKER_PROFILE_HOST_SCRIPTS: ".",
    },
  },
};

export interface MaterializedHarnessAssets {
  readonly assets: readonly HarnessAsset[];
  readonly environment: Readonly<Record<string, string>>;
}

export class HarnessAssetMaterializationError extends Data.TaggedError(
  "HarnessAssetMaterializationError",
)<{
  readonly asset: HarnessAsset;
  readonly operation: "check-destination" | "create-destination" | "copy" | "verify";
  readonly source: string;
  readonly destination: string;
  readonly detail: string;
}> {}

const failure = (
  asset: HarnessAsset,
  operation: HarnessAssetMaterializationError["operation"],
  source: string,
  destination: string,
  cause: unknown,
): HarnessAssetMaterializationError =>
  new HarnessAssetMaterializationError({
    asset,
    operation,
    source,
    destination,
    detail:
      typeof cause === "object" &&
      cause !== null &&
      "detail" in cause &&
      typeof cause.detail === "string"
        ? cause.detail
        : cause instanceof Error
          ? cause.message
          : String(cause),
  });

const copyAssetEntry = (
  fileSystem: FileSystem.FileSystem,
  asset: HarnessAsset,
  source: string,
  destination: string,
): Effect.Effect<void, HarnessAssetMaterializationError> =>
  Effect.gen(function* () {
    const stat = yield* lstatPath(source).pipe(
      Effect.mapError((cause) => failure(asset, "copy", source, destination, cause)),
    );
    if (stat.isSymbolicLink()) {
      return yield* Effect.fail(
        failure(asset, "copy", source, destination, `harness asset source symlink is not allowed: ${source}`),
      );
    }
    if (stat.isFile()) {
      yield* fileSystem.copyFile(source, destination).pipe(
        Effect.mapError((cause) => failure(asset, "copy", source, destination, cause)),
      );
      return;
    }
    if (!stat.isDirectory()) {
      return yield* Effect.fail(
        failure(asset, "copy", source, destination, `harness asset source special file is not allowed: ${source}`),
      );
    }
    yield* fileSystem.makeDirectory(destination, { recursive: true }).pipe(
      Effect.mapError((cause) => failure(asset, "copy", source, destination, cause)),
    );
    const entries = yield* fileSystem.readDirectory(source).pipe(
      Effect.mapError((cause) => failure(asset, "copy", source, destination, cause)),
    );
    for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
      yield* copyAssetEntry(fileSystem, asset, join(source, entry), join(destination, entry));
    }
  });

const materializeOne = (
  checkoutRoot: string,
  isolatedRepo: string,
  asset: HarnessAsset,
): Effect.Effect<
  Readonly<Record<string, string>>,
  HarnessAssetMaterializationError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const definition = HARNESS_ASSETS[asset];
    const source = join(checkoutRoot, ...definition.source);
    const destination = join(isolatedRepo, ...definition.destination);
    const fileSystem = yield* FileSystem.FileSystem;
    const destinationExists = yield* fileSystem.exists(destination).pipe(
      Effect.mapError((cause) =>
        failure(asset, "check-destination", source, destination, cause),
      ),
    );
    if (destinationExists) {
      return yield* Effect.fail(
        failure(
          asset,
          "check-destination",
          source,
          destination,
          "isolated harness asset destination already exists",
        ),
      );
    }

    yield* fileSystem
      .makeDirectory(dirname(destination), { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          failure(asset, "create-destination", source, destination, cause),
        ),
      );
    yield* copyAssetEntry(fileSystem, asset, source, destination);

    const [realRepo, realDestination] = yield* Effect.all(
      [fileSystem.realPath(isolatedRepo), fileSystem.realPath(destination)],
      { concurrency: 2 },
    ).pipe(
      Effect.mapError((cause) =>
        failure(asset, "verify", source, destination, cause),
      ),
    );
    const contained = relative(realRepo, realDestination);
    if (
      contained === "" ||
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained)
    ) {
      return yield* Effect.fail(
        failure(
          asset,
          "verify",
          source,
          destination,
          `materialized asset resolved outside isolated repo: ${realDestination}`,
        ),
      );
    }

    return Object.fromEntries(
      Object.entries(definition.environment).map(([name, assetRelativePath]) => [
        name,
        join(realDestination, assetRelativePath),
      ]),
    );
  });

/** Materialize only the closed set of harness assets declared by one Repo. */
export const materializeHarnessAssets = (
  checkoutRoot: string,
  isolatedRepo: string,
  assets: readonly HarnessAsset[],
): Effect.Effect<
  MaterializedHarnessAssets,
  HarnessAssetMaterializationError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const environments = yield* Effect.forEach(
      assets,
      (asset) => materializeOne(checkoutRoot, isolatedRepo, asset),
      { concurrency: 1 },
    );
    return {
      assets,
      environment: Object.assign({}, ...environments),
    };
  });

/** Reconstruct the same environment for assets already present in a retained copy. */
export const inspectMaterializedHarnessAssets = (
  isolatedRepo: string,
  assets: readonly HarnessAsset[],
): Effect.Effect<
  MaterializedHarnessAssets,
  HarnessAssetMaterializationError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const environments = yield* Effect.forEach(
      assets,
      (asset) => {
        const definition = HARNESS_ASSETS[asset];
        const destination = join(isolatedRepo, ...definition.destination);
        return assertContainedRealDirectory(
          isolatedRepo,
          destination,
          `retained harness asset ${asset}`,
        ).pipe(
          Effect.mapError((cause) =>
            failure(
              asset,
              "verify",
              destination,
              destination,
              cause,
            ),
          ),
          Effect.map((realDestination) =>
            Object.fromEntries(
              Object.entries(definition.environment).map(
                ([name, assetRelativePath]) => [
                  name,
                  join(realDestination, assetRelativePath),
                ],
              ),
            ),
          ),
        );
      },
      { concurrency: 1 },
    );
    return {
      assets,
      environment: Object.assign({}, ...environments),
    };
  });
