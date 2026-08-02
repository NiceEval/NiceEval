// publish:把选中快照按格式感知地复制到另一个目录(定稿见 docs/feature/record/library.md「复制与瘦身」)。
//
// 发布场景的原语:只带指定 artifact、只带选中快照的全部 attempt,布局知识不外泄。
// artifact 复制忠实于源(原字节,不重新序列化、不改写);run.json / result.json
// 按选中条目重建,版本元数据保留。产物是一个标准结果根目录(同布局),openRecord /
// `niceeval view` 直接能读。唯一随行补记的是挑选时的覆盖事实:每个复制出的快照带上
// knownEvalIds(复制时刻该实验已知的 eval 并集),发布目录上重新 openRecord().latest(),
// 残缺警告被同一套机制重新算出来,不靠发布者转述。

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { EvalResult } from "../types.ts";
import { RECORD_FORMAT } from "../types.ts";
import { RESULT_FILE, RUN_FILE, artifactFileOf, experimentDirOf } from "./format.ts";
import { experimentOfSnapshot } from "./open.ts";
import { isNewerSnapshot } from "../sample/index.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";
import { PUBLISH_FILE_MAX_BYTES } from "./publish.ts";
import type { ArtifactKind, AttemptHandle, Sample, Run, RunMeta } from "./types.ts";

/** 缺省携带的 artifact:commands / events / trace / o11y / agentSetup / sources;diff 不截断、
 *  可达百 MB,缺省不带。commands 缺省带的理由单独交代:失败命令证据是 errored attempt 的主要
 *  下钻面,不能默认发布拷贝时静默删掉(见 docs/feature/record/library.md「复制与瘦身」)。 */
const DEFAULT_PUBLISH_ARTIFACTS: ArtifactKind[] = ["commands", "events", "trace", "o11y", "agentSetup", "sources"];
const VALID_ARTIFACTS: ArtifactKind[] = ["commands", "events", "trace", "o11y", "agentSetup", "diff", "sources"];

export interface CopySnapshotsOptions {
  /** 要带上的 artifact 种类;缺省带 commands / events / trace / o11y / agentSetup / sources,不带 diff。 */
  artifacts?: ArtifactKind[];
}

export interface CopySnapshotsResult {
  /** 目标结果根目录的绝对路径。 */
  dir: string;
  /** 复制过程中的警告(如同一实验选中多个快照);不静默。 */
  issues: string[];
}

/**
 * 把选中快照复制成 `destDir` 下的一个标准结果根目录(`<experiment-dir>/<源快照目录名>/`,
 * 快照目录名原样保留,身份不变)。输入收 Sample 或手工挑的 Run[]
 * (与 Reports 计算函数同一输入约定)。目标目录非空即报错,不静默覆盖、不合并。
 */
export async function publish(
  scope: Sample | readonly Run[],
  destDir: string,
  opts: CopySnapshotsOptions = {},
): Promise<CopySnapshotsResult> {
  const selected = Array.isArray(scope) ? (scope as readonly Run[]) : (scope as Sample).runs;
  if (selected.length === 0) {
    throw new Error(
      "publish got no runs to copy. Check the experiments filter, or pass runs from openRecord().latest().",
    );
  }
  const kinds = opts.artifacts ?? [...DEFAULT_PUBLISH_ARTIFACTS];
  for (const kind of kinds) {
    if (!VALID_ARTIFACTS.includes(kind)) {
      throw new Error(
        `Unknown artifact kind "${String(kind)}" in publish options. Valid kinds: ${VALID_ARTIFACTS.join(", ")}.`,
      );
    }
  }
  const dest = resolve(destDir);
  await assertEmptyDestination(dest);

  // 同一 experiment 选中多个快照 → 只带最新的那个,记 warning(无胜者逻辑:一旦落到单快照,
  // 快照内 evalId+attempt 天然唯一)。
  const byExperiment = new Map<string, Run>();
  const issues: string[] = [];
  for (const run of selected) {
    const existing = byExperiment.get(run.experimentId);
    if (!existing) {
      byExperiment.set(run.experimentId, run);
      continue;
    }
    issues.push(
      `warning: multiple runs selected for experiment "${run.experimentId}"; kept the newest one, dropped the rest. Dedupe with Sample.filter() or pick a single run per experiment before publish to avoid this.`,
    );
    if (isNewerSnapshot(run, existing)) byExperiment.set(run.experimentId, run);
  }

  // 发布前整文件预检:先规划并序列化全部目标文件,任一文件超过 PUBLISH_FILE_MAX_BYTES
  // 就整体失败,不留半成品目标目录。
  const planned: PlannedFile[] = [];
  for (const run of byExperiment.values()) {
    planned.push(...(await planOneSnapshot(run, [...selected], dest, kinds)));
  }
  const oversized = planned.filter((f) => f.bytes.byteLength > PUBLISH_FILE_MAX_BYTES);
  if (oversized.length > 0) {
    const lines = oversized.map(
      (f) =>
        `  ${f.source ?? f.path}: ${f.bytes.byteLength} bytes (limit ${PUBLISH_FILE_MAX_BYTES}). Exclude that artifact kind from "artifacts", or regenerate the history with the current writer.`,
    );
    throw new Error(`publish publish precheck failed; ${oversized.length} file(s) exceed the 50 MiB publish budget:\n${lines.join("\n")}`);
  }

  await mkdir(dest, { recursive: true });
  for (const file of planned) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.bytes);
  }

  return { dir: dest, issues };
}

interface PlannedFile {
  /** 目标绝对路径。 */
  path: string;
  /** 序列化(且已消毒)后的字节。 */
  bytes: Buffer;
  /** 源文件路径(预检报错定位用);重建的 json 没有单一源。 */
  source?: string;
}

async function planOneSnapshot(
  run: Run,
  selected: Run[],
  destRoot: string,
  kinds: ArtifactKind[],
): Promise<PlannedFile[]> {
  const destSnapDir = join(destRoot, experimentDirOf(run.experimentId), basename(run.dir));
  const planned: PlannedFile[] = [];

  // sources 的去重仓库(sources/<sha256>.json)是快照级的:同一份源码被多个 attempt 引用时,
  // 复制到目的地也只应该有一份——这个 Set 记录本快照已经规划过的 hash,整快照的 attempt 共享。
  const plannedSourceHashes = new Set<string>();
  for (const attempt of run.attempts) {
    planned.push(...(await planOneAttempt(attempt, destSnapDir, kinds, plannedSourceHashes)));
  }

  const knownEvalIds = experimentOfSnapshot(run)?.knownEvalIds ?? fallbackUnion(selected, run.experimentId);
  const meta: RunMeta = {
    format: RECORD_FORMAT,
    schemaVersion: run.schemaVersion,
    producer: run.producer,
    runId: run.runId,
    experimentId: run.experimentId,
    ...(run.experiment !== undefined ? { experiment: run.experiment } : {}),
    agent: run.agent,
    ...(run.model !== undefined ? { model: run.model } : {}),
    startedAt: run.startedAt,
    ...(run.configHash !== undefined ? { configHash: run.configHash } : {}),
    ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
    ...(run.diagnostics?.length ? { diagnostics: run.diagnostics } : {}),
    ...(run.facts && Object.keys(run.facts).length ? { facts: run.facts } : {}),
    ...(run.timings?.length ? { timings: run.timings } : {}),
    ...(run.sandboxBuilds?.length ? { sandboxBuilds: run.sandboxBuilds } : {}),
    ...(knownEvalIds.length ? { knownEvalIds } : {}),
    ...(run.name !== undefined ? { name: run.name } : {}),
  };
  planned.push({ path: join(destSnapDir, RUN_FILE), bytes: Buffer.from(JSON.stringify(meta, null, 2), "utf-8") });
  return planned;
}

async function planOneAttempt(
  attempt: AttemptHandle,
  destSnapDir: string,
  kinds: ArtifactKind[],
  plannedSourceHashes: Set<string>,
): Promise<PlannedFile[]> {
  const destAttemptDir = join(destSnapDir, attempt.ref.attempt);
  const planned: PlannedFile[] = [];

  // sources 是唯一「两层」的 artifact(attempt 级引用 + 快照级去重仓库),不能像其它四类那样
  // 单文件原字节完事——原字节只是引用,不带内容。走读取面已经会解引用+回退的 attempt.sources()
  // 拿到完整内容,按内容哈希重新去重落盘——发布根里引用与内容永远一致,携带条目也被归拢进本快照。
  const genericKinds = kinds.filter((k) => k !== "sources");
  const files = await findArtifactFiles(attempt, genericKinds);
  const copied = new Set(files.map((f) => f.kind));
  for (const { kind, source } of files) {
    planned.push({ path: join(destAttemptDir, artifactFileOf(kind)), bytes: await readFile(source), source });
  }

  if (kinds.includes("sources")) {
    const sources = await attempt.sources();
    if (sources && sources.length > 0) {
      copied.add("sources");
      const destStoreDir = join(destSnapDir, "sources");
      const refs: { path: string; sha256: string }[] = [];
      for (const src of sources) {
        const sha256 = hashEvalSource(normalizeEvalSource(src.content));
        refs.push({ path: src.path, sha256 });
        if (!plannedSourceHashes.has(sha256)) {
          planned.push({
            path: join(destStoreDir, `${sha256}.json`),
            bytes: Buffer.from(JSON.stringify({ content: src.content }), "utf-8"),
          });
          plannedSourceHashes.add(sha256);
        }
      }
      planned.push({
        path: join(destAttemptDir, artifactFileOf("sources")),
        bytes: Buffer.from(JSON.stringify(refs), "utf-8"),
      });
    }
  }

  const record = slimForCopy(attempt.result, copied);
  planned.push({ path: join(destAttemptDir, RESULT_FILE), bytes: Buffer.from(JSON.stringify(record, null, 2), "utf-8") });
  return planned;
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
      `Destination directory "${dest}" is not empty. publish never overwrites or merges; delete the directory first if you want to replace it.`,
    );
  }
}

/** 源 artifact 定位:与读取面同一候选顺序(本 attempt 目录优先,artifactBase 回退)。 */
async function findArtifactFiles(
  attempt: AttemptHandle,
  kinds: ArtifactKind[],
): Promise<{ kind: ArtifactKind; source: string }[]> {
  const candidates: string[] = [join(attempt.run.dir, attempt.ref.attempt)];
  if (attempt.result.artifactBase) {
    candidates.push(resolve(dirname(dirname(attempt.run.dir)), attempt.result.artifactBase));
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
        // 缺文件跳过:某类数据为空本来就不生成对应 JSON(docs/feature/record/architecture.md)。
      }
    }
  }
  return found;
}

/**
 * 重建 attempt 记录:去掉快照级字段(agent/model/experimentId/experiment,目标 run.json
 * 已经带了)与 artifactBase(artifact 已本地化,不再需要回退指针);artifacts 词干列表按目标目录
 * 实际复制到的种类重算(不沿用源条目的旧列表)。startedAt 是 attempt 级事实(身份键与「何时跑的」
 * 都靠它),原样保留。
 */
function slimForCopy(r: EvalResult, copied: Set<ArtifactKind>): globalThis.Record<string, unknown> {
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
    commands,
    rawTranscript,
    artifactBase,
    artifacts: _artifacts,
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
  void commands;
  void rawTranscript;
  void artifactBase;
  void _artifacts;
  // VALID_ARTIFACTS 的固定顺序驱动输出顺序,与写入面(events/trace/o11y/agentSetup/diff/sources)一致。
  const artifacts = VALID_ARTIFACTS.filter((kind) => copied.has(kind));
  return {
    ...rest,
    ...(artifacts.length ? { artifacts } : {}),
  };
}

/** experimentOfSnapshot 查不到归属(手工构造的 Run[])时的兜底:同 id 输入快照的覆盖 ∪ 携带值。 */
function fallbackUnion(selected: Run[], experimentId: string): string[] {
  const ids = new Set<string>();
  for (const run of selected) {
    if (run.experimentId !== experimentId) continue;
    for (const ev of run.evals) ids.add(ev.id);
    for (const known of run.knownEvalIds ?? []) ids.add(known);
  }
  return [...ids].sort();
}
