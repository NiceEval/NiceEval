// openResults:扫描结果目录,返回「实验 → 快照 → eval → attempt」的类型化层次
// (定稿见 docs/feature/results/library.md「读:openResults」、docs/feature/results/architecture.md「读取规则」)。
//
// 三条铁律:
// - 忠实磁盘:快照与实验归组只切片,不合并、不聚合、不去重;合并/聚合永远发生在消费方。
// - 读不了的落盘进 skipped(三种原因),不静默丢,也不抛错(单个坏快照不拖垮整次扫描)。
// - 重 artifact 全部懒加载:缺失返回 null(存在性判断被方法语义吸收),同一 handle 内记忆化。

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { EvalResult } from "../types.ts";
import type { O11ySummary, StreamEvent, TraceSpan } from "../types.ts";
import type { AgentSetupManifest, DiffData, SourceArtifact } from "../types.ts";
import { RESULT_FILE, SNAPSHOT_FILE, artifactFileOf, classifySnapshot } from "./format.ts";
import { isNewerSnapshot, selectLatest } from "./select.ts";
import {
  encodeAttemptLocator,
  resolveAttemptLocator,
  LocatorCollisionError,
  type AttemptIdentity,
  type AttemptLocator,
} from "./locator.ts";
import type {
  ArtifactKind,
  AttemptHandle,
  Eval,
  Experiment,
  Results,
  Selection,
  SkippedDir,
  Snapshot,
  SnapshotMeta,
} from "./types.ts";
import { ARTIFACT_KINDS } from "./types.ts";

// copySnapshots 补记 knownEvalIds 需要「复制时刻该实验的 evalIds」,而 Snapshot 上按定稿
// 不挂 Experiment 反向指针 —— 用模块级 WeakMap 记归属,只供库内部(copy.ts)取用。
const experimentBySnapshot = new WeakMap<Snapshot, Experiment>();

/** 库内部:快照所属的 Experiment(仅对 openResults 产出的快照存在)。 */
export function experimentOfSnapshot(snapshot: Snapshot): Experiment | undefined {
  return experimentBySnapshot.get(snapshot);
}

// locator → AttemptHandle 索引同样挂在 openResults() 产出的 Results 上,不进公开类型
// (Results 接口保持精简,索引经 resolveLocator() 这个自由函数取用,与 experimentOfSnapshot
// 同一种「WeakMap 记归属」模式)。openResults() 之外手工拼出来的 Results 对象查不到索引,
// resolveLocator() 对此的处理是「查不到 = 空索引」,一律 not-found,不抛意外错误。
const locatorIndexByResults = new WeakMap<Results, Map<AttemptLocator, AttemptHandle>>();

/** locator 语法合法、但索引里没有这个 key——落盘已被清理、复制时没带上,或纯粹打错。 */
export class LocatorNotFoundError extends Error {
  constructor(public readonly locator: string) {
    super(
      `No attempt found for locator "${locator}" in this results root. It may be stale ` +
        "(the snapshot was deleted, or copySnapshots didn't include it) or mistyped.",
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

/**
 * 拿 CLI 位置参数里的原始 `@...` 字符串,在 `openResults()` 建好的 locator 索引里查找。
 * 找不到 / 语法不对是两种不同的用户错误(打错 vs 过期),用两个可判别的 Error 子类分开抛,
 * 不折叠成一句通用报错——上层(CLI)按 `instanceof` 决定提示文案。
 */
export function resolveLocator(results: Results, input: string): AttemptHandle {
  const index = locatorIndexByResults.get(results) ?? new Map<AttemptLocator, AttemptHandle>();
  const resolution = resolveAttemptLocator(index, input);
  switch (resolution.kind) {
    case "found":
      return resolution.handle;
    case "malformed":
      throw new MalformedLocatorError(resolution.input, resolution.reason);
    case "not-found":
      throw new LocatorNotFoundError(resolution.locator);
  }
}

/**
 * 扫描出的全部 attempt 建一份 locator → AttemptHandle 索引(openResults() 收尾时调一次)。
 * 遍历顺序 = experiments(字典序)→ exp.snapshots(新→旧,buildExperiments 已排好序)→
 * snapshot.attempts;「先遇到的赢」自然保留最新快照里的那份(--resume 携带条目在新旧两个
 * 快照里都能扫到时,新快照排在前面先被记进索引,旧快照那份被跳过——同一份 locator 重复
 * 出现不是撞车)。三元组(experimentId/evalId/attempt 序号)不同却撞出同一个 locator
 * 字符串,才是真撞车,直接抛 LocatorCollisionError,不静默覆盖。
 */
function buildAttemptLocatorIndex(experiments: Experiment[]): Map<AttemptLocator, AttemptHandle> {
  const index = new Map<AttemptLocator, AttemptHandle>();
  for (const exp of experiments) {
    for (const snapshot of exp.snapshots) {
      for (const attempt of snapshot.attempts) {
        const locator = attempt.locator;
        if (locator === undefined) continue; // 理论上不会发生(makeAttempt 恒回填),防御性跳过
        const existing = index.get(locator);
        if (existing === undefined) {
          index.set(locator, attempt);
          continue;
        }
        if (
          existing.experimentId !== attempt.experimentId ||
          existing.evalId !== attempt.evalId ||
          existing.result.attempt !== attempt.result.attempt
        ) {
          throw new LocatorCollisionError(locator, [identityForError(existing), identityForError(attempt)]);
        }
      }
    }
  }
  return index;
}

/** LocatorCollisionError 诊断信息用:携带条目场景下这不一定是「真」身份(snapshotStartedAt
 *  取当前所在快照的值,携带条目原本可能来自更早的快照),但足够定位是哪两个 attempt 撞的。 */
function identityForError(attempt: AttemptHandle): AttemptIdentity {
  return {
    experimentId: attempt.experimentId,
    snapshotStartedAt: attempt.snapshot.startedAt,
    evalId: attempt.evalId,
    attempt: attempt.result.attempt,
  };
}

interface ScanState {
  snapshots: Snapshot[];
  skipped: SkippedDir[];
}

/**
 * 打开结果根、实验目录、快照目录,或直接指向某个 snapshot.json(/ 历史版本 summary.json)的路径。
 * 目录不存在返回空集合(还没跑过 eval 不是错误);任何读不了的落盘进 skipped,不抛错。
 */
export async function openResults(dir: string): Promise<Results> {
  const target = resolve(dir);
  const state: ScanState = { snapshots: [], skipped: [] };

  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    return makeResults([], []);
  }

  if (targetStat.isFile()) {
    // 单文件模式:直指 snapshot.json(或历史版本 summary.json)→ 读它所在目录为快照。
    await handleMetaFile(target, state);
  } else {
    await scan(target, 0, state);
  }

  state.skipped.sort((a, b) => b.dir.localeCompare(a.dir));
  const experiments = buildExperiments(state.snapshots);
  // 建 locator 索引:必须在全部快照扫完、Experiment 归组完成之后,返回 Results 之前——
  // 撞车(LocatorCollisionError)在这里抛,不静默吞、不拖到消费方第一次 resolveLocator() 才发现。
  const locatorIndex = buildAttemptLocatorIndex(experiments);
  const results = makeResults(experiments, state.skipped);
  locatorIndexByResults.set(results, locatorIndex);
  return results;
}

function makeResults(experiments: Experiment[], skipped: SkippedDir[]): Results {
  return {
    experiments,
    skipped,
    latest(opts?: { experiments?: string | string[] }): Selection {
      return selectLatest(experiments, opts);
    },
  };
}

// ───────────────────────── 目录扫描 ─────────────────────────

/**
 * 递归扫描:目录里直接有 snapshot.json 或 summary.json → 处理并计 found,不再向下找;
 * 否则递归子目录;子树全部未 found 且 depth ≤ 2 且该目录(递归)含 artifact/result 文件 →
 * 折叠成 skipped("incomplete"),计 found —— 把 attempt 级噪音折叠到实验/快照层,
 * 旧版(v3 及更早)run 目录直接 crash 在 depth 1 也被这条规则覆盖。
 */
async function scan(dir: string, depth: number, state: ScanState): Promise<boolean> {
  if (await hasFile(dir, SNAPSHOT_FILE)) {
    await handleMetaFile(join(dir, SNAPSHOT_FILE), state);
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
    state.skipped.push({ dir, reason: "incomplete" });
    return true;
  }
  return anyFound;
}

/** 读一份元数据文件(snapshot.json 或历史版本 summary.json),按分类结果分流。 */
async function handleMetaFile(path: string, state: ScanState): Promise<void> {
  const dir = dirname(path);
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    state.skipped.push({ dir, reason: "malformed", detail: `cannot read file (${e instanceof Error ? e.message : String(e)})` });
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    state.skipped.push({ dir, reason: "malformed", detail: "invalid JSON" });
    return;
  }

  const classified = classifySnapshot(raw);
  switch (classified.kind) {
    case "not-a-report":
      return; // 无关 JSON,静默忽略(调用方仍把此目录计为 found,不触发 incomplete 折叠)。
    case "malformed":
      state.skipped.push({ dir, reason: "malformed", detail: classified.detail });
      return;
    case "incompatible":
      state.skipped.push({
        dir,
        reason: "incompatible-version",
        schemaVersion: classified.schemaVersion,
        ...(classified.producer ? { producer: classified.producer } : {}),
      });
      return;
    case "ok": {
      const snapshot = await readSnapshotDir(dir, classified.meta, state);
      state.snapshots.push(snapshot);
      return;
    }
  }
}

// ───────────────────────── 快照读取 ─────────────────────────

/** 快照目录:递归收集全部 result.json,组装成 evals / attempts;单个 result.json 坏 JSON 不拖垮快照。 */
async function readSnapshotDir(dir: string, meta: SnapshotMeta, state: ScanState): Promise<Snapshot> {
  const snapshot: Snapshot = {
    experimentId: meta.experimentId,
    startedAt: meta.startedAt,
    ...(meta.completedAt !== undefined ? { completedAt: meta.completedAt } : {}),
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

  const resultPaths = (await findResultFiles(dir)).sort();
  const evalsById = new Map<string, Eval>();

  for (const resultPath of resultPaths) {
    const attemptDir = dirname(resultPath);
    let record: EvalResult;
    try {
      const text = await readFile(resultPath, "utf-8");
      record = JSON.parse(text) as EvalResult;
    } catch (e) {
      state.skipped.push({ dir: attemptDir, reason: "malformed", detail: `invalid result.json (${e instanceof Error ? e.message : String(e)})` });
      continue;
    }

    // 快照级字段拼合:「缺才补」,条目自带的值(携带条目的 startedAt)优先。
    record.experimentId ??= meta.experimentId;
    record.agent ??= meta.agent;
    if (record.model === undefined && meta.model !== undefined) record.model = meta.model;
    record.startedAt ??= meta.startedAt;
    if (record.experiment === undefined && meta.experiment !== undefined) record.experiment = meta.experiment;
    // locator 同理「缺才补」:niceeval 自己的 writer(schemaVersion 5 起)恒会写这个字段,
    // 携带条目原样携带上一轮的值——只有真缺失(第三方 harness 没实现 locator,或手工构造的
    // 落盘)才按当前身份兜底算一份;这份兜底不保证跨未来的 --resume 稳定,但至少确定性、
    // 可解析,不比完全没有 locator 差。
    record.locator ??= encodeAttemptLocator({
      experimentId: record.experimentId,
      snapshotStartedAt: meta.startedAt,
      evalId: record.id,
      attempt: record.attempt,
    });

    const attempt = makeAttempt(snapshot, dir, attemptDir, record);
    let ev = evalsById.get(record.id);
    if (!ev) {
      ev = { id: record.id, attempts: [] };
      evalsById.set(record.id, ev);
      snapshot.evals.push(ev);
    }
    ev.attempts.push(attempt);
  }

  for (const ev of snapshot.evals) {
    // attempt 序号升序,同号按 startedAt。
    ev.attempts.sort((a, b) => a.result.attempt - b.result.attempt || (a.result.startedAt ?? "").localeCompare(b.result.startedAt ?? ""));
  }
  snapshot.attempts = snapshot.evals.flatMap((ev) => ev.attempts);
  return snapshot;
}

function makeAttempt(snapshot: Snapshot, snapshotDir: string, attemptDir: string, record: EvalResult): AttemptHandle {
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
    snapshot: `${basename(dirname(snapshotDir))}/${basename(snapshotDir)}`,
    attempt: relative(snapshotDir, attemptDir).split(sep).join("/"),
  };

  return {
    evalId: record.id,
    experimentId: record.experimentId!,
    result: record,
    ref,
    snapshot,
    locator: record.locator as AttemptLocator,
    events: lazyArtifact<StreamEvent[]>(candidates, "events", record.events),
    trace: lazyArtifact<TraceSpan[]>(candidates, "trace", record.trace),
    o11y: lazyArtifact<O11ySummary>(candidates, "o11y", record.o11y),
    agentSetup: lazyArtifact<AgentSetupManifest>(candidates, "agentSetup", record.agentSetup),
    diff: lazyArtifact<DiffData>(candidates, "diff", record.diff),
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
        out.push({ path: ref.path, content: blob.content });
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
function buildExperiments(snapshots: Snapshot[]): Experiment[] {
  const byId = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    const group = byId.get(snapshot.experimentId);
    if (group) group.push(snapshot);
    else byId.set(snapshot.experimentId, [snapshot]);
  }

  const experiments: Experiment[] = [];
  for (const [id, group] of byId) {
    group.sort((a, b) => (isNewerSnapshot(a, b) ? -1 : 1));
    // 已知并集 = 本地历史(各快照覆盖的题)∪ 各快照携带的 knownEvalIds ——
    // 不是「优先字段」:把快照复制进已有历史的目录时,本地并集可能更大,优先字段会让分母缩水。
    const ids = new Set<string>();
    for (const snapshot of group) {
      for (const ev of snapshot.evals) ids.add(ev.id);
      for (const known of snapshot.knownEvalIds ?? []) ids.add(known);
    }
    const experiment: Experiment = { id, snapshots: group, latest: group[0], evalIds: [...ids].sort() };
    for (const snapshot of group) experimentBySnapshot.set(snapshot, experiment);
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
