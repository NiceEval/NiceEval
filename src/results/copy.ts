// copySnapshots:把选中快照按格式感知地复制到另一个目录(定稿见 docs/feature/results/library.md「复制与瘦身」)。
//
// 发布场景的原语:只带指定 artifact、只带选中快照的全部 attempt,布局知识不外泄。
// artifact 复制忠实于源(copyFile 原字节,不重新序列化、不消毒);snapshot.json / result.json
// 按选中条目重建,版本元数据保留。产物是一个标准结果根目录(同布局),openResults /
// `niceeval view` 直接能读。唯一随行补记的是挑选时的覆盖事实:每个复制出的快照带上
// knownEvalIds(复制时刻该实验已知的 eval 并集),发布目录上重新 openResults().latest(),
// 残缺警告被同一套机制重新算出来,不靠发布者转述。

import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { EvalResult } from "../types.ts";
import { RESULTS_FORMAT } from "../types.ts";
import { RESULT_FILE, SNAPSHOT_FILE, artifactFileOf, experimentDirOf } from "./format.ts";
import { experimentOfSnapshot } from "./open.ts";
import { isNewerSnapshot } from "./select.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";
import type { ArtifactKind, AttemptHandle, Selection, Snapshot, SnapshotMeta } from "./types.ts";
import { ARTIFACT_KINDS } from "./types.ts";

export interface CopySnapshotsOptions {
  /** 要带上的 artifact 种类;省略 = 全部六类。diff 可达百 MB,发布时常见地不带;o11y 只有几 KB,报告用 turns 这类 artifact 档指标(见 docs/feature/reports/library.md「内置指标」)时记得带上。 */
  artifacts?: ArtifactKind[];
}

export interface CopySnapshotsResult {
  /** 目标结果根目录的绝对路径。 */
  dir: string;
  /** 复制过程中的警告(如同一实验选中多个快照);不静默。 */
  warnings: string[];
}

/**
 * 把选中快照复制成 `destDir` 下的一个标准结果根目录(`<experiment-dir>/<源快照目录名>/`,
 * 快照目录名原样保留,身份不变)。输入收 Selection 或手工挑的 Snapshot[]
 * (与 Reports 计算函数同一输入约定)。目标目录非空即报错,不静默覆盖、不合并。
 */
export async function copySnapshots(
  selection: Selection | Snapshot[],
  destDir: string,
  opts?: CopySnapshotsOptions,
): Promise<CopySnapshotsResult> {
  const selected = Array.isArray(selection) ? selection : selection.snapshots;
  if (selected.length === 0) {
    throw new Error(
      "copySnapshots got no snapshots to copy. Check the experiments filter, or pass snapshots from openResults().latest().",
    );
  }
  const kinds = opts?.artifacts ?? [...ARTIFACT_KINDS];
  for (const kind of kinds) {
    if (!ARTIFACT_KINDS.includes(kind)) {
      throw new Error(
        `Unknown artifact kind "${String(kind)}" in copySnapshots options. Valid kinds: ${ARTIFACT_KINDS.join(", ")}.`,
      );
    }
  }
  const dest = resolve(destDir);
  await assertEmptyDestination(dest);

  // 同一 experiment 选中多个快照 → 只带最新的那个,记 warning(无胜者逻辑:一旦落到单快照,
  // 快照内 evalId+attempt 天然唯一)。
  const byExperiment = new Map<string, Snapshot>();
  const warnings: string[] = [];
  for (const snapshot of selected) {
    const existing = byExperiment.get(snapshot.experimentId);
    if (!existing) {
      byExperiment.set(snapshot.experimentId, snapshot);
      continue;
    }
    warnings.push(
      `warning: multiple snapshots selected for experiment "${snapshot.experimentId}"; kept the newest one, dropped the rest. Dedupe with Selection.filter() or pick a single snapshot per experiment before copySnapshots to avoid this.`,
    );
    if (isNewerSnapshot(snapshot, existing)) byExperiment.set(snapshot.experimentId, snapshot);
  }

  await mkdir(dest, { recursive: true });
  for (const snapshot of byExperiment.values()) {
    await copyOneSnapshot(snapshot, selected, dest, kinds);
  }

  return { dir: dest, warnings };
}

async function copyOneSnapshot(snapshot: Snapshot, selected: Snapshot[], destRoot: string, kinds: ArtifactKind[]): Promise<void> {
  const destSnapDir = join(destRoot, experimentDirOf(snapshot.experimentId), basename(snapshot.dir));
  await mkdir(destSnapDir, { recursive: true });

  // sources 的去重仓库(sources/<sha256>.json)是快照级的:同一份源码被多个 attempt 引用时,
  // 复制到目的地也只应该有一份——这个 Set 记录本快照已经落过盘的 hash,整快照的 attempt 共享。
  const copiedSourceHashes = new Set<string>();
  for (const attempt of snapshot.attempts) {
    await copyOneAttempt(attempt, destSnapDir, kinds, copiedSourceHashes);
  }

  const knownEvalIds = experimentOfSnapshot(snapshot)?.evalIds ?? fallbackUnion(selected, snapshot.experimentId);
  const meta: SnapshotMeta = {
    format: RESULTS_FORMAT,
    schemaVersion: snapshot.schemaVersion,
    producer: snapshot.producer,
    experimentId: snapshot.experimentId,
    ...(snapshot.experiment !== undefined ? { experiment: snapshot.experiment } : {}),
    agent: snapshot.agent,
    ...(snapshot.model !== undefined ? { model: snapshot.model } : {}),
    startedAt: snapshot.startedAt,
    ...(snapshot.completedAt !== undefined ? { completedAt: snapshot.completedAt } : {}),
    ...(knownEvalIds.length ? { knownEvalIds } : {}),
    ...(snapshot.name !== undefined ? { name: snapshot.name } : {}),
  };
  await writeFile(join(destSnapDir, SNAPSHOT_FILE), JSON.stringify(meta, null, 2), "utf-8");
}

async function copyOneAttempt(
  attempt: AttemptHandle,
  destSnapDir: string,
  kinds: ArtifactKind[],
  copiedSourceHashes: Set<string>,
): Promise<void> {
  const destAttemptDir = join(destSnapDir, attempt.ref.attempt);
  await mkdir(destAttemptDir, { recursive: true });

  // sources 是唯一「两层」的 artifact(attempt 级引用 + 快照级去重仓库),不能像其它四类那样
  // 单文件 copyFile 原字节完事——原字节只是引用,不带内容。走读取面已经会解引用+回退的
  // attempt.sources() 拿到完整内容,再在目的地按内容哈希重新去重落盘,天然吸收 artifactBase
  // 回退链(携带条目复制后,原快照可能不在目的地里,必须此刻把内容落到自己脚下)。
  const genericKinds = kinds.filter((k) => k !== "sources");
  const files = await findArtifactFiles(attempt, genericKinds);
  await Promise.all(files.map(({ kind, source }) => copyFile(source, join(destAttemptDir, artifactFileOf(kind)))));
  const copied = new Set(files.map((f) => f.kind));

  if (kinds.includes("sources")) {
    const wroteSources = await copySources(attempt, destSnapDir, destAttemptDir, copiedSourceHashes);
    if (wroteSources) copied.add("sources");
  }

  const record = slimForCopy(attempt.result, copied);
  await writeFile(join(destAttemptDir, RESULT_FILE), JSON.stringify(record, null, 2), "utf-8");
}

/**
 * sources 的复制:经 attempt.sources() 拿到已解引用的完整内容(null / 空数组 = 没有,不写任何
 * 文件,与其它 artifact「空数据不落文件」的约定一致),按内容 sha256 写进目的快照的
 * `sources/<sha256>.json`(同一快照内已经写过的 hash 不重写),attempt 目录下落一份引用。
 */
async function copySources(
  attempt: AttemptHandle,
  destSnapDir: string,
  destAttemptDir: string,
  copiedSourceHashes: Set<string>,
): Promise<boolean> {
  const sources = await attempt.sources();
  if (!sources || sources.length === 0) return false;

  const destStoreDir = join(destSnapDir, "sources");
  const refs: { path: string; sha256: string }[] = [];
  for (const src of sources) {
    const sha256 = hashEvalSource(normalizeEvalSource(src.content));
    refs.push({ path: src.path, sha256 });
    if (!copiedSourceHashes.has(sha256)) {
      await mkdir(destStoreDir, { recursive: true });
      await writeFile(join(destStoreDir, `${sha256}.json`), JSON.stringify({ content: src.content }), "utf-8");
      copiedSourceHashes.add(sha256);
    }
  }
  await writeFile(join(destAttemptDir, artifactFileOf("sources")), JSON.stringify(refs), "utf-8");
  return true;
}

/** 目标目录非空即报错:盘上不该出现「我没写的东西被动过」的惊讶;发布脚本要幂等就自己先清目录。 */
async function assertEmptyDestination(dest: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === "ENOENT") return;
    throw new Error(
      `Destination "${dest}" is not a usable directory (${e instanceof Error ? e.message : String(e)}). Pass a new or empty directory.`,
    );
  }
  if (entries.length > 0) {
    throw new Error(
      `Destination directory "${dest}" is not empty. copySnapshots never overwrites or merges; delete the directory first if you want to replace it.`,
    );
  }
}

/** 源 artifact 定位:与读取面同一候选顺序(本 attempt 目录优先,artifactBase 回退)。 */
async function findArtifactFiles(
  attempt: AttemptHandle,
  kinds: ArtifactKind[],
): Promise<{ kind: ArtifactKind; source: string }[]> {
  const candidates: string[] = [join(attempt.snapshot.dir, attempt.ref.attempt)];
  if (attempt.result.artifactBase) {
    candidates.push(resolve(dirname(dirname(attempt.snapshot.dir)), attempt.result.artifactBase));
  }

  const found: { kind: ArtifactKind; source: string }[] = [];
  for (const kind of kinds) {
    for (const dir of candidates) {
      const source = join(dir, artifactFileOf(kind));
      try {
        if ((await stat(source)).isFile()) {
          found.push({ kind, source });
          break;
        }
      } catch {
        // 缺文件跳过:某类数据为空本来就不生成对应 JSON(docs/feature/results/architecture.md)。
      }
    }
  }
  return found;
}

/**
 * 重建 attempt 记录:去掉快照级字段(agent/model/experimentId/experiment,目标 snapshot.json
 * 已经带了)与 artifactBase(artifact 已本地化,不再需要回退指针);has* 按目标目录实际复制到的
 * 种类重算。startedAt 是 attempt 级事实(身份键与「何时跑的」都靠它),原样保留。
 */
function slimForCopy(r: EvalResult, copied: Set<ArtifactKind>): Record<string, unknown> {
  const {
    agent,
    model,
    experimentId,
    experiment,
    events,
    sources,
    o11y,
    trace,
    agentSetup,
    diff,
    rawTranscript,
    artifactBase,
    hasTrace,
    hasEvents,
    hasSources,
    ...rest
  } = r;
  void agent;
  void model;
  void experimentId;
  void experiment;
  void events;
  void sources;
  void o11y;
  void trace;
  void agentSetup;
  void diff;
  void rawTranscript;
  void artifactBase;
  void hasTrace;
  void hasEvents;
  void hasSources;
  return {
    ...rest,
    hasEvents: copied.has("events"),
    hasTrace: copied.has("trace"),
    hasSources: copied.has("sources"),
  };
}

/** experimentOfSnapshot 查不到归属(手工构造的 Snapshot[])时的兜底:同 id 输入快照的覆盖 ∪ 携带值。 */
function fallbackUnion(selected: Snapshot[], experimentId: string): string[] {
  const ids = new Set<string>();
  for (const snapshot of selected) {
    if (snapshot.experimentId !== experimentId) continue;
    for (const ev of snapshot.evals) ids.add(ev.id);
    for (const known of snapshot.knownEvalIds ?? []) ids.add(known);
  }
  return [...ids].sort();
}
