// ProjectTarget planning: current eval sources + resolved configuration become
// immutable input identities. Reuse is decided only by Frozen Record planning.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { Data, Effect } from "effect";
import { liveSandboxPlanningServices } from "../sandbox/plan.ts";
import type { DiscoveredEval, ResolvedJudgeConfig } from "../types.ts";
import type {
  ProjectCurrentExperimentTarget,
  ProjectCurrentTarget,
} from "./project-target.ts";
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
import {
  FINGERPRINT_ALGORITHM_VERSION,
  FINGERPRINT_COVERAGE_VERSION,
} from "../record/manifest.ts";
import {
  configIdentityPaths,
  configIdentityForRun,
  type ConfigIdentity,
} from "./config-identity.ts";

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

function fingerprintPlanningError(
  stage: FingerprintPlanningError["stage"],
  cause: unknown,
): FingerprintPlanningError {
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
  return Object.freeze({ _tag: "Current", identity });
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
  { fingerprint: string; manifest: EvalManifest },
  FingerprintPlanningFailure
> {
  return fingerprintPreparedPair(pair, sourceCache, projection);
}

function fingerprintPreparedPair(
  pair: PreparedRunPair,
  sourceCache?: FingerprintSourceCache,
  projection: FingerprintProjection = currentFingerprintProjection(pair),
): Effect.Effect<{ fingerprint: string; manifest: EvalManifest }, FingerprintPlanningFailure> {
  return Effect.gen(function* () {
    const { evalDef } = pair;
    const identity = projection.identity;
    const configHash = yield* Effect.try({
      try: () => hashConfigIdentity(identity),
      catch: (cause) => fingerprintPlanningError("configuration", cause),
    });
    const source = yield* sourceClosure(evalDef, sourceCache);
    const loaderData = yield* Effect.forEach(
      [...(evalDef.loaderDataPaths ?? [])].sort(),
      (path): Effect.Effect<readonly [string, string], FingerprintFileError> =>
        Effect.map(cachedRead(path, sourceCache), (content) => [relative(process.cwd(), path), content] as const),
      { concurrency: "unbounded" },
    );
  // 判据树(loadCriteria 登记)进的是「项目根相对路径 × 内容流式哈希」对:内容从不进内存,
  // 权限位与 mtime 不参与,所以重新 clone 一份工作树不作废。增删文件与改一字节同等作废——
  // 前者改的是这张对表的成员,后者改的是某一项的哈希。
    const criteria = yield* Effect.forEach(
      [...(evalDef.criteriaPaths ?? [])].sort(),
      (path): Effect.Effect<readonly [string, string], FingerprintFileError> =>
        Effect.map(cachedContentHash(path, sourceCache), (digest) => [relative(process.cwd(), path), digest] as const),
      { concurrency: "unbounded" },
    );
  // private 与 criteria 同口径(路径 × 流式内容哈希),分键存放——混进 criteria 会让
  // 「只改 private」与「只改 verifier」在指纹上无法区分,也让存量无 private 的结果一次性作废。
    const privateFiles = yield* Effect.forEach(
      [...(evalDef.privatePaths ?? [])].sort(),
      (path): Effect.Effect<readonly [string, string], FingerprintFileError> =>
        Effect.map(cachedContentHash(path, sourceCache), (digest) => [relative(process.cwd(), path), digest] as const),
      { concurrency: "unbounded" },
    );
    const plugins = Object.freeze({ pair: pair.plugin.pairProjection });
    const payload = {
      evaluationAlgorithm: EVALUATION_ALGORITHM,
      plugins,
      configHash,
      pairPlan: pair.identity,
      source,
      eval: {
        id: evalDef.id,
        tags: evalDef.tags ?? [],
        metadata: evalDef.metadata ?? {},
        ...(evalDef.evalGroup === undefined ? {} : { group: {
          id: evalDef.evalGroup.id,
          evalIds: [...evalDef.evalGroup.evalIds],
          definitionHash: evalDef.evalGroup.definitionHash,
          onUnavailable: evalDef.evalGroup.onUnavailable,
        } }),
      },
      loaderData,
    // 没登记判据树的 eval 完全不带这个键:空数组也会改变 payload 的字节,让所有存量结果
    // 一次性作废,而它们的判据面本来什么都没变。
      ...(criteria.length > 0 ? { criteria } : {}),
      ...(privateFiles.length > 0 ? { private: privateFiles } : {}),
    };
  // timeoutMs(evalDef / run 两处来源)刻意不入哈希:超时上限不改变「结果是什么」,只决定
  // 「等不等得到」,把它掺进指纹会让单纯调高上限也作废全部已完成结果。它由
  // ExecutionReusePlan 的 current eligibility comparison 单独裁决，不参与指纹相等性。
  //
  // 清单与哈希同一份原料:源码面把内容换成内容哈希,数据面直接沿用已经算好的哈希/内容。
    const manifest = yield* Effect.try({
      try: (): EvalManifest => Object.freeze({
        algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
        coverageVersion: FINGERPRINT_COVERAGE_VERSION,
        config: Object.freeze(Object.fromEntries(configIdentityPaths(identity))),
        plan: pair.identity,
        plugins,
        source: Object.freeze(Object.fromEntries(source.map(([path, content]) => [path, hashText(content)]))),
        data: Object.freeze(Object.fromEntries([
          ...loaderData.map(([path, content]) => [path, hashText(content)]),
          ...criteria,
          ...privateFiles,
        ])),
      }),
      catch: (cause) => fingerprintPlanningError("configuration", cause),
    });
    return yield* Effect.try({
      try: () => ({ fingerprint: hash(payload), manifest }),
      catch: (cause) => fingerprintPlanningError("configuration", cause),
    });
  });
}

function cachedRead(
  path: string,
  cache?: FingerprintSourceCache,
): Effect.Effect<string, FingerprintFileError> {
  return cachedFileEffect(path, cache, () => Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => fingerprintFileError("read", path, cause),
  }));
}

/**
 * 判据树文件的内容哈希:流式算,几百个文件上百 MB 的判据树不整读进内存。
 * 与 `cachedRead` 共用同一张表,键加 `criteria:` 前缀——同一个文件可能既被 `loadText` 读入
 * (缓存的是内容)又被 `loadCriteria` 登记(缓存的是哈希),不分开两种值会互相顶掉。
 */
function cachedContentHash(
  path: string,
  cache?: FingerprintSourceCache,
): Effect.Effect<string, FingerprintFileError> {
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
      ));
  });
}

function streamHashEffect(path: string): Effect.Effect<string, FingerprintFileError> {
  return Effect.scoped(
    Effect.acquireRelease(
      Effect.try({
        try: () => createReadStream(path),
        catch: (cause) => fingerprintFileError("hash", path, cause),
      }),
      (stream) => Effect.sync(() => {
        if (!stream.destroyed) stream.destroy();
      }),
    ).pipe(
      Effect.flatMap((stream) => Effect.tryPromise({
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
      })),
    ),
  );
}

/** 项目内静态 import 图；外部包和动态 import 有意不进入闭包。 */
function sourceClosure(
  evalDef: DiscoveredEval,
  cache?: FingerprintSourceCache,
): Effect.Effect<Array<[string, string]>, FingerprintFileError> {
  const root = process.cwd();
  const visited = new Set<string>();
  const files: Array<[string, string]> = [];
  const visit = (path: string): Effect.Effect<void, FingerprintFileError> => Effect.gen(function* () {
    const absolute = resolve(path);
    if (visited.has(absolute) || (!absolute.startsWith(`${root}/`) && absolute !== root)) return;
    visited.add(absolute);
    const content = yield* cachedRead(absolute, cache);
    files.push([relative(root, absolute), content]);
    const specs = [...content.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)]
      .flatMap((match) => match[1] === undefined ? [] : [match[1]]);
    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const resolved = yield* resolveModule(dirname(absolute), spec);
      if (resolved) yield* visit(resolved);
    }
  });
  return Effect.andThen(
    visit(evalDef.sourcePath),
    Effect.sync(() => files.sort(([a], [b]) => a.localeCompare(b))),
  );
}

function resolveModule(from: string, specifier: string): Effect.Effect<string | undefined> {
  const raw = resolve(from, specifier);
  const candidates = extname(raw) ? [raw] : [raw, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"].map((ext) => `${raw}${ext}`), ...["index.ts", "index.tsx", "index.js"].map((name) => resolve(raw, name))];
  const findAt = (index: number): Effect.Effect<string | undefined> => {
    const candidate = candidates[index];
    if (candidate === undefined) return Effect.succeed(undefined);
    return Effect.tryPromise({
      try: () => stat(candidate),
      // Existing behavior intentionally treats every stat failure as a missed candidate.
      catch: (cause) => fingerprintFileError("read", candidate, cause),
    }).pipe(
      Effect.flatMap((info) => info?.isFile() ? Effect.succeed(candidate) : findAt(index + 1)),
      Effect.catch(() => findAt(index + 1)),
    );
  };
  return findAt(0);
}

/** 无派发项目规划：身份目标与 runner 后续真正消费的 prepared pair 来自同一产物。 */
export interface ProjectTargetPlan {
  readonly target: ProjectCurrentTarget;
  readonly preparedPairsByKey: ReadonlyMap<string, PreparedRunPair>;
  readonly plannedConfigHashes: ReadonlyMap<string, string>;
  readonly resolvedJudgesByKey: ReadonlyMap<string, ResolvedJudgeConfig | undefined>;
  readonly plannedFingerprints: ReadonlyMap<string, string>;
  readonly manifestsByKey: ReadonlyMap<string, EvalManifest>;
  /** 仅供本地 watcher；不会序列化进 Target/report。 */
  readonly watchInputs: readonly string[];
}

/**
 * 只做 discovery 之后的 link + physical identity planning 与 fingerprint；不读 Record，
 * 不调用 setup/create/build/Agent Ensure，也不决定 reuse/派发。
 */
export function planProjectTarget(
  evals: readonly DiscoveredEval[],
  agentRuns: readonly AgentRun[],
  configTimeoutMs?: number,
  options: {
    readonly configJudge?: import("../types.ts").JudgeConfig;
    readonly keepSandbox?: "failed" | "all";
  } = {},
): Effect.Effect<ProjectTargetPlan, SandboxRunPlanningError | FingerprintPlanningFailure> {
  return Effect.flatMap(
    prepareRunSandboxes(evals, agentRuns, liveSandboxPlanningServices(), {
      ...(options.keepSandbox === undefined ? {} : { keepSandbox: options.keepSandbox }),
      ...(configTimeoutMs === undefined ? {} : { configTimeoutMs }),
    }),
    (preparedPairs) => planPreparedProjectTarget(preparedPairs, options),
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
    readonly configJudge?: import("../types.ts").JudgeConfig;
    readonly keepSandbox?: "failed" | "all";
  },
): Effect.Effect<ProjectTargetPlan, FingerprintPlanningFailure> {
  return Effect.gen(function* () {
    const preparedPairsByKey = yield* Effect.try({
      try: () => indexPreparedPairs(preparedPairs),
      catch: (cause) => fingerprintPlanningError("invariant", cause),
    });
    const sourceCache = createFingerprintSourceCache();
    const plannedFingerprints = new Map<string, string>();
    const manifestsByKey = new Map<string, EvalManifest>();
    const plannedConfigHashes = new Map<string, string>();
    const resolvedJudgesByKey = new Map<string, ResolvedJudgeConfig | undefined>();
    const runConfigHashes = new Map<string, string>();
    const targetEvals = new Map<string, ProjectCurrentExperimentTarget["evals"][number][]>();

    yield* Effect.forEach(
      preparedPairs,
      (pair) => Effect.gen(function* () {
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
          return yield* Effect.fail(invariant(
            `Run config hash differs across evals for ${JSON.stringify(pair.run.experimentId)}.`,
          ));
        }
        runConfigHashes.set(pair.run.experimentId, runConfigHash);
        const { fingerprint, manifest } = yield* fingerprintWithManifest(
          pair,
          sourceCache,
          currentFingerprintProjection(pair, identity),
        );
        plannedConfigHashes.set(pair.key, resultConfigHash);
        plannedFingerprints.set(pair.key, fingerprint);
        manifestsByKey.set(pair.key, manifest);
        const bucket = targetEvals.get(pair.run.experimentId) ?? [];
        bucket.push(Object.freeze({
          id: pair.evalDef.id,
          resultConfigHash,
          fingerprint,
          evaluationKind: pair.evalDef.evaluationKind ?? "pass",
        }));
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
      experiments.push(Object.freeze({
        id: run.experimentId,
        runConfigHash,
        attempts: run.attempts,
        agent: run.agent.name,
        ...(run.model !== undefined ? { model: run.model } : {}),
        ...(run.reasoningEffort !== undefined ? { reasoningEffort: run.reasoningEffort } : {}),
        flags: Object.freeze({ ...run.flags }),
        ...(run.labels !== undefined ? { labels: Object.freeze({ ...run.labels }) } : {}),
        ...(run.description !== undefined ? { description: run.description } : {}),
        evals: Object.freeze([...(targetEvals.get(run.experimentId) ?? [])].sort((a, b) => a.id.localeCompare(b.id))),
      }));
    }
    const watchInputs = new Set<string>();
    for (const pair of preparedPairs) {
      watchInputs.add(resolve(pair.run.experimentSourcePath));
      watchInputs.add(resolve(pair.evalDef.sourcePath));
    }
    for (const manifest of manifestsByKey.values()) {
      for (const path of [...Object.keys(manifest.source), ...Object.keys(manifest.data)]) {
        watchInputs.add(resolve(process.cwd(), path));
      }
    }
    return Object.freeze({
      target: Object.freeze({ plannedAt: new Date().toISOString(), experiments: Object.freeze(experiments) }),
      preparedPairsByKey: readonlyMapSnapshot(preparedPairsByKey),
      plannedConfigHashes: readonlyMapSnapshot(plannedConfigHashes),
      resolvedJudgesByKey: readonlyMapSnapshot(resolvedJudgesByKey),
      plannedFingerprints: readonlyMapSnapshot(plannedFingerprints),
      manifestsByKey: readonlyMapSnapshot(manifestsByKey),
      watchInputs: Object.freeze([...watchInputs].sort()),
    });
  });
}

function readonlyMapSnapshot<Key, Value>(
  entries: Iterable<readonly [Key, Value]>,
): ReadonlyMap<Key, Value> {
  const snapshot = new Map(entries);
  let view: ReadonlyMap<Key, Value>;
  view = {
    get size() { return snapshot.size; },
    get: (key) => snapshot.get(key),
    has: (key) => snapshot.has(key),
    forEach: (callback, thisArg) => snapshot.forEach((value, key) => callback.call(thisArg, value, key, view)),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  };
  return Object.freeze(view);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/** folder-local source 进指纹时只留纯数据面(brand 不参与)。 */
/** 文本内容哈希:manifest 的源码面/数据面把「内容」换成「内容哈希」时用的唯一口径。 */
function hashText(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 键序稳定的 JSON 序列化(对象键排序),保证同一 payload 永远同一指纹。 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}
