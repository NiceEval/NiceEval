import { agentJudgeIdentity, ordinaryJudgeIdentity, selectsOrdinaryJudge } from "./judge-identity.ts";
// ProjectTarget planning: current eval sources + resolved configuration become
// immutable input identities. Reuse is decided only by Frozen Record planning.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Data, Effect } from "effect";
import { captureLinkedRunRenameFingerprintIdentity, liveSandboxPlanningServices } from "../sandbox/plan.ts";
import type { DiscoveredEval, ResolvedJudgeConfig } from "../types.ts";
import type { ProjectCurrentExperimentTarget, ProjectCurrentTarget } from "./project-target.ts";
import { EVALUATION_ALGORITHM, type AgentRun } from "./types.ts";
import { resolveJudge } from "./judge-config.ts";
import {
  prepareRunSandboxes,
  preparedPairsByKey as indexPreparedPairs,
  runPairKey,
  type PreparedRunPair,
  type SandboxRunPlanningError,
} from "./sandbox-selection.ts";
import type { EvalManifest } from "./manifest.ts";
import { configIdentityPaths, configIdentityForRun, type ConfigIdentity } from "./config-identity.ts";
import { adapterIdentity } from "../adapter.ts";
import { hashIdentityPayload as hash, stableIdentityJson as stableJson } from "./execution-identity.ts";
import { resolvePiCodingAgent } from "../judge/pi-dependency.ts";
import { ProjectModuleGraph, evalModules, rootedModuleIdentity } from "./module-graph.ts";

/** Files that participate in a fingerprint are an explicit planning boundary. */
export class FingerprintFileError extends Data.TaggedError("FingerprintFileError")<{
  readonly operation: "read" | "hash";
  readonly path: string;
  readonly message: string;
}> {}

/** A malformed or internally inconsistent planning input must not become a defect. */
export class FingerprintPlanningError extends Data.TaggedError("FingerprintPlanningError")<{
  readonly stage: "configuration" | "invariant";
  readonly message: string;
}> {}

export type FingerprintPlanningFailure = FingerprintFileError | FingerprintPlanningError;
export type FingerprintSourceCache = Map<string, Effect.Effect<string, FingerprintFileError>>;

export function createFingerprintSourceCache(): FingerprintSourceCache {
  return new Map();
}
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function fingerprintFileError(
  operation: FingerprintFileError["operation"],
  path: string,
  cause: unknown,
): FingerprintFileError {
  return new FingerprintFileError({ operation, path, message: messageOf(cause) });
}

function fingerprintPlanningError(stage: FingerprintPlanningError["stage"], cause: unknown): FingerprintPlanningError {
  return new FingerprintPlanningError({ stage, message: messageOf(cause) });
}

function invariant(message: string): FingerprintPlanningError {
  return new FingerprintPlanningError({ stage: "invariant", message });
}

export function cacheKey(run: AgentRun, evalId: string): string {
  if (run.experimentId === undefined) {
    throw new Error("ProjectTarget planning requires a discovered Experiment id.");
  }
  return runPairKey(run.experimentId, evalId);
}

/** Run 级配置身份。所有会改变结果解释口径的实验配置只在 `configIdentityForRun` 里裁决一次。 */
export function computeConfigHash(pair: PreparedRunPair): string {
  return hashConfigIdentity(configIdentityForRun(pair.run, pair.plan));
}

/** 身份对象 → 配置身份哈希。 */
export function hashConfigIdentity(identity: ConfigIdentity): string {
  return hash(identity);
}

/** The only supported projection is the immutable current configuration identity. */
export function computeFingerprint(
  pair: PreparedRunPair,
  sourceCache?: FingerprintSourceCache,
  projection: FingerprintProjection = currentFingerprintProjection(pair),
): Effect.Effect<string, FingerprintPlanningFailure> {
  return Effect.map(fingerprintWithManifest(pair, sourceCache, projection), ({ fingerprint }) => fingerprint);
}

export interface FingerprintProjection {
  readonly _tag: "Current";
  readonly identity: ConfigIdentity;
}

function currentFingerprintProjection(
  pair: PreparedRunPair,
  identity: ConfigIdentity = configIdentityForRun(pair.run, pair.plan),
): FingerprintProjection {
  return { _tag: "Current", identity };
}

/**
 * 指纹与它的可读清单一次算出。两者**同一份输入**:清单不是事后再扫一遍磁盘拼出来的近似,
 * 而是哈希那一刻手里的原料换一种投影(内容换成内容哈希)。分开算迟早分叉,症状是
 * 「`--dry` 说这个文件变了,指纹却相等」。
 *
 * @param projection The immutable current configuration identity.
 */
export function fingerprintWithManifest(
  pair: PreparedRunPair,
  sourceCache?: FingerprintSourceCache,
  projection: FingerprintProjection = currentFingerprintProjection(pair),
): Effect.Effect<
  {
    fingerprint: string;
    manifest: EvalManifest;
    renameFingerprint: (experimentId: string) => string | undefined;
  },
  FingerprintPlanningFailure
> {
  return fingerprintPreparedPair(pair, sourceCache, projection);
}

function fingerprintExperimentLoaderInputs(
  source: AgentRun["experimentExecutionSource"],
  sourceCache: FingerprintSourceCache | undefined,
) {
  const inputs = [
    ["experiment", source?.experimentInputs],
    ["config", source?.configInputs],
  ] as const;
  const files = inputs.flatMap(([scope, paths]) => [
    ...(paths?.paths ?? []).map((file) => ({ scope, kind: "data" as const, file })),
    ...(paths?.criteriaPaths ?? []).map((file) => ({ scope, kind: "criteria" as const, file })),
  ]);
  return Effect.forEach(
    files,
    ({ scope, kind, file }) =>
      Effect.map(cachedContentHash(file, sourceCache), (digest) => ({
        scope,
        kind,
        path: relative(process.cwd(), file),
        digest,
        covered: scope === "experiment" && source?.managedInputDigests[kind].get(file) === digest,
      })),
    { concurrency: "unbounded" },
  );
}

function fingerprintPreparedPair(
  pair: PreparedRunPair,
  sourceCache?: FingerprintSourceCache,
  projection: FingerprintProjection = currentFingerprintProjection(pair),
): Effect.Effect<
  {
    fingerprint: string;
    manifest: EvalManifest;
    renameFingerprint: (experimentId: string) => string | undefined;
  },
  FingerprintPlanningFailure
> {
  return Effect.gen(function* () {
    const { evalDef } = pair;
    const identity = projection.identity;
    const configHash = yield* Effect.try({
      try: () => hashConfigIdentity(identity),
      catch: (cause) => fingerprintPlanningError("configuration", cause),
    });
    const closure =
      evalModules(evalDef) ??
      (yield* Effect.flatMap(cachedRead(evalDef.sourcePath, sourceCache), (source) =>
        Effect.try({
          try: () =>
            new ProjectModuleGraph(process.cwd()).capture(evalDef.sourcePath, { source, stopPaths: undefined }),
          catch: (cause) => fingerprintFileError("read", evalDef.sourcePath, cause),
        }),
      ));
    const normalized = closure.modules.map((fact) => [relative(process.cwd(), fact.path), fact.normalized] as const);
    const source = closure.modules.map((fact) => [relative(process.cwd(), fact.path), fact.identity] as const);
    const sourceGraph = yield* Effect.try({
      try: () => rootedModuleIdentity(closure, { role: "eval" }),
      catch: (cause) => fingerprintFileError("hash", evalDef.sourcePath, cause),
    });
    // Capability-specific runtime identities follow the participating source.
    const selectsAgentJudge = normalized.some(([, content]) => /\bagentJudge\s*\(/u.test(content));
    if (
      selectsAgentJudge &&
      pair.plan._tag === "Sandbox" &&
      (pair.run.sandboxReuse === true || evalDef.evalGroup !== undefined || pair.run.sharedState !== undefined)
    ) {
      return yield* Effect.fail(
        invariant("judge.agent-shared-sandbox: Agent Judge requires an exclusive Attempt Sandbox"),
      );
    }
    const selectsSimulatedUser = normalized.some(([, content]) =>
      /\bdefineSimulatedUser\s*\(|\.simulatedUser\s*\(/u.test(content),
    );
    const piRuntime =
      selectsAgentJudge || selectsSimulatedUser
        ? yield* Effect.sync(() => {
            try {
              const runtime = resolvePiCodingAgent();
              return { piCodingAgent: runtime.codingVersion, piAi: runtime.aiVersion };
            } catch {
              return { piCodingAgent: "uninstalled", piAi: "uninstalled" };
            }
          })
        : undefined;
    const loaderData = yield* Effect.forEach(
      [...(evalDef.loaderDataPaths ?? [])].sort(),
      (path): Effect.Effect<readonly [string, string], FingerprintFileError> =>
        Effect.map(cachedContentHash(path, sourceCache), (digest) => [relative(process.cwd(), path), digest] as const),
      { concurrency: "unbounded" },
    );
    // Audit keeps the registered project-relative names and raw-byte digests.
    // Statically proven locator-only names are removed from identity below.
    const criteria = yield* Effect.forEach(
      [...(evalDef.criteriaPaths ?? [])].sort(),
      (path): Effect.Effect<readonly [string, string], FingerprintFileError> =>
        Effect.map(cachedContentHash(path, sourceCache), (digest) => [relative(process.cwd(), path), digest] as const),
      { concurrency: "unbounded" },
    );
    // Private inputs retain their separate role and their leak-gate paths.
    const privateFiles = yield* Effect.forEach(
      [...(evalDef.privatePaths ?? [])].sort(),
      (path): Effect.Effect<readonly [string, string], FingerprintFileError> =>
        Effect.map(cachedContentHash(path, sourceCache), (digest) => [relative(process.cwd(), path), digest] as const),
      { concurrency: "unbounded" },
    );
    // A static locator's bytes and read position already belong to the frozen
    // module graph. Keep its real path in the audit manifest only. Unproven
    // registrations, including changed bytes, retain their conservative keys.
    const covered = {
      data: new Map<string, string>(),
      criteria: new Map<string, string>(),
      private: new Map<string, string>(),
    };
    for (const fact of closure.modules) {
      for (const input of fact.managedInputs ?? []) {
        if (input.kind === "content" || input.kind === "transfer") continue;
        for (const [path, digest] of input.contentDigests)
          covered[input.kind].set(relative(process.cwd(), path), digest);
      }
    }
    const loaderIdentity = loaderData.filter(([path, digest]) => covered.data.get(path) !== digest);
    const criteriaIdentity = criteria.filter(([path, digest]) => covered.criteria.get(path) !== digest);
    const privateIdentity = privateFiles.filter(([path, digest]) => covered.private.get(path) !== digest);
    const experimentLoaderFiles = yield* fingerprintExperimentLoaderInputs(
      pair.run.experimentExecutionSource,
      sourceCache,
    );
    const experimentLoaderIdentity = experimentLoaderFiles
      .filter(({ covered }) => !covered)
      .map(({ scope, kind, path, digest }) => [scope, kind, path, digest]);
    const plugins = { pair: pair.plugin.pairProjection };
    const niceeval = {
      evaluationAlgorithm: EVALUATION_ALGORITHM,
      ...(selectsAgentJudge ? { agentJudge: { ...agentJudgeIdentity(), ...piRuntime } } : {}),
      ...(selectsSimulatedUser ? { simulatedUser: { behavior: 1, ...piRuntime } } : {}),
      ...(selectsOrdinaryJudge(normalized) ? { ordinaryJudge: ordinaryJudgeIdentity() } : {}),
    };
    const payload = {
      niceeval,
      plugins,
      configHash,
      pairPlan: pair.identity,
      source: sourceGraph,
      ...(pair.run.experimentExecutionSource && { experimentSource: pair.run.experimentExecutionSource.digest }),
      ...(experimentLoaderIdentity.length > 0 ? { experimentLoaderInputs: experimentLoaderIdentity } : {}),
      eval: {
        id: evalDef.id,
        tags: evalDef.tags ?? [],
        metadata: evalDef.metadata ?? {},
        ...(evalDef.evalGroup === undefined
          ? {}
          : {
              group: {
                id: evalDef.evalGroup.id,
                evalIds: [...evalDef.evalGroup.evalIds],
                definitionHash: evalDef.evalGroup.definitionHash,
                onUnavailable: evalDef.evalGroup.onUnavailable,
              },
            }),
      },
      loaderData: loaderIdentity,
      // 没登记判据树的 eval 完全不带这个键:空数组也会改变 payload 的字节,让所有存量结果
      // 一次性作废,而它们的判据面本来什么都没变。
      ...(criteriaIdentity.length > 0 ? { criteria: criteriaIdentity } : {}),
      ...(privateIdentity.length > 0 ? { private: privateIdentity } : {}),
    };
    // timeoutMs(evalDef / run 两处来源)刻意不入哈希:超时上限不改变「结果是什么」,只决定
    // 「等不等得到」,把它掺进指纹会让单纯调高上限也作废全部已完成结果。它由
    // ExecutionReusePlan 的 current eligibility comparison 单独裁决，不参与指纹相等性。
    //
    // 清单与哈希同一份原料:源码面把内容换成内容哈希,数据面直接沿用已经算好的哈希/内容。
    const manifest = yield* Effect.try({
      try: (): EvalManifest => ({
        niceeval,
        config: Object.fromEntries(configIdentityPaths(identity)),
        plan: pair.identity,
        plugins,
        source: {
          ...Object.fromEntries(source),
          ...(pair.run.experimentExecutionSource && {
            [relative(process.cwd(), pair.run.experimentSourcePath)]: pair.run.experimentExecutionSource.digest,
          }),
        },
        data: Object.fromEntries([
          ...loaderData,
          ...criteria,
          ...privateFiles,
          ...experimentLoaderFiles.map(({ path, digest }) => [path, digest]),
        ]),
      }),
      catch: (cause) => fingerprintPlanningError("configuration", cause),
    });
    return yield* Effect.try({
      try: () => {
        const frozenPayload = copyFingerprintInput(payload);
        const fingerprint = hash(frozenPayload);
        const pairPlanForExperiment = captureLinkedRunRenameFingerprintIdentity(pair.plan);
        const originalExperimentId = pair.run.experimentId;
        const capturedPairPlan = pairPlanForExperiment(originalExperimentId);
        const pairPlanMatchesFingerprintInput =
          capturedPairPlan !== undefined && stableJson(capturedPairPlan) === stableJson(frozenPayload.pairPlan);
        const hasOpaqueExperimentBehavior =
          pair.run.setup !== undefined ||
          pair.run.teardown !== undefined ||
          [...pair.plugin.groupLifecycles, ...pair.plugin.evalLifecycles].some(
            (lifecycle) => lifecycle.setup !== undefined || lifecycle.teardown !== undefined,
          );
        const renameFingerprint = (experimentId: string): string | undefined => {
          if (experimentId === originalExperimentId) return fingerprint;
          if (!pairPlanMatchesFingerprintInput || hasOpaqueExperimentBehavior) return undefined;
          const pairPlan = pairPlanForExperiment(experimentId);
          return pairPlan === undefined ? undefined : hash({ ...frozenPayload, pairPlan });
        };
        return { fingerprint, manifest, renameFingerprint };
      },
      catch: (cause) => fingerprintPlanningError("configuration", cause),
    });
  });
}

function cachedRead(path: string, cache?: FingerprintSourceCache): Effect.Effect<string, FingerprintFileError> {
  return cachedFileEffect(path, cache, () =>
    Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => fingerprintFileError("read", path, cause),
    }),
  );
}

/**
 * 判据树文件的内容哈希:流式算,几百个文件上百 MB 的判据树不整读进内存。
 * 与 `cachedRead` 共用同一张表,键加 `criteria:` 前缀——同一个文件可能既被 `loadText` 读入
 * (缓存的是内容)又被 `loadCriteria` 登记(缓存的是哈希),不分开两种值会互相顶掉。
 */
function cachedContentHash(path: string, cache?: FingerprintSourceCache): Effect.Effect<string, FingerprintFileError> {
  const key = `criteria:${path}`;
  return cachedFileEffect(key, cache, () => streamHashEffect(path));
}

function cachedFileEffect(
  key: string,
  cache: FingerprintSourceCache | undefined,
  create: () => Effect.Effect<string, FingerprintFileError>,
): Effect.Effect<string, FingerprintFileError> {
  return Effect.suspend(() => {
    const existing = cache?.get(key);
    if (existing !== undefined) return existing;
    if (cache === undefined) return create();
    return Effect.flatMap(Effect.cached(create()), (memoized) =>
      Effect.andThen(
        Effect.sync(() => {
          cache.set(key, memoized);
        }),
        memoized,
      ),
    );
  });
}

function streamHashEffect(path: string): Effect.Effect<string, FingerprintFileError> {
  return Effect.scoped(
    Effect.acquireRelease(
      Effect.try({
        try: () => createReadStream(path),
        catch: (cause) => fingerprintFileError("hash", path, cause),
      }),
      (stream) =>
        Effect.sync(() => {
          if (!stream.destroyed) stream.destroy();
        }),
    ).pipe(
      Effect.flatMap((stream) =>
        Effect.tryPromise({
          try: async (signal) => {
            const abort = (): void => {
              if (!stream.destroyed) {
                stream.destroy(signal.reason instanceof Error ? signal.reason : undefined);
              }
            };
            if (signal.aborted) abort();
            signal.addEventListener("abort", abort, { once: true });
            try {
              const hasher = createHash("sha256");
              for await (const chunk of stream) hasher.update(chunk as Buffer);
              return hasher.digest("hex");
            } finally {
              signal.removeEventListener("abort", abort);
            }
          },
          catch: (cause) => fingerprintFileError("hash", path, cause),
        }),
      ),
    ),
  );
}

/** 无派发项目规划：身份目标与 runner 后续真正消费的 prepared pair 来自同一产物。 */
export interface ProjectTargetPlan {
  readonly target: ProjectCurrentTarget;
  readonly preparedPairsByKey: ReadonlyMap<string, PreparedRunPair>;
  readonly plannedConfigHashes: ReadonlyMap<string, string>;
  readonly resolvedJudgesByKey: ReadonlyMap<string, ResolvedJudgeConfig | undefined>;
  readonly plannedFingerprints: ReadonlyMap<string, string>;
  readonly renameFingerprintsByKey: ReadonlyMap<string, (experimentId: string) => string | undefined>;
  readonly manifestsByKey: ReadonlyMap<string, EvalManifest>;
  /** 仅供本地 watcher；不会序列化进 Target/report。 */
  readonly watchInputs: readonly string[];
}

/**
 * 只做 discovery 之后的 link + physical identity planning 与 fingerprint；不读 Record，
 * 不调用 setup/create/build/Agent Install，也不决定 reuse/派发。
 */
export function planProjectTarget(
  evals: readonly DiscoveredEval[],
  agentRuns: readonly AgentRun[],
  configTimeoutMs?: number,
  options: {
    readonly configJudge: import("../judge/provider.ts").JudgeProvider | undefined;
    readonly keepSandbox: "failed" | "all" | undefined;
  } = {
    configJudge: undefined,
    keepSandbox: undefined,
  },
): Effect.Effect<ProjectTargetPlan, SandboxRunPlanningError | FingerprintPlanningFailure> {
  return Effect.flatMap(
    prepareRunSandboxes(evals, agentRuns, liveSandboxPlanningServices(), {
      keepSandbox: options.keepSandbox,
      configTimeoutMs,
    }),
    (preparedPairs) =>
      planPreparedProjectTarget(preparedPairs, {
        ...options,
        configTimeoutMs: configTimeoutMs,
      }),
  );
}

/**
 * Freezes identity and fingerprint planning for already linked physical pairs.
 * Project-current reads and explicit adoption share this seam so neither can
 * rebuild the effective Experiment identity with a different projection.
 */
export function planPreparedProjectTarget(
  preparedPairs: readonly PreparedRunPair[],
  options: {
    readonly configJudge: import("../judge/provider.ts").JudgeProvider | undefined;
    readonly keepSandbox: "failed" | "all" | undefined;
    readonly configTimeoutMs: number | undefined;
  },
): Effect.Effect<ProjectTargetPlan, FingerprintPlanningFailure> {
  return Effect.gen(function* () {
    const preparedPairsByKey = yield* Effect.try({
      try: () => indexPreparedPairs(preparedPairs),
      catch: (cause) => fingerprintPlanningError("invariant", cause),
    });
    const sourceCache = createFingerprintSourceCache();
    const plannedFingerprints = new Map<string, string>();
    const renameFingerprintsByKey = new Map<string, (experimentId: string) => string | undefined>();
    const manifestsByKey = new Map<string, EvalManifest>();
    const plannedConfigHashes = new Map<string, string>();
    const resolvedJudgesByKey = new Map<string, ResolvedJudgeConfig | undefined>();
    const runConfigHashes = new Map<string, string>();
    const targetEvals = new Map<string, ProjectCurrentExperimentTarget["evals"][number][]>();

    yield* Effect.forEach(
      preparedPairs,
      (pair) =>
        Effect.gen(function* () {
          const resolvedJudge = yield* Effect.try({
            try: () => resolveJudge(pair.run.judge, pair.evalDef.judge, options.configJudge),
            catch: (cause) => fingerprintPlanningError("configuration", cause),
          });
          resolvedJudgesByKey.set(pair.key, resolvedJudge);
          const identity = yield* Effect.try({
            try: () => configIdentityForRun(pair.run, pair.plan, resolvedJudge),
            catch: (cause) => fingerprintPlanningError("configuration", cause),
          });
          const resultConfigHash = yield* Effect.try({
            try: () => hashConfigIdentity(identity),
            catch: (cause) => fingerprintPlanningError("configuration", cause),
          });
          const runConfigHash = yield* Effect.try({
            try: () => computeConfigHash(pair),
            catch: (cause) => fingerprintPlanningError("configuration", cause),
          });
          const existingRunHash = runConfigHashes.get(pair.run.experimentId);
          if (existingRunHash !== undefined && existingRunHash !== runConfigHash) {
            return yield* Effect.fail(
              invariant(`Run config hash differs across evals for ${JSON.stringify(pair.run.experimentId)}.`),
            );
          }
          runConfigHashes.set(pair.run.experimentId, runConfigHash);
          const { fingerprint, manifest, renameFingerprint } = yield* fingerprintWithManifest(
            pair,
            sourceCache,
            currentFingerprintProjection(pair, identity),
          );
          plannedConfigHashes.set(pair.key, resultConfigHash);
          plannedFingerprints.set(pair.key, fingerprint);
          renameFingerprintsByKey.set(pair.key, renameFingerprint);
          manifestsByKey.set(pair.key, manifest);
          const bucket = targetEvals.get(pair.run.experimentId) ?? [];
          bucket.push({
            id: pair.evalDef.id,
            resultConfigHash,
            fingerprint,
            evaluationKind: pair.evalDef.evaluationKind ?? "pass",
          });
          targetEvals.set(pair.run.experimentId, bucket);
        }),
      { concurrency: "unbounded", discard: true },
    );

    const seenRuns = new Set<AgentRun>();
    const experiments: ProjectCurrentExperimentTarget[] = [];
    for (const pair of preparedPairs) {
      const run = pair.run;
      if (seenRuns.has(run)) continue;
      seenRuns.add(run);
      const runConfigHash = runConfigHashes.get(run.experimentId);
      if (runConfigHash === undefined) continue;
      experiments.push({
        id: run.experimentId,
        runConfigHash,
        attempts: run.attempts,
        adapter: adapterIdentity(run.adapter),
        models: run.models,
        model: run.model,
        reasoningEffort: run.reasoningEffort,
        flags: { ...run.flags },
        labels: run.labels === undefined ? undefined : { ...run.labels },
        description: run.description,
        evals: [...(targetEvals.get(run.experimentId) ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
      });
    }
    const watchInputs = new Set<string>();
    for (const pair of preparedPairs) {
      for (const path of pair.run.experimentExecutionSource?.paths ?? []) watchInputs.add(resolve(path));
      watchInputs.add(resolve(pair.run.experimentSourcePath));
      watchInputs.add(resolve(pair.evalDef.sourcePath));
    }
    for (const manifest of manifestsByKey.values()) {
      for (const path of [...Object.keys(manifest.source), ...Object.keys(manifest.data)]) {
        watchInputs.add(resolve(process.cwd(), path));
      }
    }
    return {
      target: { plannedAt: new Date().toISOString(), experiments },
      preparedPairsByKey: readonlyMapSnapshot(preparedPairsByKey),
      plannedConfigHashes: readonlyMapSnapshot(plannedConfigHashes),
      resolvedJudgesByKey: readonlyMapSnapshot(resolvedJudgesByKey),
      plannedFingerprints: readonlyMapSnapshot(plannedFingerprints),
      renameFingerprintsByKey: readonlyMapSnapshot(renameFingerprintsByKey),
      manifestsByKey: readonlyMapSnapshot(manifestsByKey),
      watchInputs: [...watchInputs].sort(),
    };
  });
}

function readonlyMapSnapshot<Key, Value>(entries: Iterable<readonly [Key, Value]>): ReadonlyMap<Key, Value> {
  const snapshot = new Map(entries);
  let view: ReadonlyMap<Key, Value>;
  view = {
    get size() {
      return snapshot.size;
    },
    get: (key) => snapshot.get(key),
    has: (key) => snapshot.has(key),
    forEach: (callback, thisArg) => snapshot.forEach((value, key) => callback.call(thisArg, value, key, view)),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  };
  return view;
}

// Rename proofs run after planning and must retain the captured author inputs.
function copyFingerprintInput<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => copyFingerprintInput(entry)) as Value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyFingerprintInput(child)])) as Value;
}
