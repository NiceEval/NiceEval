// createWriter:Record Format 的写入面(定稿见 docs/feature/record/library.md「写:createWriter」)。
//
// writer 与 reader 是同一组类型的两半,而且是字面的两半:reader 的 attempt.result 由
// 「run() 声明的快照级字段(experimentId / agent / model / startedAt / experiment)+
// writeAttempt 第一参」拼成,快照级字段不在 attempt 参数类型里(AttemptEntry 的 Omit),
// 不存在「谁的值为准」。布局知识(快照目录独占创建、attempt 路径清洗、大字段拆 artifact、
// has* 回填、空数据不落文件)全在这里;src/runner/reporters/artifacts.ts 是本文件的薄壳。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentSetupManifest, DiagnosticRecord, EvalResult, ExperimentRunInfo, LocalizedText, SandboxBuildRecord, TimingActivity } from "../types.ts";
import type { DiffArtifact, FailedCommandEvidence, O11ySummary, SourceArtifact, StreamEvent, TraceSpan } from "../types.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../types.ts";
import { RESULT_FILE, RUN_FILE, artifactFileOf, attemptDirOf, experimentDirOf } from "./format.ts";
import { encodeAttemptLocator } from "./locator.ts";
import { MANIFESTS_FILE, type RunManifests } from "./manifest.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";
import { truncateEvents, truncateSpans } from "./truncate.ts";
import type { Producer, RunMeta } from "./types.ts";

export interface WriterOptions {
  /** 谁在写这份结果:niceeval 自己,或第三方 harness(name 如实写,别冒充 "niceeval")。 */
  producer: Producer;
  /**
   * 本次 invocation 的快照身份锚点(ISO 时间戳,即 runner 的 `InvocationShape.snapshotStartedAt`)。
   * `writeAttemptFor()` 的隐式 run 声明统一用它做 `startedAt`,不再按「该 experiment
   * 第一条落盘 result 的 attempt startedAt」猜 —— 那个锚点依赖并发完成顺序,不确定;
   * 同一 writer 处理多个 experiment 时也共享这同一个值(locator 身份还含 experimentId,
   * 不会碰撞)。省略时退回旧行为:每次隐式声明按 `result.startedAt ?? now()` 各自取锚,
   * 供未提供该值的直调场景使用(测试、结果转换脚本、第三方 harness 直接调
   * `createWriter()` 而不经过 niceeval 自己的 runner)。显式调用 `writer.run()`
   * 声明快照的调用方不受这个选项影响,必须自己传 `RunDeclaration.startedAt`。
   */
  snapshotStartedAt?: string;
  /**
   * 本次 invocation 规划期算出的指纹输入清单,按 experimentId 分组(见
   * `runner/fingerprint.ts` 的 `CarryPlan.manifestsByKey`)。写在 Run 目录建成的那一刻,
   * 与 `run.json` 同层同批,**不随 attempt 完成回写**——只跑了一半的 Run 也已经有它。
   * 隐式 run 声明(`writeAttemptFor`)按 experimentId 取用;显式 `run()` 声明用
   * `RunDeclaration.manifests`,后者优先。
   */
  manifests?: ReadonlyMap<string, RunManifests>;
}

/** 快照级声明:一个 experiment 声明一次,这些字段不塞进每条 attempt。 */
export interface RunDeclaration {
  experimentId: string;
  agent: string;
  model?: string;
  /** 必填:身份键与去重以它为锚,官方产出永不缺。 */
  startedAt: string;
  configHash?: string;
  /** 转换历史数据时如实交代收尾时刻;省略则 finish() 用当前时刻。 */
  completedAt?: string;
  /** 实验运行配置(flags / runs / earlyExit / sandbox / timeoutMs / budget),快照内全部 attempt 共享。 */
  experiment?: ExperimentRunInfo;
  /** 该实验已知的 eval 并集(残缺检测的分母);转换只覆盖部分题目时如实交代全集。 */
  knownEvalIds?: string[];
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
  /** 本 Run 的指纹输入清单(evalId → 清单),与 `run.json` 同批写成;省略则不写该文件。 */
  manifests?: RunManifests;
}

/**
 * writeAttempt 的第一参 = attempt 级条目:reader 的 attempt.result 中,快照级字段
 * (experimentId / agent / model / startedAt / experiment)与引用字段(artifactBase / artifacts)
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
  | "commands"
  | "rawTranscript"
  | "artifactBase"
  | "artifacts"
>;

/** writeAttempt 的第二参:reader 懒加载能拿到的那几样 artifact,全部可选;缺哪样读取面就懒加载出 null。 */
export interface AttemptArtifacts {
  events?: StreamEvent[];
  trace?: TraceSpan[];
  o11y?: O11ySummary;
  /** agent setup 的安装清单(沙箱型 coding agent 装了 Skill / plugin / MCP 才有)。 */
  agentSetup?: AgentSetupManifest;
  diff?: DiffArtifact;
  sources?: SourceArtifact[];
  /** 非零 Sandbox 命令的 stdout/stderr 证据(见 docs/feature/record/architecture.md「commandsjson」)。 */
  commands?: FailedCommandEvidence[];
}

export interface RunWriter {
  /** 本快照的目录(绝对路径)。 */
  readonly dir: string;
  /** 增量落盘一条 attempt:拆 artifact 文件、回填 has* 引用、写 result.json;空数据不落文件。 */
  writeAttempt(entry: AttemptEntry, artifacts?: AttemptArtifacts): Promise<void>;
  /**
   * 封口这一个 Run:唯一一次补 `completedAt`(省略则取当前时刻)、快照级 `diagnostics`
   * (省略则不写该字段,不摆空数组)、快照级 `facts`、以及 Run 级 `timings` / `sandboxBuilds`
   * (与 completedAt 同批原子写入 run.json);`name` 未在 `run()` 声明过时可以在这里补。每个
   * Run 只能封一次,重复调用抛错。不做跨 Experiment 聚合——一次 Invocation 里的每个
   * Run 各自独立封口,不必等其它 Run(见 docs/runner.md「Experiment 收尾协议」)。
   */
  finish(opts?: {
    diagnostics?: DiagnosticRecord[];
    completedAt?: string;
    facts?: globalThis.Record<string, string | number | boolean>;
    timings?: TimingActivity[];
    sandboxBuilds?: SandboxBuildRecord[];
    name?: LocalizedText;
  }): Promise<void>;
}

export interface Writer {
  /**
   * 建快照目录(独占创建,撞名换随机后缀重试)+ 立即写 run.json(不含 completedAt)。
   * 同一 writer 内同 experimentId 重复声明 → 返回同一个 RunWriter(懒建语义;
   * knownEvalIds 取并集,completedAt / name 以最后一次声明为准,finish() 时才落盘)。
   */
  run(decl: RunDeclaration): Promise<RunWriter>;
  /** @internal runner 薄壳入口:按 EvalResult 的 experimentId 懒建快照并落盘一条 attempt。 */
  writeAttemptFor(result: EvalResult): Promise<void>;
  /** @internal 已创建快照清单(CLI 收尾打印)。 */
  snapshotDirs(): { experimentId: string; dir: string }[];
  /**
   * @internal 已创建的全部 RunWriter 句柄。Artifacts reporter 据此在每个 Experiment
   * 收尾(`experiment:complete`)时找到对应快照的 `finish()`,不必自己重新走 `run()`
   * 的懒建语义。
   */
  snapshotWriters(): Promise<{ experimentId: string; writer: RunWriter }[]>;
}

interface SnapshotState {
  /** 快照的权威 meta(不含 completedAt;knownEvalIds 随重复声明累加)。 */
  meta: RunMeta;
  dir: string;
  writer: RunWriter;
  declCompletedAt?: string;
  declName?: LocalizedText;
  /** 这个 Run 是否已经封口;`finish()` 只能对每个 Run 生效一次。 */
  finished: boolean;
}

/** 同步:不建目录、不碰磁盘。目录创建发生在第一次 run() 调用里。 */
export function createWriter(root: string, opts: WriterOptions): Writer {
  const pending = new Map<string, Promise<SnapshotState>>();
  const created: { experimentId: string; dir: string }[] = [];

  async function buildSnapshot(decl: RunDeclaration): Promise<SnapshotState> {
    const meta: RunMeta = {
      format: RECORD_FORMAT,
      schemaVersion: RECORD_SCHEMA_VERSION,
      producer: opts.producer,
      runId: randomUUID(),
      experimentId: decl.experimentId,
      // 运行配置不带 id:身份的家是顶层 experimentId,重复一份只会引出「以谁为准」。
      ...(decl.experiment !== undefined ? { experiment: (decl.experiment) } : {}),
      agent: decl.agent,
      ...(decl.model !== undefined ? { model: decl.model } : {}),
      startedAt: decl.startedAt,
      ...(decl.configHash !== undefined ? { configHash: decl.configHash } : {}),
      ...(decl.knownEvalIds?.length ? { knownEvalIds: [...new Set(decl.knownEvalIds)] } : {}),
      ...(decl.name !== undefined ? { name: decl.name } : {}),
    };
    const dir = await createSnapshotDir(root, decl.experimentId);
    await writeFile(join(dir, RUN_FILE), JSON.stringify(meta, null, 2), "utf-8");
    // 清单与 run.json 同批落地:它是规划期的产物,晚一步写就会有「Run 目录已在、清单还没到」
    // 的窗口,而下一轮的差异解释正好在这种被中断的 Run 上最需要它。
    const manifests = decl.manifests ?? opts.manifests?.get(decl.experimentId);
    if (manifests !== undefined && Object.keys(manifests).length > 0) {
      await writeFile(join(dir, MANIFESTS_FILE), JSON.stringify(manifests, null, 2), "utf-8");
    }
    created.push({ experimentId: decl.experimentId, dir });
    // 快照级源码去重仓库:sha256 → 落盘 Promise,同一快照内并发/重复的 writeAttempt 共享同一次写入
    // (Map 的 has/set 之间没有 await,JS 单线程语义下不会重复起两次写)。
    const sourceStore = new Map<string, Promise<void>>();

    const state: SnapshotState = {
      meta,
      dir,
      declCompletedAt: decl.completedAt,
      declName: decl.name,
      finished: false,
      writer: undefined as unknown as RunWriter, // 下面立即补上,writer.finish 需要闭包引用 state 本身
    };
    state.writer = {
      dir,
      async writeAttempt(entry: AttemptEntry, artifacts?: AttemptArtifacts): Promise<void> {
        await writeAttemptFiles(dir, { experimentId: state.meta.experimentId, startedAt: state.meta.startedAt }, entry, artifacts, sourceStore);
      },
      async finish(finishOpts): Promise<void> {
        if (state.finished) {
          throw new Error(`snap.finish() for experiment "${state.meta.experimentId}" (${dir}) was already called.`);
        }
        state.finished = true;
        const completedAt = finishOpts?.completedAt ?? state.declCompletedAt ?? new Date().toISOString();
        const name = finishOpts?.name ?? state.declName;
        const finalMeta: RunMeta = {
          format: state.meta.format,
          schemaVersion: state.meta.schemaVersion,
          producer: state.meta.producer,
          runId: state.meta.runId,
          experimentId: state.meta.experimentId,
          ...(state.meta.experiment !== undefined ? { experiment: state.meta.experiment } : {}),
          agent: state.meta.agent,
          ...(state.meta.model !== undefined ? { model: state.meta.model } : {}),
          startedAt: state.meta.startedAt,
          ...(state.meta.configHash !== undefined ? { configHash: state.meta.configHash } : {}),
          completedAt,
          ...(finishOpts?.diagnostics?.length ? { diagnostics: finishOpts.diagnostics } : {}),
          ...(finishOpts?.facts && Object.keys(finishOpts.facts).length ? { facts: finishOpts.facts } : {}),
          ...(finishOpts?.timings?.length ? { timings: finishOpts.timings } : {}),
          ...(finishOpts?.sandboxBuilds?.length ? { sandboxBuilds: finishOpts.sandboxBuilds } : {}),
          ...(state.meta.knownEvalIds?.length ? { knownEvalIds: state.meta.knownEvalIds } : {}),
          ...(name !== undefined ? { name } : {}),
        };
        state.meta = finalMeta;
        await writeFile(join(dir, RUN_FILE), JSON.stringify(finalMeta, null, 2), "utf-8");
      },
    };
    return state;
  }

  async function snapshotImpl(decl: RunDeclaration): Promise<RunWriter> {
    if (!decl.experimentId || !decl.agent || !decl.startedAt) {
      throw new Error(
        "writer.run() requires experimentId, agent and startedAt. They are run-level identity: declare them once here instead of on each attempt.",
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
        `writeAttemptFor() requires EvalResult.experimentId (results schemaVersion ${RECORD_SCHEMA_VERSION} lays out one directory per experiment); eval "${result.id}" has none.`,
      );
    }
    const snap = await snapshotImpl({
      experimentId: result.experimentId,
      agent: result.agent,
      model: result.model,
      // 快照 startedAt 优先用 writer 级的 invocation 锚点(见 WriterOptions.snapshotStartedAt)——
      // niceeval 自己的 runner 恒会提供,多个 experiment 共享同一个值。省略时(第三方直调
      // createWriter() 未传该选项)退回旧行为:以本次调用这个 result 自己的 attempt
      // startedAt 为锚,首条落盘的 result 决定了这个 experiment 快照的身份锚点。
      startedAt: opts.snapshotStartedAt ?? result.startedAt ?? new Date().toISOString(),
      experiment: result.experiment,
    });

    if (result.artifactBase) {
      // 携带条目(--resume 合入):本轮没有任何新数据,不写 artifact、不重算 artifacts 词干列表,
      // startedAt(身份锚)与 artifactBase 原样保留。locator 同理原样保留(在 ...rest 里,
      // 没被解构掉)、从不重算——`result` 是上一轮 openRecord() 读回的记录,原快照的
      // startedAt 已经不在本轮快照里了,重算会用错的 snapshotStartedAt 算出不同的字符串,
      // 让已经发布/引用过的 locator 失效。真缺失(没经过 openRecord 的手工构造)时如实留空,
      // 交给读取面按当前身份兜底算(见 open.ts 的 locator 回填),不在这里瞎猜。
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
        ...rest
      } = result;
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
      commands,
      rawTranscript,
      artifactBase,
      artifacts,
      ...entry
    } = result;
    void agent;
    void model;
    void experimentId;
    void experiment;
    void artifactBase;
    void artifacts;
    // startedAt 是 attempt 级事实(每条各异,view 靠它显示「何时跑的」),原样落盘;
    // 读取面只在记录缺失时才回退快照的 startedAt。
    const record = { ...entry, ...(startedAt !== undefined ? { startedAt } : {}) };
    await snap.writeAttempt(record as AttemptEntry, { events, sources, o11y, trace, agentSetup, diff, commands });
  }

  return {
    run: snapshotImpl,
    writeAttemptFor: writeAttemptForImpl,
    snapshotDirs(): { experimentId: string; dir: string }[] {
      return [...created];
    },
    async snapshotWriters(): Promise<{ experimentId: string; writer: RunWriter }[]> {
      const states = await Promise.all([...pending.values()]);
      return states.map((state) => ({ experimentId: state.meta.experimentId, writer: state.writer }));
    },
  };
}

/** 一条 attempt 的落盘:拆 artifact 文件、算 artifacts 词干列表、写 result.json;空数据不落文件。 */
async function writeAttemptFiles(
  snapDir: string,
  run: { experimentId: string; startedAt: string },
  entry: AttemptEntry,
  artifacts: AttemptArtifacts | undefined,
  sourceStore: Map<string, Promise<void>>,
): Promise<void> {
  const attemptDir = join(snapDir, attemptDirOf(entry));
  await mkdir(attemptDir, { recursive: true });

  const hasCommands = !!(artifacts?.commands && artifacts.commands.length);
  const hasEvents = !!(artifacts?.events && artifacts.events.length);
  const hasSources = !!(artifacts?.sources && artifacts.sources.length);
  const hasTrace = !!(artifacts?.trace && artifacts.trace.length);
  const hasO11y = !!artifacts?.o11y;
  const hasAgentSetup = !!artifacts?.agentSetup;
  const hasDiff = !!artifacts?.diff;

  const writes: Promise<unknown>[] = [];
  // 大值截断只发生在这里(序列化的那一刻):events 的事件字段与 trace 的 span 属性里的任意
  // 字符串值按 ARTIFACT_VALUE_MAX_BYTES 截断并留结构化 truncated 标记;运行时(断言 / o11y
  // 派生)看到的始终是完整值。commands、sources 与 diff 不截断——失败命令的 stdout/stderr 是
  // 一个完整的诊断语义单位,截哪一端都毁掉另一半(见 docs/feature/record/architecture.md
  // 的证据 registry)。
  if (hasCommands)
    writes.push(writeFile(join(attemptDir, artifactFileOf("commands")), JSON.stringify(artifacts!.commands!), "utf-8"));
  if (hasEvents)
    writes.push(writeFile(join(attemptDir, "events.json"), JSON.stringify(truncateEvents(artifacts!.events!)), "utf-8"));
  if (hasSources) writes.push(writeSourcesRef(snapDir, attemptDir, artifacts!.sources!, sourceStore));
  if (hasTrace)
    writes.push(writeFile(join(attemptDir, "trace.json"), JSON.stringify(truncateSpans(artifacts!.trace!)), "utf-8"));
  if (artifacts?.o11y) writes.push(writeFile(join(attemptDir, "o11y.json"), JSON.stringify(artifacts.o11y), "utf-8"));
  if (artifacts?.agentSetup) {
    writes.push(
      writeFile(join(attemptDir, artifactFileOf("agentSetup")), JSON.stringify(artifacts.agentSetup), "utf-8"),
    );
  }
  if (artifacts?.diff) writes.push(writeFile(join(attemptDir, "diff.json"), JSON.stringify(artifacts.diff), "utf-8"));
  await Promise.all(writes);

  // locator:caller(如第三方 harness 直接调 RunWriter.writeAttempt)已经带了就尊重,
  // 否则按当前身份元组算一份 —— 这条路径只服务「非携带」的新写入,携带条目走
  // writeAttemptForImpl 的 artifactBase 分支,原样透传 result.locator,从不落到这里重算。
  // niceeval 自己的 runner(src/runner/run.ts)在 fresh attempt 完成时已经把 locator 写进
  // entry.locator(用的正是同一个 run.startedAt),所以这条 encodeAttemptLocator 兜底
  // 对 niceeval 自身运行永不触发,只在第三方 harness 未预先算好 locator 时才会走到。
  const locator =
    entry.locator ??
    encodeAttemptLocator({
      experimentId: run.experimentId,
      snapshotStartedAt: run.startedAt,
      evalId: entry.id,
      attempt: entry.attempt,
    });

  // artifacts 词干列表:writer 实际写出的按需 artifact,顺序与证据 registry 表一致;
  // 省略等价于空列表。
  const artifactStems = (
    [
      ["commands", hasCommands],
      ["events", hasEvents],
      ["trace", hasTrace],
      ["o11y", hasO11y],
      ["agentSetup", hasAgentSetup],
      ["diff", hasDiff],
      ["sources", hasSources],
    ] as const
  )
    .filter(([, present]) => present)
    .map(([stem]) => stem);

  const record = { ...entry, locator, ...(artifactStems.length ? { artifacts: artifactStems } : {}) };
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
  const refs: { path: string; sha256: string; role: SourceArtifact["role"] }[] = [];
  for (const src of sources) {
    const sha256 = hashEvalSource(normalizeEvalSource(src.content));
    refs.push({ path: src.path, sha256, role: src.role });
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
  throw new Error(`Could not create a unique run directory under "${parent}" after 5 attempts (${String(lastError)}).`);
}



/** 快照目录名的时间戳段:Date#toISOString 把 : 与 . 换成 -(与 docs/feature/record/architecture.md 一致)。 */
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
