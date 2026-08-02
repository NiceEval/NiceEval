// 指纹缓存:用 (eval 源码 + 运行配置) 的稳定哈希标识一次 attempt 的输入。
// 上次 passed 且指纹未变的 (experimentId, evalId) 组合可以直接携入,不再重跑。

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { Effect } from "effect";
import { linkedRunCarryEligible, liveSandboxPlanningServices } from "../sandbox/plan.ts";
import type { DiscoveredEval, EvalResult } from "../types.ts";
import type { AgentRun } from "./types.ts";
import { resolveJudge } from "./judge-config.ts";
import {
  prepareRunSandboxes,
  preparedPairsByKey as indexPreparedPairs,
  runPairKey,
  type PreparedRunPair,
  type SandboxRunPlanningError,
} from "./sandbox-selection.ts";
import {
  manifestDeltas,
  OPAQUE_SELECTOR,
  type EvalManifest,
  type FingerprintDelta,
} from "./manifest.ts";
import {
  configIdentityPaths,
  configIdentityForRun,
  configIdentityFromResult,
  counterfactualConfigIdentity,
  type ConfigIdentity,
} from "./config-identity.ts";

export function cacheKey(run: AgentRun, evalId: string): string {
  if (run.experimentId === undefined) {
    throw new Error("Carry planning requires a discovered Experiment id.");
  }
  return runPairKey(run.experimentId, evalId);
}

/** Run 级配置身份。所有会改变结果解释口径的实验配置只在 `configIdentityForRun` 里裁决一次。 */
export function computeConfigHash(pair: PreparedRunPair): string {
  return hashConfigIdentity(configIdentityForRun(pair.run, pair.plan));
}

/** 身份对象 → 配置身份哈希;反事实重算(`--accept`)与正常路径共用同一个序列化口径。 */
export function hashConfigIdentity(identity: ConfigIdentity): string {
  return hash(identity);
}

/**
 * @param projection 正常重算是 `Current`；`--accept` 按换回历史值的身份重算时显式传
 * `Counterfactual`。两条路径不能拼一袋互相矛盾的 optional override。
 */
export async function computeFingerprint(
  pair: PreparedRunPair,
  sourceCache?: Map<string, Promise<string>>,
  projection: FingerprintProjection = currentFingerprintProjection(pair),
): Promise<string> {
  return (await fingerprintWithManifest(pair, sourceCache, projection)).fingerprint;
}

export type FingerprintProjection =
  | {
      readonly _tag: "Current";
      readonly identity: ConfigIdentity;
      readonly carryEpoch: string;
    }
  | {
      readonly _tag: "Counterfactual";
      readonly identity: ConfigIdentity;
      readonly carryEpoch: string;
    };

function currentFingerprintProjection(
  pair: PreparedRunPair,
  identity: ConfigIdentity = configIdentityForRun(pair.run, pair.plan),
  carryEpoch: string = randomUUID(),
): FingerprintProjection {
  return Object.freeze({ _tag: "Current", identity, carryEpoch });
}

function counterfactualFingerprintProjection(
  identity: ConfigIdentity,
  carryEpoch: string,
): FingerprintProjection {
  return Object.freeze({ _tag: "Counterfactual", identity, carryEpoch });
}

/**
 * 指纹与它的可读清单一次算出。两者**同一份输入**:清单不是事后再扫一遍磁盘拼出来的近似,
 * 而是哈希那一刻手里的原料换一种投影(内容换成内容哈希)。分开算迟早分叉,症状是
 * 「`--dry` 说这个文件变了,指纹却相等」。
 *
 * @param projection 语义见 `computeFingerprint`；反事实路径只要指纹，清单照常一并算出，
 * 但调用方通常丢弃。
 */
export async function fingerprintWithManifest(
  pair: PreparedRunPair,
  sourceCache?: Map<string, Promise<string>>,
  projection: FingerprintProjection = currentFingerprintProjection(pair),
): Promise<{ fingerprint: string; manifest: EvalManifest }> {
  return fingerprintPreparedPair(pair, sourceCache, projection);
}

async function fingerprintPreparedPair(
  pair: PreparedRunPair,
  sourceCache?: Map<string, Promise<string>>,
  projection: FingerprintProjection = currentFingerprintProjection(pair),
): Promise<{ fingerprint: string; manifest: EvalManifest }> {
  const { evalDef, run, plan } = pair;
  const identity = projection.identity;
  const configHash = hashConfigIdentity(identity);
  const source = await sourceClosure(evalDef, sourceCache);
  const loaderData = await Promise.all(
    [...(evalDef.loaderDataPaths ?? [])].sort().map(
      async (path): Promise<readonly [string, string]> =>
        [relative(process.cwd(), path), await cachedRead(path, sourceCache)],
    ),
  );
  // 判据树(loadCriteria 登记)进的是「项目根相对路径 × 内容流式哈希」对:内容从不进内存,
  // 权限位与 mtime 不参与,所以重新 clone 一份工作树不作废。增删文件与改一字节同等作废——
  // 前者改的是这张对表的成员,后者改的是某一项的哈希。
  const criteria = await Promise.all(
    [...(evalDef.criteriaPaths ?? [])].sort().map(
      async (path): Promise<readonly [string, string]> =>
        [relative(process.cwd(), path), await cachedContentHash(path, sourceCache)],
    ),
  );
  // private 与 criteria 同口径(路径 × 流式内容哈希),分键存放——混进 criteria 会让
  // 「只改 private」与「只改 verifier」在指纹上无法区分,也让存量无 private 的结果一次性作废。
  const privateFiles = await Promise.all(
    [...(evalDef.privatePaths ?? [])].sort().map(
      async (path): Promise<readonly [string, string]> =>
        [relative(process.cwd(), path), await cachedContentHash(path, sourceCache)],
    ),
  );
  const payload = {
    configHash,
    pairPlan: pair.identity,
    source,
    eval: {
      id: evalDef.id,
      tags: evalDef.tags ?? [],
      metadata: evalDef.metadata ?? {},
    },
    ...(plan._tag === "Sandbox" && !linkedRunCarryEligible(plan)
      ? { sandboxCommandCarryEpoch: projection.carryEpoch }
      : {}),
    loaderData,
    // 没登记判据树的 eval 完全不带这个键:空数组也会改变 payload 的字节,让所有存量结果
    // 一次性作废,而它们的判据面本来什么都没变。
    ...(criteria.length > 0 ? { criteria } : {}),
    ...(privateFiles.length > 0 ? { private: privateFiles } : {}),
  };
  // timeoutMs(evalDef / run 两处来源)刻意不入哈希:超时上限不改变「结果是什么」,只决定
  // 「等不等得到」,把它掺进指纹会让单纯调高上限也作废全部已完成结果。它改用 planCarry 里的
  // 携带资格判据(durationMs ≤ 当前 resolved timeoutMs)参与,而不是指纹相等性
  // (见 docs/runner.md「缓存:指纹去重」)。
  //
  // 清单与哈希同一份原料:源码面把内容换成内容哈希,数据面直接沿用已经算好的哈希/内容。
  const manifest: EvalManifest = Object.freeze({
    config: Object.freeze(Object.fromEntries(configIdentityPaths(identity))),
    plan: pair.identity,
    source: Object.freeze(Object.fromEntries(source.map(([path, content]) => [path, hashText(content)]))),
    data: Object.freeze(Object.fromEntries([
      ...loaderData.map(([path, content]) => [path, hashText(content)]),
      ...criteria,
      ...privateFiles,
    ])),
  });
  return { fingerprint: hash(payload), manifest };
}

async function cachedRead(path: string, cache?: Map<string, Promise<string>>): Promise<string> {
  let pending = cache?.get(path);
  if (!pending) {
    pending = readFile(path, "utf8");
    cache?.set(path, pending);
  }
  return pending;
}

/**
 * 判据树文件的内容哈希:流式算,几百个文件上百 MB 的判据树不整读进内存。
 * 与 `cachedRead` 共用同一张表,键加 `criteria:` 前缀——同一个文件可能既被 `loadText` 读入
 * (缓存的是内容)又被 `loadCriteria` 登记(缓存的是哈希),不分开两种值会互相顶掉。
 */
async function cachedContentHash(path: string, cache?: Map<string, Promise<string>>): Promise<string> {
  const key = `criteria:${path}`;
  let pending = cache?.get(key);
  if (!pending) {
    pending = streamHash(path);
    cache?.set(key, pending);
  }
  return pending;
}

async function streamHash(path: string): Promise<string> {
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk as Buffer);
  return hasher.digest("hex");
}

/** 项目内静态 import 图；外部包和动态 import 有意不进入闭包。 */
async function sourceClosure(evalDef: DiscoveredEval, cache?: Map<string, Promise<string>>): Promise<Array<[string, string]>> {
  const root = process.cwd();
  const visited = new Set<string>();
  const files: Array<[string, string]> = [];
  const visit = async (path: string): Promise<void> => {
    const absolute = resolve(path);
    if (visited.has(absolute) || !absolute.startsWith(`${root}/`) && absolute !== root) return;
    visited.add(absolute);
    const content = await cachedRead(absolute, cache);
    files.push([relative(root, absolute), content]);
    const specs = [...content.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)]
      .flatMap((match) => match[1] === undefined ? [] : [match[1]]);
    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const resolved = await resolveModule(dirname(absolute), spec);
      if (resolved) await visit(resolved);
    }
  };
  await visit(evalDef.sourcePath);
  return files.sort(([a], [b]) => a.localeCompare(b));
}

async function resolveModule(from: string, specifier: string): Promise<string | undefined> {
  const raw = resolve(from, specifier);
  const candidates = extname(raw) ? [raw] : [raw, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"].map((ext) => `${raw}${ext}`), ...["index.ts", "index.tsx", "index.js"].map((name) => resolve(raw, name))];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // 尝试下一个扩展名。
    }
  }
  return undefined;
}

/**
 * 携带的六道门(docs/feature/experiments/cache.md「携带要过的门」)加上「无历史」。
 * `--dry --json` 的 `ExpPlanDispatch.gate` 用这套词。
 */
export type CarryGate = "terminal" | "fingerprint" | "eligibility" | "origin" | "rerun" | "mode" | "missing";

/**
 * 同一道门的人读词(`--dry` 计划行尾);模式门按两个来源分成两个词,缺历史门按「真没有」与
 * 「有但格式读不动」分成两个词——后者是 `incompatible`,把「上一版写的结果还躺在盘上」
 * 与「这条 eval 从没跑过」区分开(判定见 `CarryGateOptions.incompatibleKeys`)。
 */
export type DispatchReason =
  | "errored"
  | "stale"
  | "exceeds-timeout"
  | "reused-origin"
  | "rerun"
  | "sandbox-reuse"
  | "rolling-state"
  | "keep-sandbox"
  | "incompatible"
  | "new";

/** 一条 (experiment, eval) 行里,卡在同一道门上的那些 attempt 序号。 */
export interface DispatchGroup {
  readonly gate: CarryGate;
  readonly reason: DispatchReason;
  /** 这组原因覆盖的 attempt 序号(0-based,升序)。 */
  readonly attempts: readonly number[];
  /** 指纹门的差异明细(manifest 相减);历史侧缺清单时是唯一一条 `opaque:no-manifest`。 */
  readonly deltas?: readonly FingerprintDelta[];
}

export interface CarryPlan {
  /** discovery/selector/link/physical planning 的唯一完成态；run/attempt 不再二次选择或重建。 */
  readonly preparedPairsByKey: ReadonlyMap<string, PreparedRunPair>;
  /** `cacheKey(run, evalId)` → Run 级配置身份。 */
  readonly plannedConfigHashes: ReadonlyMap<string, string>;
  /** `cacheKey(run, evalId)` → 本次规划出的指纹,供调用方按同一口径判断"这条要不要携入"。 */
  readonly plannedFingerprints: ReadonlyMap<string, string>;
  /**
   * `cacheKey(run, evalId)` → 这条组合**可以携带的全部指纹**:本次规划的那个,加上
   * 「只在 provenance flag 上与本次不同」的历史口径(见 `acceptableFingerprints`)。
   * 没声明 provenance flag 时恒是单元素集合 = `plannedFingerprints` 的那一个。
   * 携带判定一律读这个集合,`plannedFingerprints` 只用来给新跑的 attempt 落盘打戳。
   */
  readonly acceptableFingerprints: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * 携带以 attempt 为粒度:命中携入条件(该 attempt 自身 passed/failed 终态 + 指纹匹配)的
   * `${experimentId}|${evalId}` → 该 eval 下具体携入的 attempt 序号集合(0-based)。同一个
   * eval 在 `runs > 1` 时可能只有部分序号是终态、其余是 errored/未跑完——只有逐条命中的那些
   * 序号才在这个集合里,不是"key 命中就整段携入"(反例与修法见 memory 的
   * carry-includes-failed-verdict)。
   */
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  /** carriedAttemptsByKey 对应的完整结果对象,供 run.ts 直接并入 summary、cli.ts 直接取 verdict 展示。 */
  readonly carriedResults: readonly EvalResult[];
  /** 仅 `--accept` 授权放行的历史条目 → 它跨过的那几条差异(留痕落到条目的 `carriedAccepting`)。 */
  readonly carriedAcceptingByResult: ReadonlyMap<EvalResult, readonly FingerprintDelta[]>;
  /**
   * `cacheKey(run, evalId)` → 本行要派发的 attempt 按未携带原因分组(升序、同一门聚一组)。
   * 全部携带的行不出现在表里。`--dry` 的逐条作废原因读它。
   */
  readonly dispatchByKey: ReadonlyMap<string, readonly DispatchGroup[]>;
  /**
   * `cacheKey(run, evalId)` → 本次算出的指纹输入清单,与指纹同刻、同一份输入
   * (见 `fingerprintWithManifest`)。Run 记录根下的 `manifests.json` 落的就是它,
   * 下一轮的差异解释靠它。
   */
  readonly manifestsByKey: ReadonlyMap<string, EvalManifest>;
  /**
   * 本次计划里**真实存在**的可授权差异(按 selector 去重)。`--accept` 的空转校验读它:
   * 两侧都没有的 selector 多半是打错了,按启动期用法错误报出并列出这张表。
   * 它与 `--accept` 是否给出无关——授权成功的差异照样在表里,否则「授权一次之后同一条命令
   * 再跑就说这个 selector 空转」。
   */
  readonly availableDeltas: readonly FingerprintDelta[];
}

export type CarryGateDecision =
  | { readonly _tag: "Eligible" }
  | {
      readonly _tag: "Blocked";
      readonly gate: CarryGate;
      readonly reason: DispatchReason;
    };

const CARRY_ELIGIBLE: Extract<CarryGateDecision, { readonly _tag: "Eligible" }> =
  Object.freeze({ _tag: "Eligible" });

function carryBlocked(
  gate: CarryGate,
  reason: DispatchReason,
): Extract<CarryGateDecision, { readonly _tag: "Blocked" }> {
  return Object.freeze({ _tag: "Blocked", gate, reason });
}

/**
 * 与 `attempt.ts` 里实际生效超时的解析顺序保持一致(`run.timeoutMs ?? evalDef.timeoutMs ??
 * configTimeoutMs`),但刻意不叠加 attempt.ts 的硬编码兜底(10 分钟):携带判据要问的是「用户
 * 有没有显式配置一条线」,三层都未设时线本身不存在,`Infinity` 让 durationMs 判据恒成立
 * (「当前未设上限 = 恒可携带」,见 docs/runner.md「缓存:指纹去重」)。10 分钟兜底是
 * attempt.ts 的执行期默认值,不是携带判据要遵守的线。
 */
export function resolvedTimeoutMsForCarry(run: AgentRun, evalDef: DiscoveredEval, configTimeoutMs?: number): number {
  return run.timeoutMs ?? evalDef.timeoutMs ?? configTimeoutMs ?? Infinity;
}

/**
 * 携带资格判据的**唯一**实现:从 `priorResults` 里挑出 `key` 这条 `(experimentId, evalId)`
 * 可以携入(跳过重跑)的 attempt。三条判据逐条 attempt 独立成立才算命中——
 *
 * 1. 该 attempt 自己是终态(`passed` / `failed`)。`errored` 是框架/环境层面的不确定失败,
 *    判定本身不可信;`skipped` 根本没跑。同一 eval 的别的序号命中不能连带把它捎上
 *    (反例与修法见 memory 的 carry-must-be-per-attempt-not-whole-eval-key)。
 * 2. 该 attempt 落盘的 `fingerprint` 落在本次的可携带指纹集合里(`CarryPlan.acceptableFingerprints`
 *    的那一条,通常只有本次规划出的那一个;声明了 provenance flag 时还含「只在这些键上与本次
 *    不同」的历史口径)。
 * 3. 该 attempt 的 `durationMs` 不超过本次 resolved 的 `timeoutMs`——`timeoutMs` 是携带资格
 *    判据、不进指纹哈希(docs/runner.md「缓存:指纹去重」)。
 *
 * `planCarry`(整场静态规划)与 run.ts 派发时刻的携带重查共用这一个函数:两条路径一旦把判据
 * 各写一份就会分叉,重查会携入静态规划判过不可携带的条目(或反过来)。
 */
export interface CarryGateOptions {
  rerun?: "failed" | "all";
  keepSandbox?: "failed" | "all";
  sandboxReuse?: boolean;
  /** Rolling State 的 head 会推进，整个 Experiment 禁止跨 Run 携带。 */
  rollingState?: boolean;
  /** 本次授权的差异 selector(`--accept`);只放松指纹门,其余五道门不受影响。 */
  accept?: readonly string[];
  /**
   * 有历史、但那份落盘的 `schemaVersion` 与本读取器不同的 `cacheKey`(见
   * `loadCarryInputs` 的 `incompatibleHistory`)。这些条目读不进 `priorResults`,不标出来
   * 就会跟从没跑过的坐标一样落在 `new` 上——那是句事实错误的话。
   */
  incompatibleKeys?: ReadonlySet<string>;
}

export interface CarryPlanOptions {
  rerun?: "failed" | "all";
  keepSandbox?: "failed" | "all";
  accept?: readonly string[];
  /** 历史侧的指纹输入清单；缺席时差异保守落为 opaque。 */
  priorManifests?: ReadonlyMap<string, EvalManifest>;
  /** 有历史但格式不兼容的 cache key。 */
  incompatibleKeys?: ReadonlySet<string>;
  /** 项目级 Judge 默认；与 Experiment / Eval 逐字段解析。 */
  configJudge?: import("../types.ts").JudgeConfig;
}

/**
 * 一条历史 attempt 的携带判定。成功返回 `Eligible`，失败返回带 gate/reason 的 `Blocked`。
 * 这是判据的唯一实现——
 * `carriableAttempts`(能不能携带)与 `--dry` 的逐条作废原因(为什么没携带)都读它,
 * 两条路径因此不可能给出不一致的结论:「这条会重跑」与「它是被这道门拦下的」永远同源。
 * 门的顺序就是 docs 那张表的行序,一条 attempt 同时卡在多道门上时报最先那道。
 */
export function carryGateFor(
  r: EvalResult,
  configHash: string | undefined,
  fingerprints: ReadonlySet<string> | undefined,
  timeoutMs: number,
  options: CarryGateOptions = {},
): CarryGateDecision {
  if (r.verdict !== "passed" && r.verdict !== "failed") return carryBlocked("terminal", "errored");
  if (
    fingerprints === undefined ||
    fingerprints.size === 0 ||
    r.fingerprint === undefined ||
    !fingerprints.has(r.fingerprint) ||
    (r.configHash !== undefined && r.configHash !== configHash && !options.accept?.length)
  ) return carryBlocked("fingerprint", "stale");
  // `durationMs` 在 `EvalResult` 上是必填字段,正常落盘不会缺失;这里的 `typeof` 防御只处理
  // 磁盘数据损坏等异常情形——保守地判不可携带,而不是当 0 处理(当 0 会让所有旧记录都通过
  // 判据,把「数据缺失」悄悄伪装成「跑得很快」)。
  const executionMs =
    typeof r.executionMs === "number" && Number.isFinite(r.executionMs)
      ? r.executionMs
      : typeof r.durationMs === "number" && Number.isFinite(r.durationMs)
        ? r.durationMs
        : undefined;
  if (executionMs === undefined || executionMs > timeoutMs) return carryBlocked("eligibility", "exceeds-timeout");
  if (r.sandbox?.reused === true) return carryBlocked("origin", "reused-origin");
  if (options.rerun === "all" || (options.rerun === "failed" && r.verdict === "failed")) {
    return carryBlocked("rerun", "rerun");
  }
  if (options.sandboxReuse === true) return carryBlocked("mode", "sandbox-reuse");
  if (options.rollingState === true) return carryBlocked("mode", "rolling-state");
  if (options.keepSandbox === "all" || (options.keepSandbox === "failed" && r.verdict === "failed")) {
    return carryBlocked("mode", "keep-sandbox");
  }
  return CARRY_ELIGIBLE;
}

/**
 * 计划内某个序号**根本没有历史条目**时报哪个词:盘上真没有是 `new`,有但那份落盘的
 * `schemaVersion` 读不动是 `incompatible`。两者都是缺历史门(`missing`),`--dry --json` 的
 * gate 词不因此增加成员——分的是给人看的原因,不是新的一道门。
 */
export function missingReason(
  key: string,
  options: CarryGateOptions,
): Extract<CarryGateDecision, { readonly _tag: "Blocked" }> {
  return options.incompatibleKeys?.has(key)
    ? carryBlocked("missing", "incompatible")
    : carryBlocked("missing", "new");
}

export function carriableAttempts(
  priorResults: EvalResult[] | undefined,
  key: string,
  configHash: string | undefined,
  fingerprints: ReadonlySet<string> | undefined,
  timeoutMs: number,
  options: CarryGateOptions = {},
): EvalResult[] {
  if (!priorResults?.length) return [];
  const out: EvalResult[] = [];
  for (const r of priorResults) {
    if (!r.experimentId || runPairKey(r.experimentId, r.id) !== key) continue;
    if (carryGateFor(r, configHash, fingerprints, timeoutMs, options)._tag === "Blocked") continue;
    out.push(r);
  }
  return out;
}

/**
 * 算出这一批 (agentRun × eval) 的指纹,并据此从 priorResults 里筛出可以携入(跳过重跑)的结果。
 * run.ts 与 cli.ts(live 表格构建)必须共用这同一份计算 —— 否则两边一旦对"哪些携入"的判断
 * 不一致,live 表格就会显示"还在等名额",而 run.ts 其实已经把它筛掉、根本不会调度这个 attempt
 * (见 memory 的 live-carry-row-shows-waiting-forever)。
 *
 * 携带来源不要求快照收尾:`priorResults` 来自 `loadLatestResultsPerEval`,它按落盘的
 * `result.json` 一条条读,不检查所属快照有没有 `completedAt`——被中断或强杀的 run 留下的
 * 未收尾快照,其中已落盘的终态 attempt 同样进入这里的候选集合(见 docs/runner.md
 * 「缓存:指纹去重」)。
 *
 * @param configTimeoutMs 项目级 `Config.timeoutMs`(携带资格判据的最后一层兜底,见
 * `resolvedTimeoutMsForCarry`)。省略时按未配置处理,不是当作 0——只有 `run.timeoutMs` /
 * `evalDef.timeoutMs` 都缺席时才轮到它兜底。
 */
export function planCarry(
  evals: readonly DiscoveredEval[],
  agentRuns: readonly AgentRun[],
  priorResults: EvalResult[] | undefined,
  configTimeoutMs?: number,
  options: CarryPlanOptions = {},
): Effect.Effect<CarryPlan, SandboxRunPlanningError> {
  return Effect.flatMap(
    prepareRunSandboxes(evals, agentRuns, liveSandboxPlanningServices(), {
      ...(options.keepSandbox === undefined ? {} : { keepSandbox: options.keepSandbox }),
      ...(configTimeoutMs === undefined ? {} : { configTimeoutMs }),
    }),
    (preparedPairs) => Effect.promise(() => planCarryPrepared(
      preparedPairs,
      priorResults,
      configTimeoutMs,
      options,
    )),
  );
}

async function planCarryPrepared(
  preparedPairs: readonly PreparedRunPair[],
  priorResults: EvalResult[] | undefined,
  configTimeoutMs: number | undefined,
  options: CarryPlanOptions,
): Promise<CarryPlan> {
  const preparedPairsByKey = indexPreparedPairs(preparedPairs);
  const sourceCache = new Map<string, Promise<string>>();
  const plannedFingerprints = new Map<string, string>();
  const manifestsByKey = new Map<string, EvalManifest>();
  const plannedConfigHashes = new Map<string, string>();
  // 与 plannedFingerprints 同一批 (run × evalDef) 循环里顺带算好,供下面按 key 查「这个组合
  // 这次的携带资格线是多少」——同一个 key 在同一次 planCarry 调用里只对应一个 (run, evalDef)
  // 组合,与 plannedFingerprints 的 key 语义一致。
  const plannedTimeoutMs = new Map<string, number>();
  const acceptable = new Map<string, Set<string>>();
  // 同一次携带规划内保持稳定；下一次 Invocation 必然变化，使无法解析 FROM digest 的环境
  // 永不命中历史指纹，同时不妨碍本次 fresh result 使用同一个计划指纹落盘。
  const carryEpoch = randomUUID();
  // key → 这个组合的 (run, evalDef);下面三趟(反事实重算、携带判定、逐条原因)都按 key 取回
  // 同一对,不再各自 find 一遍。
  const entries = new Map<string, { pair: PreparedRunPair; identity: ConfigIdentity }>();
  const jobs: Promise<void>[] = [];
  for (const pair of preparedPairs) {
      const { key, run, evalDef } = pair;
      const resolvedJudge = resolveJudge(run.judge, evalDef.judge, options.configJudge);
      const identity = configIdentityForRun(run, pair.plan, resolvedJudge);
      const configHash = hashConfigIdentity(identity);
      entries.set(key, { pair, identity });
      plannedConfigHashes.set(key, configHash);
      plannedTimeoutMs.set(key, resolvedTimeoutMsForCarry(run, evalDef, configTimeoutMs));
      jobs.push(
        (async () => {
          const { fingerprint: fp, manifest } = await fingerprintWithManifest(
            pair,
            sourceCache,
            currentFingerprintProjection(pair, identity, carryEpoch),
          );
          plannedFingerprints.set(key, fp);
          manifestsByKey.set(key, manifest);
          acceptable.set(key, new Set([fp]));
        })(),
      );
  }
  await Promise.all(jobs);

  // 本次计划里真实存在的配置面差异:指纹对不上的历史条目逐条相减。与 --accept 给没给无关,
  // 授权成功的差异照样留在表里(校验空转要的是「这条差异存不存在」,不是「它有没有被授权」)。
  const priorsByKey = new Map<string, EvalResult[]>();
  for (const prior of priorResults ?? []) {
    if (!prior.experimentId) continue;
    const key = runPairKey(prior.experimentId, prior.id);
    if (!entries.has(key)) continue;
    const list = priorsByKey.get(key) ?? [];
    list.push(prior);
    priorsByKey.set(key, list);
  }
  // 差异 = 新旧两份 manifest 相减(配置面 / 源码面 / 数据面)。历史侧没有清单时只有源码面与
  // 数据面算不出,合并成一条 `opaque:no-manifest` 由人显式采信;配置面落盘在 `run.json`,
  // 从条目重建后照常给具名差异。
  const deltasByResult = new Map<EvalResult, readonly FingerprintDelta[]>();
  const availableBySelector = new Map<string, FingerprintDelta>();
  for (const [key, priors] of priorsByKey) {
    const current = manifestsByKey.get(key);
    if (current === undefined) {
      throw new Error(`Missing current manifest for ${JSON.stringify(key)}.`);
    }
    for (const prior of priors) {
      if (prior.fingerprint !== undefined && prior.fingerprint === plannedFingerprints.get(key)) continue;
      const priorIdentity = configIdentityFromResult(prior);
      const deltas = manifestDeltas(
        options.priorManifests?.get(key),
        current,
        priorIdentity === undefined ? undefined : Object.fromEntries(configIdentityPaths(priorIdentity)),
      );
      if (deltas.length === 0) continue;
      deltasByResult.set(prior, deltas);
      for (const delta of deltas) {
        if (!availableBySelector.has(delta.selector)) availableBySelector.set(delta.selector, delta);
      }
    }
  }

  // 授权跨过一条具名差异。两条路径,同一条底线——**本条差异之外不得有未授权的差异**:
  //
  // - 差异全在配置面时走反事实重算:按换回历史值的身份重算一次指纹,把那个口径加进候选集合。
  //   相等本身就是证明——两侧只差被授权的那些字段时才算得出相等的指纹,清单看不见的输入
  //   (eval 的 tags / environment / metadata)一旦也变了,指纹照样对不上、条目照常重跑。
  // - 差异含源码面 / 数据面 / `opaque` 时反事实身份构造不出来(旧文件内容不在手上),
  //   改为直接采信这条历史指纹:这正是「把判断交给人」的那一步,人已经说了这条差异不影响它。
  //
  // 缺清单的条目落在两条路径中间:被授权的全是 `config:`、剩下的只有 `opaque:no-manifest` 时
  // 照样走反事实重算——指纹相等本身就证明源码面与数据面没变,那条算不出的差异不必再要人采信。
  const accepted = new Set(options.accept ?? []);
  const acceptedDeltasByResult = new Map<EvalResult, readonly FingerprintDelta[]>();
  if (accepted.size > 0) {
    for (const [prior, deltas] of deltasByResult) {
      const crossed = deltas.filter((delta) => accepted.has(delta.selector));
      if (crossed.length === 0) continue;
      const pending = deltas.filter((delta) => !accepted.has(delta.selector));
      if (prior.experimentId === undefined) continue;
      const key = runPairKey(prior.experimentId, prior.id);
      const entry = entries.get(key);
      if (entry === undefined) {
        throw new Error(`Missing prepared pair for accepted historical result ${JSON.stringify(key)}.`);
      }
      const { pair, identity } = entry;
      const historical = configIdentityFromResult(prior);
      const configOnly =
        crossed.every((delta) => delta.selector.startsWith("config:")) &&
        pending.every((delta) => delta.selector === OPAQUE_SELECTOR);
      if (configOnly && historical !== undefined) {
        const counterfactual = counterfactualConfigIdentity(identity, historical, accepted);
        const fp = await computeFingerprint(
          pair,
          sourceCache,
          counterfactualFingerprintProjection(counterfactual, carryEpoch),
        );
        const acceptedFingerprints = acceptable.get(key);
        if (acceptedFingerprints === undefined) {
          throw new Error(`Missing acceptable fingerprint set for ${JSON.stringify(key)}.`);
        }
        acceptedFingerprints.add(fp);
        if (fp === prior.fingerprint) acceptedDeltasByResult.set(prior, crossed);
        continue;
      }
      if (pending.length > 0) continue; // 还有没被授权的差异 → 照常重跑
      if (prior.fingerprint === undefined) continue;
      const acceptedFingerprints = acceptable.get(key);
      if (acceptedFingerprints === undefined) {
        throw new Error(`Missing acceptable fingerprint set for ${JSON.stringify(key)}.`);
      }
      acceptedFingerprints.add(prior.fingerprint);
      acceptedDeltasByResult.set(prior, crossed);
    }
  }

  // 判据本身在 carriableAttempts 里,这里只按 key 逐组调它——静态规划与派发时刻的重查因此
  // 不可能对「哪些携入」得出不同结论。
  const carriedAttemptsByKey = new Map<string, Set<number>>();
  const carriedAcceptingByResult = new Map<EvalResult, readonly FingerprintDelta[]>();
  const hit = new Set<EvalResult>();
  for (const [key, { pair: { run } }] of entries) {
    const carried = carriableAttempts(
      priorResults,
      key,
      plannedConfigHashes.get(key),
      acceptable.get(key),
      plannedTimeoutMs.get(key) ?? Infinity,
      { ...options, sandboxReuse: run.sandboxReuse, rollingState: run.state._tag === "Rolling" },
    );
    if (carried.length === 0) continue;
    const indices = new Set<number>();
    for (const r of carried) {
      indices.add(r.attempt);
      hit.add(r);
      const crossed = acceptedDeltasByResult.get(r);
      if (crossed !== undefined && r.fingerprint !== plannedFingerprints.get(key)) {
        carriedAcceptingByResult.set(r, crossed);
      }
    }
    carriedAttemptsByKey.set(key, indices);
  }

  // 逐条未携带原因:计划内每个没被携入的 attempt 序号,已知卡在哪一道门上。
  const dispatchByKey = new Map<string, readonly DispatchGroup[]>();
  for (const [key, { pair: { run } }] of entries) {
    const carriedIndices = carriedAttemptsByKey.get(key);
    const byAttempt = new Map<number, EvalResult>();
    for (const prior of priorsByKey.get(key) ?? []) {
      if (!byAttempt.has(prior.attempt)) byAttempt.set(prior.attempt, prior);
    }
    type MutableDispatchGroup = {
      gate: CarryGate;
      reason: DispatchReason;
      attempts: number[];
      deltas?: readonly FingerprintDelta[];
    };
    const groups: MutableDispatchGroup[] = [];
    const indexOfGroup = new Map<string, MutableDispatchGroup>();
    for (let i = 0; i < run.attempts; i++) {
      if (carriedIndices?.has(i)) continue;
      const prior = byAttempt.get(i);
      const decision = prior === undefined
        ? missingReason(key, options)
        : carryGateFor(
            prior,
            plannedConfigHashes.get(key),
            acceptable.get(key),
            plannedTimeoutMs.get(key) ?? Infinity,
            { ...options, sandboxReuse: run.sandboxReuse, rollingState: run.state._tag === "Rolling" },
          );
      if (decision._tag === "Eligible") {
        throw new Error(
          `Carry planning classified ${JSON.stringify(key)} attempt ${i} as eligible without carrying it.`,
        );
      }
      const blocked = decision;
      const groupKey = `${blocked.gate}|${blocked.reason}`;
      let group = indexOfGroup.get(groupKey);
      if (group === undefined) {
        group = { gate: blocked.gate, reason: blocked.reason, attempts: [] };
        const deltas = prior !== undefined && blocked.gate === "fingerprint" ? deltasByResult.get(prior) : undefined;
        if (deltas !== undefined && deltas.length > 0) group.deltas = deltas;
        indexOfGroup.set(groupKey, group);
        groups.push(group);
      }
      group.attempts.push(i);
    }
    if (groups.length > 0) {
      dispatchByKey.set(key, Object.freeze(groups.map((group) => Object.freeze({
        ...group,
        attempts: Object.freeze([...group.attempts]),
        ...(group.deltas === undefined ? {} : { deltas: Object.freeze([...group.deltas]) }),
      }))));
    }
  }

  // 按 priorResults 的原始顺序输出(调用方的展示顺序不因分组而抖动)。
  const carriedResults = (priorResults ?? []).filter((r) => hit.has(r));
  return Object.freeze({
    preparedPairsByKey,
    plannedConfigHashes: readonlyMapSnapshot(plannedConfigHashes),
    plannedFingerprints: readonlyMapSnapshot(plannedFingerprints),
    acceptableFingerprints: readonlyMapSnapshot(
      [...acceptable].map(([key, values]) => [key, readonlySetSnapshot(values)] as const),
    ),
    carriedAttemptsByKey: readonlyMapSnapshot(
      [...carriedAttemptsByKey].map(([key, values]) => [key, readonlySetSnapshot(values)] as const),
    ),
    carriedResults: Object.freeze([...carriedResults]),
    carriedAcceptingByResult: readonlyMapSnapshot(
      [...carriedAcceptingByResult].map(([result, deltas]) => [result, Object.freeze([...deltas])] as const),
    ),
    dispatchByKey: readonlyMapSnapshot(dispatchByKey),
    manifestsByKey: readonlyMapSnapshot(manifestsByKey),
    availableDeltas: Object.freeze(
      [...availableBySelector.values()].sort((a, b) => a.selector.localeCompare(b.selector)),
    ),
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

function readonlySetSnapshot<Value>(values: Iterable<Value>): ReadonlySet<Value> {
  const snapshot = new Set(values);
  let view: ReadonlySet<Value>;
  view = {
    get size() { return snapshot.size; },
    has: (value) => snapshot.has(value),
    forEach: (callback, thisArg) => snapshot.forEach((value) => callback.call(thisArg, value, value, view)),
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
