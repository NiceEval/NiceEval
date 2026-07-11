// createRunWriter:Results Format 的写入面(定稿见 docs/results-lib.md「写:createRunWriter」)。
//
// writer 与 reader 是同一组类型的两半,而且是字面的两半:reader 的 attempt.result 由
// 「snapshot() 声明的快照级字段(experiment / agent / model / startedAt)+ writeAttempt 第一参」
// 拼成,快照级字段不在 attempt 参数类型里(AttemptEntry 的 Omit),不存在「谁的值为准」。
// 布局知识(时间戳目录、attempt 路径清洗、大字段拆工件、has* 回填、空数据不落文件)全在这里;
// src/runner/reporters/artifacts.ts 是本文件的薄壳。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalResult, RunSummary, Usage } from "../types.ts";
import type { LocalizedText } from "../types.ts";
import type { DiffData, O11ySummary, SourceArtifact, StreamEvent, TraceSpan } from "../types.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";
import { attemptDirOf } from "./format.ts";

export interface RunWriterOptions {
  /** 谁在写这份结果:niceeval 自己,或第三方 harness(name 如实写,别冒充 "niceeval")。 */
  producer: NonNullable<RunSummary["producer"]>;
}

/** 快照级元数据的家:一个 experiment 开一个;这些字段不塞进每条 attempt。 */
export interface SnapshotDeclaration {
  experiment: string;
  agent: string;
  model?: string;
  /** 必填:身份键与去重以它为锚,官方产出永不缺。 */
  startedAt: string;
  /** 该实验已知的 eval 并集(残缺检测的分母);转换只覆盖部分题目时如实交代全集。 */
  knownEvalIds?: string[];
}

/**
 * writeAttempt 的第一参 = attempt 级条目:reader 的 attempt.result 中,快照级字段
 * (agent / model / startedAt / experimentId)以外的全部;工件引用字段由 writer 回填。
 */
export type AttemptEntry = Omit<
  EvalResult,
  | "agent"
  | "model"
  | "startedAt"
  | "experimentId"
  | "events"
  | "sources"
  | "o11y"
  | "trace"
  | "diff"
  | "rawTranscript"
  | "artifactsDir"
  | "artifactBase"
  | "artifactAbsBase"
  | "hasTrace"
  | "hasEvents"
  | "hasSources"
>;

/** writeAttempt 的第二参:reader 懒加载能拿到的那几样工件,全部可选;缺哪样读取面就懒加载出 null。 */
export interface AttemptArtifacts {
  events?: StreamEvent[];
  trace?: TraceSpan[];
  o11y?: O11ySummary;
  diff?: DiffData;
  sources?: SourceArtifact[];
}

export interface SnapshotWriter {
  /** 增量落盘一条 attempt:拆工件文件、算 artifactsDir(含路径清洗)、回填 has* 引用;空数据不落文件。 */
  writeAttempt(entry: AttemptEntry, artifacts?: AttemptArtifacts): Promise<void>;
}

/** finish() 从已写 attempt 推导 summary;个别推不出的字段走这里覆盖,不让调用方手拼整份 summary。 */
export interface FinishOverrides {
  name?: LocalizedText;
  agent?: string;
  model?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  usage?: Usage;
  estimatedCostUSD?: number;
  /**
   * @internal runner 专用:携带条目(--resume 合入)与最终排序只有调度器知道,Artifacts 薄壳
   * 从这里交权威 results(可含内联大字段,writer 统一瘦身)。第三方转换不需要它。
   */
  results?: EvalResult[];
}

export interface RunWriter {
  /** 本次 run 的输出目录(root 下的时间戳目录,: 与 . 已替换)。 */
  readonly dir: string;
  snapshot(decl: SnapshotDeclaration): SnapshotWriter;
  /** 写出 summary.json 收尾;没走到这里的目录读取面归入 skipped("incomplete")。 */
  finish(overrides?: FinishOverrides): Promise<RunSummary>;
  /**
   * @internal runner Artifacts 薄壳的增量工件落盘入口:runner 的条目自带 agent / model /
   * experimentId / startedAt(且存在无 experiment 的普通 run),不经 snapshot() 声明。
   */
  writeAttemptArtifacts(result: EvalResult): Promise<void>;
}

export async function createRunWriter(root: string, opts: RunWriterOptions): Promise<RunWriter> {
  const createdAt = new Date();
  const dir = join(root, safeTimestamp(createdAt));
  await mkdir(dir, { recursive: true });

  const decls: SnapshotDeclaration[] = [];
  const entries: EvalResult[] = [];
  let finished = false;

  const writeArtifacts = async (target: EvalResult | AttemptArtifacts, dirFor: EvalResult): Promise<void> => {
    const attemptDest = join(dir, attemptDirOf(dirFor));
    await mkdir(attemptDest, { recursive: true });
    const writes: Promise<unknown>[] = [];
    if (target.events?.length) writes.push(writeFile(join(attemptDest, "events.json"), JSON.stringify(target.events), "utf-8"));
    if (target.sources?.length) writes.push(writeFile(join(attemptDest, "sources.json"), JSON.stringify(target.sources), "utf-8"));
    if (target.trace?.length) writes.push(writeFile(join(attemptDest, "trace.json"), JSON.stringify(target.trace), "utf-8"));
    if (target.o11y) writes.push(writeFile(join(attemptDest, "o11y.json"), JSON.stringify(target.o11y), "utf-8"));
    if (target.diff) writes.push(writeFile(join(attemptDest, "diff.json"), JSON.stringify(target.diff), "utf-8"));
    await Promise.all(writes);
  };

  return {
    dir,

    snapshot(decl: SnapshotDeclaration): SnapshotWriter {
      if (!decl.experiment || !decl.agent || !decl.startedAt) {
        throw new Error("writer.snapshot() requires experiment, agent and startedAt. They are snapshot-level identity: declare them once here instead of on each attempt.");
      }
      decls.push(decl);
      return {
        async writeAttempt(entry: AttemptEntry, artifacts?: AttemptArtifacts): Promise<void> {
          // 快照级字段注入用「缺才补」:参数类型上它们不存在(Omit),运行时保守处理,
          // 不覆盖调用方带来的值,也不打乱既有键序。
          const full = { ...entry } as EvalResult;
          full.experimentId ??= decl.experiment;
          full.agent ??= decl.agent;
          if (full.model === undefined && decl.model !== undefined) full.model = decl.model;
          full.startedAt ??= decl.startedAt;
          await writeArtifacts(artifacts ?? {}, full);
          entries.push(
            slimEntry({
              ...full,
              events: artifacts?.events,
              sources: artifacts?.sources,
              trace: artifacts?.trace,
              o11y: artifacts?.o11y,
              diff: artifacts?.diff,
            }),
          );
        },
      };
    },

    async writeAttemptArtifacts(result: EvalResult): Promise<void> {
      await writeArtifacts(result, result);
    },

    async finish(overrides: FinishOverrides = {}): Promise<RunSummary> {
      if (finished) throw new Error(`finish() already called for run directory ${dir}.`);
      finished = true;

      const results = overrides.results ? overrides.results.map(slimEntry) : entries;
      const counts = { passed: 0, failed: 0, skipped: 0, errored: 0 };
      let inTok = 0;
      let outTok = 0;
      let cost = 0;
      let duration = 0;
      for (const r of results) {
        counts[r.verdict] += 1;
        inTok += r.usage?.inputTokens ?? 0;
        outTok += r.usage?.outputTokens ?? 0;
        cost += r.estimatedCostUSD ?? 0;
        duration += r.durationMs ?? 0;
      }

      const startedAt =
        overrides.startedAt ??
        decls.map((d) => d.startedAt).sort()[0] ??
        createdAt.toISOString();
      const agent = overrides.agent ?? decls[0]?.agent ?? results[0]?.agent ?? "";
      const model = overrides.model ?? decls[0]?.model;
      const estimatedCostUSD = overrides.estimatedCostUSD ?? (cost || undefined);
      const snapshotsMeta = buildSnapshotsMeta(decls, startedAt);

      // 键序是持久化契约的一部分(与 runner 直写时代逐字节一致):format / schemaVersion /
      // producer 在最前,results 与 outputDir 收尾,可选键缺席时不留 undefined 占位。
      const summary: RunSummary = {
        format: RESULTS_FORMAT,
        schemaVersion: RESULTS_SCHEMA_VERSION,
        producer: opts.producer,
        ...(overrides.name !== undefined ? { name: overrides.name } : {}),
        agent,
        ...(model !== undefined ? { model } : {}),
        startedAt,
        completedAt: overrides.completedAt ?? new Date().toISOString(),
        passed: counts.passed,
        failed: counts.failed,
        skipped: counts.skipped,
        errored: counts.errored,
        durationMs: overrides.durationMs ?? duration,
        usage: overrides.usage ?? { inputTokens: inTok, outputTokens: outTok },
        ...(estimatedCostUSD !== undefined ? { estimatedCostUSD } : {}),
        results,
        outputDir: dir,
        ...(snapshotsMeta ? { snapshots: snapshotsMeta } : {}),
      };
      await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
      return summary;
    },
  };
}

/**
 * 瘦身条目:去掉内联大字段,回填 artifactsDir 与 has* 引用。
 * 携带条目(--resume 合入,rest 上带着 artifactBase 指向原 run 的工件目录)原样保留:
 * 本轮没有任何新数据,不能重新推导出 false 的 has*,更不能编出一个本轮没写过文件的 artifactsDir。
 */
export function slimEntry(r: EvalResult): EvalResult {
  const { events, sources, o11y, trace, diff, rawTranscript, ...rest } = r;
  void rawTranscript;
  if (rest.artifactBase) return rest;
  return {
    ...rest,
    artifactsDir: attemptDirOf(r),
    hasTrace: !!(trace && trace.length),
    hasEvents: !!(events && events.length),
    hasSources: !!(sources && sources.length),
  };
}

/** 快照级元数据落盘:startedAt 只在与顶层不同(一 run 多快照、时刻不同)时记;空 meta 不落字段。 */
function buildSnapshotsMeta(
  decls: SnapshotDeclaration[],
  summaryStartedAt: string,
): RunSummary["snapshots"] | undefined {
  const meta: NonNullable<RunSummary["snapshots"]> = {};
  let any = false;
  for (const decl of decls) {
    const entry: { startedAt?: string; knownEvalIds?: string[] } = {};
    if (decl.startedAt !== summaryStartedAt) entry.startedAt = decl.startedAt;
    if (decl.knownEvalIds?.length) entry.knownEvalIds = [...decl.knownEvalIds];
    if (Object.keys(entry).length > 0) {
      // 同一 experiment 声明多次时后声明覆盖(knownEvalIds 取并集,覆盖事实只会变大不会缩水)。
      const existing = meta[decl.experiment];
      if (existing?.knownEvalIds && entry.knownEvalIds) {
        entry.knownEvalIds = [...new Set([...existing.knownEvalIds, ...entry.knownEvalIds])];
      }
      meta[decl.experiment] = { ...existing, ...entry };
      any = true;
    }
  }
  return any ? meta : undefined;
}

/** run 目录名:Date#toISOString 把 : 与 . 换成 -(与 docs/results-format.md 一致)。 */
export function safeTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}
