// openRecord:扫描结果目录,返回「实验 → 快照 → eval → attempt」的类型化层次
// (定稿见 docs/feature/record/library.md「读:openRecord」、docs/feature/record/architecture.md「读取规则」)。
//
// 三条铁律:
// - 忠实磁盘:快照与实验归组只切片,不合并、不聚合、不去重;合并/聚合永远发生在消费方。
// - 读不了的落盘进 unreadable(三种原因),不静默丢,也不抛错(单个坏快照不拖垮整次扫描)。
// - 重 artifact 全部懒加载:缺失返回 null(存在性判断被方法语义吸收),同一 handle 内记忆化。

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { EvalResult } from "../types.ts";
import type { CommandExitEvidence, O11ySummary, StreamEvent, TraceSpan } from "../types.ts";
import type { AgentSetupManifest, DiffData, SourceArtifact } from "../types.ts";
import { deriveDiffData } from "../assertions/diff.ts";
import {
  ATTEMPT_DIR_PREFIX,
  RESULT_FILE,
  RUN_FILE,
  artifactFileOf,
  classifyRun,
  evalDirOf,
  experimentDirOf,
} from "../record/format.ts";
import { isNewerSnapshot, isNewerSnapshotPlacement } from "../sample/index.ts";
import {
  assertLocatorRegistrationsAvailable,
  attemptIdentitiesEqual,
  buildLocatorIndex,
  encodeAttemptLocator,
  resolveAttemptLocator,
  type AttemptLocatorRegistration,
  type AttemptIdentity,
  type AttemptLocator,
  type LocatorIndex,
} from "../record/locator.ts";
import type {
  ArtifactKind,
  AttemptHandle,
  Eval,
  Experiment,
  Record,
  Sample,
  UnreadableRun,
  Run,
  RunMeta,
} from "../record/types.ts";
import { ARTIFACT_KINDS } from "../record/types.ts";
import { assertEvidenceCoverage } from "../assertions/coverage.ts";

// publish 补记 knownEvalIds 需要「复制时刻该实验的 knownEvalIds」,而 Run 上按定稿
// 不挂 Experiment 反向指针 —— 用模块级 WeakMap 记归属,只供库内部(copy.ts)取用。
const experimentBySnapshot = new WeakMap<Run, Experiment>();

/** 库内部:快照所属的 Experiment(仅对 openRecord 产出的快照存在)。 */
export function experimentOfSnapshot(run: Run): Experiment | undefined {
  return experimentBySnapshot.get(run);
}

// locator → AttemptHandle 索引同样挂在 openRecord() 产出的 Record 上,不进公开类型
// (Record 接口保持精简,索引经 resolveLocator() 这个自由函数取用,与 experimentOfSnapshot
// 同一种「WeakMap 记归属」模式)。openRecord() 之外手工拼出来的 Record 对象查不到索引,
// resolveLocator() 对此的处理是「查不到 = 空索引」,一律 not-found,不抛意外错误。
const locatorIndexByResults = new WeakMap<Record, LocatorIndex<AttemptHandle>>();

/** locator 语法合法、但索引里没有这个 key——落盘已被清理、复制时没带上,或纯粹打错。 */
export class LocatorNotFoundError extends Error {
  constructor(public readonly locator: string) {
    super(
      `No attempt found for locator "${locator}" in this results root. It may be stale ` +
        "(the run was deleted, or publish didn't include it) or mistyped.",
    );
    this.name = "LocatorNotFoundError";
  }
}

/** locator 字符串本身不合法(前缀 / scheme 字符 / body 字符集或长度不对)。 */
export class MalformedLocatorError extends Error {
  constructor(
    public readonly input: string,
    public readonly reason: string,
  ) {
    super(`"${input}" is not a valid attempt locator: ${reason}`);
    this.name = "MalformedLocatorError";
  }
}

export interface AmbiguousLocatorCandidate {
  experimentId: string;
  evalId: string;
  attempt: number;
}

/** 同一个语法合法 locator 在记录根里对应多条落盘；任取其一会把用户带到错误证据。 */
export class AmbiguousLocatorError extends Error {
  constructor(
    public readonly locator: AttemptLocator,
    public readonly candidates: readonly AmbiguousLocatorCandidate[],
  ) {
    const lines = candidates.map(
      (candidate) => `  - ${candidate.experimentId} / ${candidate.evalId} / attempt ${candidate.attempt}`,
    );
    super(`Attempt locator "${locator}" is ambiguous in this results root:\n${lines.join("\n")}`);
    this.name = "AmbiguousLocatorError";
  }
}

/**
 * 拿 CLI 位置参数里的原始 `@...` 字符串,在 `openRecord()` 建好的 locator 索引里查找。
 * 找不到 / 语法不对是两种不同的用户错误(打错 vs 过期),用两个可判别的 Error 子类分开抛,
 * 不折叠成一句通用报错——上层(CLI)按 `instanceof` 决定提示文案。
 */
export function resolveLocator(results: Record, input: string): AttemptHandle {
  const index = locatorIndexByResults.get(results) ?? new Map<AttemptLocator, []>();
  const resolution = resolveAttemptLocator(index, input);
  switch (resolution.kind) {
    case "found":
      return resolution.handle;
    case "malformed":
      throw new MalformedLocatorError(resolution.input, resolution.reason);
    case "not-found":
      throw new LocatorNotFoundError(resolution.locator);
    case "ambiguous":
      throw new AmbiguousLocatorError(
        resolution.locator,
        resolution.candidates.map(({ handle }) => ({
          experimentId: handle.experimentId,
          evalId: handle.evalId,
          attempt: handle.result.attempt,
        })),
      );
  }
}

/**
 * runner 在 fresh attempt 派发前调用：只查 openRecord 已建的内存索引，再连同本批登记一起
 * 检查。carry 不传进来，所以原 locator 原样保留且不会按承载它的新 Run 重算。
 */
export function assertFreshAttemptLocatorRegistrations(
  results: Record,
  registrations: readonly AttemptLocatorRegistration[],
): void {
  const index = locatorIndexByResults.get(results) ?? new Map<AttemptLocator, []>();
  assertLocatorRegistrationsAvailable(index, registrations);
}

/**
 * 扫描出的全部 attempt 建一份 locator → AttemptHandle 索引(openRecord() 收尾时调一次)。
 * carry 是同一来源 attempt 的另一份落盘：沿 locatorRunId / artifactBase 还原来源身份后，
 * 同身份只保留遍历中先遇到的最新副本。只有来源身份不同却共享同一 locator 才保留为
 * 多候选，由 resolveLocator() 抛 AmbiguousLocatorError。
 */
function buildAttemptLocatorIndex(experiments: Experiment[]): LocatorIndex<AttemptHandle> {
  const attempts = experiments.flatMap((experiment) => experiment.runs.flatMap((run) => run.attempts));
  const attemptsByRef = new Map(attempts.map((attempt) => [`${attempt.ref.run}/${attempt.ref.attempt}`, attempt]));
  const identityMemo = new Map<AttemptHandle, AttemptIdentity>();

  const identityFor = (attempt: AttemptHandle, visiting = new Set<AttemptHandle>()): AttemptIdentity => {
    const memoized = identityMemo.get(attempt);
    if (memoized) return memoized;

    let runId = attempt.result.locatorRunId;
    if (runId === undefined && attempt.result.artifactBase !== undefined && !visiting.has(attempt)) {
      const origin = attemptsByRef.get(attempt.result.artifactBase);
      if (origin !== undefined && origin !== attempt) {
        const nextVisiting = new Set(visiting);
        nextVisiting.add(attempt);
        runId = identityFor(origin, nextVisiting).runId;
      }
    }
    runId ??= attempt.run.runId;

    const identity: AttemptIdentity = {
      runId,
      evalId: attempt.evalId,
      attempt: attempt.result.attempt,
    };
    identityMemo.set(attempt, identity);
    attempt.locatorIdentity = identity;
    return identity;
  };

  const seen = new Map<AttemptLocator, AttemptIdentity[]>();
  return buildLocatorIndex(
    attempts.flatMap((attempt) => {
      const identity = identityFor(attempt);
      const locator = attempt.locator ?? encodeAttemptLocator(identity);
      attempt.locator = locator;
      attempt.result.locator = locator;
      const identities = seen.get(locator) ?? [];
      if (identities.some((candidate) => attemptIdentitiesEqual(candidate, identity))) return [];
      identities.push(identity);
      seen.set(locator, identities);
      return [{ identity, handle: attempt, locator }];
    }),
  );
}

interface ScanState {
  runs: Run[];
  unreadable: UnreadableRun[];
}

/**
 * 打开结果根、实验目录、快照目录,或直接指向某个 run.json(/ 历史版本 summary.json)的路径。
 * 目录不存在返回空集合(还没跑过 eval 不是错误);任何读不了的落盘进 unreadable,不抛错。
 */
export async function openRecord(dir: string): Promise<Record> {
  const target = resolve(dir);
  const state: ScanState = { runs: [], unreadable: [] };

  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    return makeResults([], [], target);
  }

  if (targetStat.isFile()) {
    // 单文件模式:直指 run.json(或历史版本 summary.json)→ 读它所在目录为快照。
    await handleMetaFile(target, state);
  } else {
    await scan(target, 0, state);
  }

  state.unreadable.sort((a, b) => b.dir.localeCompare(a.dir));
  const experiments = buildExperiments(state.runs);
  // 建 locator 索引:必须在全部快照扫完、Experiment 归组完成之后,返回 Record 之前——
  // 撞车(LocatorCollisionError)在这里抛,不静默吞、不拖到消费方第一次 resolveLocator() 才发现。
  const locatorIndex = buildAttemptLocatorIndex(experiments);
  const results = makeResults(experiments, state.unreadable, target);
  locatorIndexByResults.set(results, locatorIndex);
  return results;
}

function makeResults(experiments: Experiment[], unreadable: UnreadableRun[], root: string): Record {
  const results: Record = {
    root,
    experiments,
    unreadable,
  };
  return results;
}

// ───────────────────────── 目录扫描 ─────────────────────────

/**
 * 递归扫描:目录里直接有 run.json 或 summary.json → 处理并计 found,不再向下找;
 * 否则递归子目录;子树全部未 found 且 depth ≤ 2 且该目录(递归)含 artifact/result 文件 →
 * 折叠成 unreadable("incomplete"),计 found —— 把 attempt 级噪音折叠到实验/快照层,
 * 旧版(v3 及更早)run 目录直接 crash 在 depth 1 也被这条规则覆盖。
 */
async function scan(dir: string, depth: number, state: ScanState): Promise<boolean> {
  if (await hasFile(dir, RUN_FILE)) {
    await handleMetaFile(join(dir, RUN_FILE), state);
    return true;
  }
  if (await hasFile(dir, "summary.json")) {
    await handleMetaFile(join(dir, "summary.json"), state);
    return true;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  let anyFound = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await scan(join(dir, entry.name), depth + 1, state);
    anyFound = anyFound || found;
  }

  if (!anyFound && depth <= 2 && (await hasArtifactOrResultFiles(dir))) {
    state.unreadable.push({ dir, reason: "incomplete" });
    return true;
  }
  return anyFound;
}

/** 读一份元数据文件(run.json 或历史版本 summary.json),按分类结果分流。 */
async function handleMetaFile(path: string, state: ScanState): Promise<void> {
  const dir = dirname(path);
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    state.unreadable.push({ dir, reason: "malformed", detail: `cannot read file (${e instanceof Error ? e.message : String(e)})` });
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    state.unreadable.push({ dir, reason: "malformed", detail: "invalid JSON" });
    return;
  }

  const classified = classifyRun(raw);
  switch (classified.kind) {
    case "not-a-report":
      return; // 无关 JSON,静默忽略(调用方仍把此目录计为 found,不触发 incomplete 折叠)。
    case "malformed":
      state.unreadable.push({ dir, reason: "malformed", detail: classified.detail });
      return;
    case "incompatible":
      state.unreadable.push({
        dir,
        reason: "incompatible",
        schemaVersion: classified.schemaVersion,
        ...(classified.producer ? { producer: classified.producer } : {}),
      });
      return;
    case "ok": {
      const run = await readSnapshotDir(dir, classified.meta, state);
      state.runs.push(run);
      return;
    }
  }
}

// ───────────────────────── 快照读取 ─────────────────────────

/** run.json 的元数据 → 空壳 Run(evals / attempts 待填);全量扫描与收窄读共用。 */
function makeSnapshotShell(dir: string, meta: RunMeta): Run {
  return {
    runId: meta.runId,
    experimentId: meta.experimentId,
    startedAt: meta.startedAt,
    ...(meta.configHash !== undefined ? { configHash: meta.configHash } : {}),
    ...(meta.completedAt !== undefined ? { completedAt: meta.completedAt } : {}),
    ...(meta.diagnostics?.length ? { diagnostics: meta.diagnostics } : {}),
    ...(meta.facts && Object.keys(meta.facts).length ? { facts: meta.facts } : {}),
    ...(meta.timings?.length ? { timings: meta.timings } : {}),
    ...(meta.sandboxBuilds?.length ? { sandboxBuilds: meta.sandboxBuilds } : {}),
    agent: meta.agent,
    ...(meta.model !== undefined ? { model: meta.model } : {}),
    ...(meta.experiment !== undefined ? { experiment: meta.experiment } : {}),
    producer: meta.producer,
    schemaVersion: meta.schemaVersion,
    ...(meta.name !== undefined ? { name: meta.name } : {}),
    evals: [],
    attempts: [],
    dir,
    ...(meta.knownEvalIds?.length ? { knownEvalIds: [...meta.knownEvalIds] } : {}),
  };
}

/**
 * 快照级字段拼合:「缺才补」,条目自带的值(携带条目的 startedAt)优先。全量扫描与收窄读
 * 共用这一份——收窄读若自己拼一遍,携入的条目会缺 experimentId / locator 一类字段。
 */
function applySnapshotDefaults(record: EvalResult, meta: RunMeta): void {
  record.experimentId ??= meta.experimentId;
  record.agent ??= meta.agent;
  if (record.model === undefined && meta.model !== undefined) record.model = meta.model;
  record.startedAt ??= meta.startedAt;
  if (record.experiment === undefined && meta.experiment !== undefined) record.experiment = meta.experiment;
  // locator 同理「缺才补」:niceeval 自己的 writer(schemaVersion 5 起)恒会写这个字段,
  // 携带条目原样携带上一轮的值——只有真缺失(第三方 harness 没实现 locator,或手工构造的
  // 落盘)才按当前身份兜底算一份;这份兜底不保证跨未来的 --resume 稳定,但至少确定性、
  // 可解析,不比完全没有 locator 差。
  if (record.locator === undefined && record.artifactBase === undefined) {
    record.locator = encodeAttemptLocator({
      runId: meta.runId,
      evalId: record.id,
      attempt: record.attempt,
    });
  }
  // 新格式由 writer 恒写 locatorRunId。第三方/旧格式的 fresh 条目可安全回填当前 Run；
  // carry 缺失时不能这么做，buildAttemptLocatorIndex 会沿 artifactBase 找到原来源身份。
  if (record.locatorRunId === undefined && record.artifactBase === undefined) {
    record.locatorRunId = meta.runId;
  }
}

/**
 * 携带条目 / 新算的 artifactBase(相对结果根):条目自带值优先(`--resume` 携入的条目指向
 * 原快照),缺则按所在 attempt 的 ref 现拼。携带条目要能被 view 找回 artifact,少了这一步
 * 报告里的携带行会静默丢 artifact——所以全量扫描(view/data.ts)与收窄读共用这一份公式。
 */
export function withArtifactBase(attempt: AttemptHandle): EvalResult {
  const r = attempt.result;
  if (r.artifactBase !== undefined) return r;
  return { ...r, artifactBase: `${attempt.ref.run}/${attempt.ref.attempt}` };
}

/**
 * 收窄读:只取某条 `(experimentId, evalId)` 的「当前可用」attempt,不扫全根。
 *
 * 口径与 `loadLatestResultsPerEval` 完全一致——整批取自**含它的最新快照**,不跨快照混装;
 * 「哪份最新」走 `isNewerSnapshotPlacement`(run.json 的 `startedAt` 优先、同刻按目录名),
 * 目录名倒序只作为候选遍历顺序,不作判据。**不检查快照有没有 `completedAt`**:被中断或强杀的
 * 未收尾快照里已落盘的终态照常可读(docs/runner.md「缓存:指纹去重」的「携带来源不要求快照收尾」)。
 *
 * 代价与该实验的历史快照数近似无关:没跑过这条 eval 的快照只付一次 readdir,不读任何文件;
 * 只有命中的候选才读 `run.json`。派发路径上的携带重查用它替代全树扫描
 * (`openRecord` 会读并 parse 全根每一个 `result.json`)。
 */
export async function loadLatestResultsForCase(
  root: string,
  experimentId: string,
  evalId: string,
): Promise<EvalResult[]> {
  const experimentDir = join(resolve(root), experimentDirOf(experimentId));
  let snapshotDirNames: string[];
  try {
    snapshotDirNames = (await readdir(experimentDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return []; // 这个实验还没跑过:不是错误
  }
  // 目录名带时间戳前缀,倒序 = 最可能命中的先试;权威判定仍在下面的 isNewerSnapshotPlacement。
  snapshotDirNames.sort((a, b) => b.localeCompare(a));
  const evalSegment = evalDirOf(evalId);

  let best: { dir: string; meta: RunMeta; attemptDirNames: string[] } | undefined;
  for (const name of snapshotDirNames) {
    const snapshotDir = join(experimentDir, name);
    let attemptDirNames: string[];
    try {
      attemptDirNames = (await readdir(join(snapshotDir, evalSegment), { withFileTypes: true }))
        .filter((e) => e.isDirectory() && ATTEMPT_DIR_RE.test(e.name))
        .map((e) => e.name);
    } catch {
      continue; // 这份快照没跑过这条 eval:只付一次 readdir
    }
    if (attemptDirNames.length === 0) continue;
    let meta: RunMeta;
    try {
      const classified = classifyRun(JSON.parse(await readFile(join(snapshotDir, RUN_FILE), "utf-8")));
      if (classified.kind !== "ok") continue; // 坏 / 不兼容版本的快照:跳过,不拖垮这次读
      meta = classified.meta;
    } catch {
      continue;
    }
    if (best === undefined || isNewerSnapshotPlacement({ startedAt: meta.startedAt, dir: snapshotDir }, { startedAt: best.meta.startedAt, dir: best.dir })) {
      best = { dir: snapshotDir, meta, attemptDirNames };
    }
  }
  if (best === undefined) return [];

  const run = makeSnapshotShell(best.dir, best.meta);
  const out: EvalResult[] = [];
  for (const attemptDirName of best.attemptDirNames.sort(byAttemptIndex)) {
    const attemptDir = join(best.dir, evalSegment, attemptDirName);
    let record: EvalResult;
    try {
      record = JSON.parse(await readFile(join(attemptDir, RESULT_FILE), "utf-8")) as EvalResult;
      assertEvidenceCoverage(record.evidenceCoverage, "result.json");
    } catch {
      continue; // 缺 result.json / 坏 JSON:如实跳过(与 openRecord 的 unreadable 同一「不拖垮整次读」精神)
    }
    // 目录名是被清洗过的 evalId,两条不同的 id 理论上可以洗成同一段;记录自报的 id 才是权威。
    if (record.id !== evalId) continue;
    applySnapshotDefaults(record, best.meta);
    out.push(withArtifactBase(makeAttempt(run, best.dir, attemptDir, record)));
  }
  return out;
}

const ATTEMPT_DIR_RE = new RegExp(`^${ATTEMPT_DIR_PREFIX}\\d+$`);

function byAttemptIndex(a: string, b: string): number {
  return Number(a.slice(ATTEMPT_DIR_PREFIX.length)) - Number(b.slice(ATTEMPT_DIR_PREFIX.length));
}

/** 快照目录:递归收集全部 result.json,组装成 evals / attempts;单个 result.json 坏 JSON 不拖垮快照。 */
async function readSnapshotDir(dir: string, meta: RunMeta, state: ScanState): Promise<Run> {
  const run = makeSnapshotShell(dir, meta);

  const resultPaths = (await findResultFiles(dir)).sort();
  const evalsById = new Map<string, Eval>();

  for (const resultPath of resultPaths) {
    const attemptDir = dirname(resultPath);
    let record: EvalResult;
    try {
      const text = await readFile(resultPath, "utf-8");
      record = JSON.parse(text) as EvalResult;
      assertEvidenceCoverage(record.evidenceCoverage, "result.json");
    } catch (e) {
      state.unreadable.push({ dir: attemptDir, reason: "malformed", detail: `invalid result.json (${e instanceof Error ? e.message : String(e)})` });
      continue;
    }

    applySnapshotDefaults(record, meta);

    const attempt = makeAttempt(run, dir, attemptDir, record);
    let ev = evalsById.get(record.id);
    if (!ev) {
      ev = { id: record.id, attempts: [] };
      evalsById.set(record.id, ev);
      run.evals.push(ev);
    }
    ev.attempts.push(attempt);
  }

  for (const ev of run.evals) {
    // attempt 序号升序,同号按 startedAt。
    ev.attempts.sort((a, b) => a.result.attempt - b.result.attempt || (a.result.startedAt ?? "").localeCompare(b.result.startedAt ?? ""));
  }
  run.attempts = run.evals.flatMap((ev) => ev.attempts);
  // 回退推导:run.json 缺 configHash(旧存量落盘,exp 写入面在这条修法之前从不写它)时,
  // 若该快照全部 attempt 的 result.configHash 一致,取之为 Run 的 configHash——让存量记录
  // 不重跑即痊愈。任一 attempt 缺失或值不一致就如实保持 undefined,不猜一个可能错的值
  // (见 docs/feature/record/library.md「configHash:配置身份只算一次」)。
  if (run.configHash === undefined) {
    const derived = deriveConfigHashFromAttempts(run.attempts);
    if (derived !== undefined) run.configHash = derived;
  }
  return run;
}

/** `readSnapshotDir` 的 configHash 回退推导:全部 attempt 都带且相等才取用,否则 undefined。 */
function deriveConfigHashFromAttempts(attempts: readonly AttemptHandle[]): string | undefined {
  if (attempts.length === 0) return undefined;
  let hash: string | undefined;
  for (const attempt of attempts) {
    const value = attempt.result.configHash;
    if (value === undefined) return undefined;
    if (hash === undefined) hash = value;
    else if (hash !== value) return undefined;
  }
  return hash;
}

function makeAttempt(run: Run, snapshotDir: string, attemptDir: string, record: EvalResult): AttemptHandle {
  // 候选 artifact 目录:本 attempt 目录为主;--resume 携带条目的 artifact 留在原快照里,
  // artifactBase(相对结果根 = 快照目录的上两级)指向那里,作为回退。
  const candidates: string[] = [attemptDir];
  // sources 的去重仓库(sources/<sha256>.json)挂在「快照根」,不是 attempt 目录——每个候选
  // attempt 目录都要配一个对应的快照根,顺序与 candidates 一一对应,lazySources 按下标取用。
  const candidateSnapshotRoots: string[] = [snapshotDir];
  if (record.artifactBase) {
    const resultsRoot = dirname(dirname(snapshotDir));
    candidates.push(resolve(resultsRoot, record.artifactBase));
    // artifactBase 恒为 `<实验目录>/<快照目录>/<evalId 路径>/a<n>`;experimentDirOf/快照目录名
    // 都不含 `/`,所以前两段就是原快照根,即便 evalId 自己带 `/`(多段)也不影响这个切法。
    const [expDir, snapDirName] = record.artifactBase.split("/");
    candidateSnapshotRoots.push(resolve(resultsRoot, expDir ?? "", snapDirName ?? ""));
  }

  const ref = {
    run: `${basename(dirname(snapshotDir))}/${basename(snapshotDir)}`,
    attempt: relative(snapshotDir, attemptDir).split(sep).join("/"),
  };

  return {
    evalId: record.id,
    experimentId: record.experimentId!,
    result: record,
    ref,
    run,
    locator: record.locator as AttemptLocator,
    // 携带条目投影:artifactBase 有值就是本快照 `--resume` 合入的上一轮终态结果
    // (docs/feature/sample/library.md「时效:新执行与历史执行」)。
    carried: Boolean(record.artifactBase),
    evidenceState: record.artifactBase
      ? (existsSync(candidates[1]!) ? "borrowed" : "dangling")
      : "local",
    commands: lazyArtifact<CommandExitEvidence[]>(candidates, "commands", record.commands),
    events: lazyArtifact<StreamEvent[]>(candidates, "events", record.events),
    trace: lazyArtifact<TraceSpan[]>(candidates, "trace", record.trace),
    o11y: lazyArtifact<O11ySummary>(candidates, "o11y", record.o11y),
    agentSetup: lazyArtifact<AgentSetupManifest>(candidates, "agentSetup", record.agentSetup),
    diff: (() => {
      // diff.json 落盘的是逐窗口 delta 序列(DiffArtifact);文件级视图在读取面派生。
      const raw = lazyArtifact<import("../types.ts").DiffArtifact>(candidates, "diff", record.diff);
      let memo: Promise<DiffData | null> | undefined;
      return () => (memo ??= raw().then((windows) => (windows === null ? null : deriveDiffData(windows))));
    })(),
    sources: lazySources(candidates, candidateSnapshotRoots, record.sources),
  };
}

/**
 * 单个 artifact 的懒加载器:缺失返回 null(不抛错);同一 handle 内记忆化,diff 这类可达百 MB 的
 * 文件绝不读两遍。result.json 里内联了该字段时直接用(外部工具转换/全量输出的场景)。
 * 文件存在但 JSON 损坏是真错误,抛英文错误而不是伪装成缺失;失败不缓存,允许重试。
 */
function lazyArtifact<T>(candidateDirs: string[], kind: ArtifactKind, inline: T | undefined): () => Promise<T | null> {
  let memo: Promise<T | null> | undefined;
  const load = async (): Promise<T | null> => {
    if (inline !== undefined) return inline;
    for (const dir of candidateDirs) {
      const file = join(dir, artifactFileOf(kind));
      let text: string;
      try {
        text = await readFile(file, "utf-8");
      } catch (e) {
        if (isMissingFile(e)) continue;
        throw new Error(`Cannot read artifact ${file} (${e instanceof Error ? e.message : String(e)}).`);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Artifact ${file} is not valid JSON. The file may be corrupted; re-run the eval or delete this attempt directory.`);
      }
    }
    return null;
  };
  return () => {
    memo ??= load().catch((e: unknown) => {
      memo = undefined;
      throw e;
    });
    return memo;
  };
}

/** 一条 sources 引用条目(attempt 级 `sources.json` 的落盘形状,schemaVersion 5 起)。 */
interface SourceRef {
  path: string;
  sha256: string;
  role?: SourceArtifact["role"];
}

/**
 * sources 的懒加载器:与 lazyArtifact 同样的存在性/记忆化/坏 JSON 语义,但多一层——
 * attempt 目录下的 `sources.json` 只是引用(`{path, sha256}[]`),真内容按 sha256 在对应
 * 快照根的 `sources/<sha256>.json` 里(去重仓库,见 writer.ts 的 writeSourcesRef)。
 * candidateSnapshotRoots 与 candidateDirs 下标一一对应:命中哪个候选 attempt 目录的引用,
 * 就去哪个候选对应的快照根找仓库——本 attempt 目录对本快照根,artifactBase 回退对原快照根。
 * 仓库里缺单条 blob(理论不该发生,引用与仓库应同时存在)如实跳过那一条,不让整个方法失败。
 */
function lazySources(
  candidateDirs: string[],
  candidateSnapshotRoots: string[],
  inline: SourceArtifact[] | undefined,
): () => Promise<SourceArtifact[] | null> {
  let memo: Promise<SourceArtifact[] | null> | undefined;
  const load = async (): Promise<SourceArtifact[] | null> => {
    if (inline !== undefined) return inline;
    for (let i = 0; i < candidateDirs.length; i++) {
      const refFile = join(candidateDirs[i]!, artifactFileOf("sources"));
      let text: string;
      try {
        text = await readFile(refFile, "utf-8");
      } catch (e) {
        if (isMissingFile(e)) continue;
        throw new Error(`Cannot read artifact ${refFile} (${e instanceof Error ? e.message : String(e)}).`);
      }
      let refs: SourceRef[];
      try {
        refs = JSON.parse(text) as SourceRef[];
      } catch {
        throw new Error(`Artifact ${refFile} is not valid JSON. The file may be corrupted; re-run the eval or delete this attempt directory.`);
      }
      const storeDir = join(candidateSnapshotRoots[i]!, "sources");
      const out: SourceArtifact[] = [];
      for (const ref of refs) {
        const blobFile = join(storeDir, `${ref.sha256}.json`);
        let blobText: string;
        try {
          blobText = await readFile(blobFile, "utf-8");
        } catch (e) {
          if (isMissingFile(e)) continue; // 仓库缺这一条(极端情况):跳过,不拖垮其它条目
          throw new Error(`Cannot read source blob ${blobFile} (${e instanceof Error ? e.message : String(e)}).`);
        }
        let blob: { content: string };
        try {
          blob = JSON.parse(blobText) as { content: string };
        } catch {
          throw new Error(`Source blob ${blobFile} is not valid JSON. It may be corrupted.`);
        }
        out.push({ path: ref.path, content: blob.content, role: ref.role ?? "referenced" });
      }
      return out;
    }
    return null;
  };
  return () => {
    memo ??= load().catch((e: unknown) => {
      memo = undefined;
      throw e;
    });
    return memo;
  };
}

function isMissingFile(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// ───────────────────────── 实验归组 ─────────────────────────

/** 同一 experiment id 的历次快照归在一起;实验按 id 字典序,快照最新在前。 */
function buildExperiments(runs: Run[]): Experiment[] {
  const byId = new Map<string, Run[]>();
  for (const run of runs) {
    const group = byId.get(run.experimentId);
    if (group) group.push(run);
    else byId.set(run.experimentId, [run]);
  }

  const experiments: Experiment[] = [];
  for (const [id, group] of byId) {
    group.sort((a, b) => (isNewerSnapshot(a, b) ? -1 : 1));
    // 已知并集 = 本地历史(各快照覆盖的题)∪ 各快照携带的 knownEvalIds ——
    // 不是「优先字段」:把快照复制进已有历史的目录时,本地并集可能更大,优先字段会让分母缩水。
    const ids = new Set<string>();
    for (const run of group) {
      for (const ev of run.evals) ids.add(ev.id);
      for (const known of run.knownEvalIds ?? []) ids.add(known);
    }
    const experiment: Experiment = { id, runs: group, latestRun: group[0], knownEvalIds: [...ids].sort() };
    for (const run of group) experimentBySnapshot.set(run, experiment);
    experiments.push(experiment);
  }
  experiments.sort((a, b) => a.id.localeCompare(b.id));
  return experiments;
}

// ───────────────────────── 文件系统助手 ─────────────────────────

async function findResultFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const direct = entries.filter((e) => e.isFile() && e.name === RESULT_FILE).map((e) => join(dir, e.name));
  const nested = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => findResultFiles(join(dir, e.name))));
  return [...direct, ...nested.flat()];
}

/** 目录下(递归)是否存在 result.json 或任何 attempt artifact 文件 —— incomplete 判定的依据。 */
async function hasArtifactOrResultFiles(dir: string): Promise<boolean> {
  const names = new Set<string>([RESULT_FILE, ...ARTIFACT_KINDS.map((kind) => artifactFileOf(kind))]);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && names.has(entry.name)) return true;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && (await hasArtifactOrResultFiles(join(dir, entry.name)))) return true;
  }
  return false;
}

async function hasFile(dir: string, name: string): Promise<boolean> {
  try {
    return (await stat(join(dir, name))).isFile();
  } catch {
    return false;
  }
}
