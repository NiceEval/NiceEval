// createResultsWriter:Results Format 的写入面(定稿见 docs/feature/results/library.md「写:createResultsWriter」)。
//
// writer 与 reader 是同一组类型的两半,而且是字面的两半:reader 的 attempt.result 由
// 「snapshot() 声明的快照级字段(experimentId / agent / model / startedAt / experiment)+
// writeAttempt 第一参」拼成,快照级字段不在 attempt 参数类型里(AttemptEntry 的 Omit),
// 不存在「谁的值为准」。布局知识(快照目录独占创建、attempt 路径清洗、大字段拆 artifact、
// has* 回填、空数据不落文件)全在这里;src/runner/reporters/artifacts.ts 是本文件的薄壳。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSetupManifest, EvalResult, ExperimentRunInfo, LocalizedText } from "../types.ts";
import type { DiffData, O11ySummary, SourceArtifact, StreamEvent, TraceSpan } from "../types.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";
import { RESULT_FILE, SNAPSHOT_FILE, artifactFileOf, attemptDirOf, experimentDirOf } from "./format.ts";
import { encodeAttemptLocator } from "./locator.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";
import type { Producer, SnapshotMeta } from "./types.ts";

export interface ResultsWriterOptions {
  /** 谁在写这份结果:niceeval 自己,或第三方 harness(name 如实写,别冒充 "niceeval")。 */
  producer: Producer;
}

/** 快照级声明:一个 experiment 声明一次,这些字段不塞进每条 attempt。 */
export interface SnapshotDeclaration {
  experimentId: string;
  agent: string;
  model?: string;
  /** 必填:身份键与去重以它为锚,官方产出永不缺。 */
  startedAt: string;
  /** 转换历史数据时如实交代收尾时刻;省略则 finish() 用当前时刻。 */
  completedAt?: string;
  /** 实验运行配置(flags / runs / earlyExit / sandbox / timeoutMs / budget),快照内全部 attempt 共享。 */
  experiment?: ExperimentRunInfo;
  /** 该实验已知的 eval 并集(残缺检测的分母);转换只覆盖部分题目时如实交代全集。 */
  knownEvalIds?: string[];
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
}

/**
 * writeAttempt 的第一参 = attempt 级条目:reader 的 attempt.result 中,快照级字段
 * (experimentId / agent / model / startedAt / experiment)与引用字段(artifactBase / has*)
 * 以外的全部;引用字段由 writer 按实际写入的 artifact 回填。
 */
export type AttemptEntry = Omit<
  EvalResult,
  | "agent"
  | "model"
  | "startedAt"
  | "experimentId"
  | "experiment"
  | "events"
  | "sources"
  | "o11y"
  | "trace"
  | "agentSetup"
  | "diff"
  | "rawTranscript"
  | "artifactBase"
  | "hasTrace"
  | "hasEvents"
  | "hasSources"
>;

/** writeAttempt 的第二参:reader 懒加载能拿到的那几样 artifact,全部可选;缺哪样读取面就懒加载出 null。 */
export interface AttemptArtifacts {
  events?: StreamEvent[];
  trace?: TraceSpan[];
  o11y?: O11ySummary;
  /** agent setup 的安装清单(沙箱型 coding agent 装了 Skill / plugin / MCP 才有)。 */
  agentSetup?: AgentSetupManifest;
  diff?: DiffData;
  sources?: SourceArtifact[];
}

export interface SnapshotWriter {
  /** 本快照的目录(绝对路径)。 */
  readonly dir: string;
  /** 增量落盘一条 attempt:拆 artifact 文件、回填 has* 引用、写 result.json;空数据不落文件。 */
  writeAttempt(entry: AttemptEntry, artifacts?: AttemptArtifacts): Promise<void>;
}

export interface ResultsWriter {
  /**
   * 建快照目录(独占创建,撞名换随机后缀重试)+ 立即写 snapshot.json(不含 completedAt)。
   * 同一 writer 内同 experimentId 重复声明 → 返回同一个 SnapshotWriter(懒建语义;
   * knownEvalIds 取并集,completedAt / name 以最后一次声明为准,finish() 时才落盘)。
   */
  snapshot(decl: SnapshotDeclaration): Promise<SnapshotWriter>;
  /** 给每个已声明的快照补 completedAt(decl.completedAt ?? 当前时刻)与 name(参数优先,声明兜底)。 */
  finish(opts?: { name?: LocalizedText }): Promise<void>;
  /** @internal runner 薄壳入口:按 EvalResult 的 experimentId 懒建快照并落盘一条 attempt。 */
  writeAttemptFor(result: EvalResult): Promise<void>;
  /** @internal 已创建快照清单(CLI 收尾打印)。 */
  snapshotDirs(): { experimentId: string; dir: string }[];
}

interface SnapshotState {
  /** 快照的权威 meta(不含 completedAt;knownEvalIds 随重复声明累加)。 */
  meta: SnapshotMeta;
  dir: string;
  writer: SnapshotWriter;
  declCompletedAt?: string;
  declName?: LocalizedText;
}

/** 同步:不建目录、不碰磁盘。目录创建发生在第一次 snapshot() 调用里。 */
export function createResultsWriter(root: string, opts: ResultsWriterOptions): ResultsWriter {
  const pending = new Map<string, Promise<SnapshotState>>();
  const created: { experimentId: string; dir: string }[] = [];
  let finished = false;

  async function buildSnapshot(decl: SnapshotDeclaration): Promise<SnapshotState> {
    const meta: SnapshotMeta = {
      format: RESULTS_FORMAT,
      schemaVersion: RESULTS_SCHEMA_VERSION,
      producer: opts.producer,
      experimentId: decl.experimentId,
      // 运行配置不带 id:身份的家是顶层 experimentId,重复一份只会引出「以谁为准」。
      ...(decl.experiment !== undefined ? { experiment: stripInfoId(decl.experiment) } : {}),
      agent: decl.agent,
      ...(decl.model !== undefined ? { model: decl.model } : {}),
      startedAt: decl.startedAt,
      ...(decl.knownEvalIds?.length ? { knownEvalIds: [...new Set(decl.knownEvalIds)] } : {}),
      ...(decl.name !== undefined ? { name: decl.name } : {}),
    };
    const dir = await createSnapshotDir(root, decl.experimentId);
    await writeFile(join(dir, SNAPSHOT_FILE), JSON.stringify(meta, null, 2), "utf-8");
    created.push({ experimentId: decl.experimentId, dir });
    // 快照级源码去重仓库:sha256 → 落盘 Promise,同一快照内并发/重复的 writeAttempt 共享同一次写入
    // (Map 的 has/set 之间没有 await,JS 单线程语义下不会重复起两次写)。
    const sourceStore = new Map<string, Promise<void>>();
    const writer: SnapshotWriter = {
      dir,
      async writeAttempt(entry: AttemptEntry, artifacts?: AttemptArtifacts): Promise<void> {
        await writeAttemptFiles(dir, { experimentId: meta.experimentId, startedAt: meta.startedAt }, entry, artifacts, sourceStore);
      },
    };
    return { meta, dir, writer, declCompletedAt: decl.completedAt, declName: decl.name };
  }

  async function snapshotImpl(decl: SnapshotDeclaration): Promise<SnapshotWriter> {
    if (!decl.experimentId || !decl.agent || !decl.startedAt) {
      throw new Error(
        "writer.snapshot() requires experimentId, agent and startedAt. They are snapshot-level identity: declare them once here instead of on each attempt.",
      );
    }
    const existing = pending.get(decl.experimentId);
    const statePromise: Promise<SnapshotState> = existing
      ? existing.then((state) => {
          if (decl.knownEvalIds?.length) {
            state.meta.knownEvalIds = [...new Set([...(state.meta.knownEvalIds ?? []), ...decl.knownEvalIds!])];
          }
          if (decl.completedAt !== undefined) state.declCompletedAt = decl.completedAt;
          if (decl.name !== undefined) state.declName = decl.name;
          return state;
        })
      : buildSnapshot(decl);
    pending.set(decl.experimentId, statePromise);
    const state = await statePromise;
    return state.writer;
  }

  async function writeAttemptForImpl(result: EvalResult): Promise<void> {
    if (!result.experimentId) {
      throw new Error(
        `writeAttemptFor() requires EvalResult.experimentId (results schemaVersion ${RESULTS_SCHEMA_VERSION} lays out one directory per experiment); eval "${result.id}" has none.`,
      );
    }
    const snap = await snapshotImpl({
      experimentId: result.experimentId,
      agent: result.agent,
      model: result.model,
      // 快照 startedAt 以该实验首条落盘结果的 attempt 时刻为锚(首条 ≈ 实验开跑)。
      startedAt: result.startedAt ?? new Date().toISOString(),
      experiment: result.experiment,
    });

    if (result.artifactBase) {
      // 携带条目(--resume 合入):本轮没有任何新数据,不写 artifact、不重算 has*,
      // startedAt(身份锚)与 artifactBase 原样保留。locator 同理原样保留(在 ...rest 里,
      // 没被解构掉)、从不重算——`result` 是上一轮 openResults() 读回的记录,原快照的
      // startedAt 已经不在本轮快照里了,重算会用错的 snapshotStartedAt 算出不同的字符串,
      // 让已经发布/引用过的 locator 失效。真缺失(没经过 openResults 的手工构造)时如实留空,
      // 交给读取面按当前身份兜底算(见 open.ts 的 locator 回填),不在这里瞎猜。
      const { agent, model, experimentId, experiment, events, sources, o11y, trace, agentSetup, diff, rawTranscript, ...rest } =
        result;
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
      const attemptDir = join(snap.dir, attemptDirOf(result));
      await mkdir(attemptDir, { recursive: true });
      await writeFile(join(attemptDir, RESULT_FILE), JSON.stringify(rest, null, 2), "utf-8");
      return;
    }

    const {
      agent,
      model,
      startedAt,
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
      ...entry
    } = result;
    void agent;
    void model;
    void experimentId;
    void experiment;
    void artifactBase;
    void hasTrace;
    void hasEvents;
    void hasSources;
    // startedAt 是 attempt 级事实(每条各异,view 靠它显示「何时跑的」),原样落盘;
    // 读取面只在记录缺失时才回退快照的 startedAt。
    const record = { ...entry, ...(startedAt !== undefined ? { startedAt } : {}) };
    await snap.writeAttempt(record as AttemptEntry, { events, sources, o11y, trace, agentSetup, diff });
  }

  return {
    snapshot: snapshotImpl,
    writeAttemptFor: writeAttemptForImpl,
    snapshotDirs(): { experimentId: string; dir: string }[] {
      return [...created];
    },

    async finish(finishOpts?: { name?: LocalizedText }): Promise<void> {
      if (finished) throw new Error("writer.finish() was already called.");
      finished = true;
      const states = await Promise.all([...pending.values()]);
      await Promise.all(
        states.map(async (state) => {
          const completedAt = state.declCompletedAt ?? new Date().toISOString();
          const name = finishOpts?.name ?? state.declName;
          const finalMeta: SnapshotMeta = {
            format: state.meta.format,
            schemaVersion: state.meta.schemaVersion,
            producer: state.meta.producer,
            experimentId: state.meta.experimentId,
            ...(state.meta.experiment !== undefined ? { experiment: state.meta.experiment } : {}),
            agent: state.meta.agent,
            ...(state.meta.model !== undefined ? { model: state.meta.model } : {}),
            startedAt: state.meta.startedAt,
            completedAt,
            ...(state.meta.knownEvalIds?.length ? { knownEvalIds: state.meta.knownEvalIds } : {}),
            ...(name !== undefined ? { name } : {}),
          };
          state.meta = finalMeta;
          await writeFile(join(state.dir, SNAPSHOT_FILE), JSON.stringify(finalMeta, null, 2), "utf-8");
        }),
      );
    },
  };
}

/** 一条 attempt 的落盘:拆 artifact 文件、算 has*、写 result.json;空数据不落文件。 */
async function writeAttemptFiles(
  snapDir: string,
  snapshot: { experimentId: string; startedAt: string },
  entry: AttemptEntry,
  artifacts: AttemptArtifacts | undefined,
  sourceStore: Map<string, Promise<void>>,
): Promise<void> {
  const attemptDir = join(snapDir, attemptDirOf(entry));
  await mkdir(attemptDir, { recursive: true });

  const hasEvents = !!(artifacts?.events && artifacts.events.length);
  const hasSources = !!(artifacts?.sources && artifacts.sources.length);
  const hasTrace = !!(artifacts?.trace && artifacts.trace.length);

  const writes: Promise<unknown>[] = [];
  if (hasEvents) writes.push(writeFile(join(attemptDir, "events.json"), JSON.stringify(artifacts!.events), "utf-8"));
  if (hasSources) writes.push(writeSourcesRef(snapDir, attemptDir, artifacts!.sources!, sourceStore));
  if (hasTrace) writes.push(writeFile(join(attemptDir, "trace.json"), JSON.stringify(artifacts!.trace), "utf-8"));
  if (artifacts?.o11y) writes.push(writeFile(join(attemptDir, "o11y.json"), JSON.stringify(artifacts.o11y), "utf-8"));
  if (artifacts?.agentSetup) {
    writes.push(
      writeFile(join(attemptDir, artifactFileOf("agentSetup")), JSON.stringify(artifacts.agentSetup), "utf-8"),
    );
  }
  if (artifacts?.diff) writes.push(writeFile(join(attemptDir, "diff.json"), JSON.stringify(artifacts.diff), "utf-8"));
  await Promise.all(writes);

  // locator:caller(如第三方 harness 直接调 SnapshotWriter.writeAttempt)已经带了就尊重,
  // 否则按当前身份元组算一份 —— 这条路径只服务「非携带」的新写入,携带条目走
  // writeAttemptForImpl 的 artifactBase 分支,原样透传 result.locator,从不落到这里重算。
  const locator =
    entry.locator ??
    encodeAttemptLocator({
      experimentId: snapshot.experimentId,
      snapshotStartedAt: snapshot.startedAt,
      evalId: entry.id,
      attempt: entry.attempt,
    });

  const record = { ...entry, locator, hasEvents, hasTrace, hasSources };
  await writeFile(join(attemptDir, RESULT_FILE), JSON.stringify(record, null, 2), "utf-8");
}

/**
 * sources 是唯一「两层」的 artifact:attempt 目录下只落一份小引用(`{path, sha256}[]`),
 * 真正的源码内容按 sha256 去重存进快照根的 `sources/<sha256>.json`——同一快照内多个 attempt
 * 引用同一份 eval 源码(同文件、同内容)只写一次盘。sourceStore 是这个快照专属的去重登记表
 * (调用方按快照生命周期传入同一个 Map),覆盖并发与重复两种场景。
 */
async function writeSourcesRef(
  snapDir: string,
  attemptDir: string,
  sources: SourceArtifact[],
  sourceStore: Map<string, Promise<void>>,
): Promise<void> {
  const storeDir = join(snapDir, "sources");
  const refs: { path: string; sha256: string }[] = [];
  for (const src of sources) {
    const sha256 = hashEvalSource(normalizeEvalSource(src.content));
    refs.push({ path: src.path, sha256 });
    if (!sourceStore.has(sha256)) {
      sourceStore.set(
        sha256,
        (async () => {
          await mkdir(storeDir, { recursive: true });
          await writeFile(join(storeDir, `${sha256}.json`), JSON.stringify({ content: src.content }), "utf-8");
        })(),
      );
    }
  }
  await Promise.all(refs.map((r) => sourceStore.get(r.sha256)!));
  await writeFile(join(attemptDir, artifactFileOf("sources")), JSON.stringify(refs), "utf-8");
}

/** 快照目录:独占创建(EEXIST 换随机后缀重试,≤5 次)。 */
async function createSnapshotDir(root: string, experimentId: string): Promise<string> {
  const parent = join(root, experimentDirOf(experimentId));
  await mkdir(parent, { recursive: true });
  let lastError: unknown;
  for (let i = 0; i < 5; i++) {
    const dir = join(parent, `${safeTimestamp(new Date())}-${randomSuffix()}`);
    try {
      await mkdir(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      lastError = e;
    }
  }
  throw new Error(`Could not create a unique snapshot directory under "${parent}" after 5 attempts (${String(lastError)}).`);
}

/** 运行配置落盘前剥掉 id:experimentId 的家在 snapshot.json 顶层。 */
function stripInfoId(info: ExperimentRunInfo): ExperimentRunInfo {
  const { id, ...rest } = info;
  void id;
  return rest;
}

/** 快照目录名的时间戳段:Date#toISOString 把 : 与 . 换成 -(与 docs/feature/results/architecture.md 一致)。 */
function safeTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

/** 快照目录名的随机后缀:4 位 [a-z0-9]。 */
function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
