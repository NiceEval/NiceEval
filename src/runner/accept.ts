// `niceeval accept @<locator>` 的核心：把一条历史终态结果重锚到当前输入。
//
// 该模块不派发 Agent / Sandbox attempt。它只负责读取一条历史 attempt、完成当前
// discovery + physical planning + fingerprint/manifest 重算、校验接受门，并通过
// record writer 建立一份新的已封口快照。证据仍借用历史 attempt，来源与新旧指纹写在
// result.acceptedFrom；新快照中的 locator 始终是新 Run 身份派生的新值。

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { loadConfigFile } from "../load-config.ts";
import { discoverEvals, discoverExperiments } from "./discover.ts";
import { resolveExperimentEvals } from "./eval-selection.ts";
import {
  fingerprintWithManifest,
  hashConfigIdentity,
  resolvedTimeoutMsForCarry,
} from "./fingerprint.ts";
import {
  configIdentityForRun,
  configIdentityFromResult,
  configIdentityPaths,
} from "./config-identity.ts";
import { resolveJudge } from "./judge-config.ts";
import { compareFingerprints, type FingerprintDelta } from "./manifest.ts";
import { experimentRunInfo } from "./attempt.ts";
import { resolveRunTimeout } from "./timeout.ts";
import {
  prepareRunSandboxes,
  type PreparedRunPair,
} from "./sandbox-selection.ts";
import {
  linkedRunRecordIdentity,
  type SandboxPlanningServices,
} from "../sandbox/plan.ts";
import type {
  AgentRun,
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
  EvalResult,
  AcceptedDifference,
  AcceptedResult,
} from "./types.ts";
import type { JsonValue, LocalizedText } from "../types.ts";
import {
  MANIFESTS_FILE,
  parseRunManifests,
  type EvalManifest,
} from "../record/manifest.ts";
import {
  createWriter,
} from "../record/writer.ts";
import type { Producer } from "../record/types.ts";
import {
  openRecord,
  resolveLocator,
  withArtifactBase,
} from "../record/open.ts";
import type {
  AttemptHandle,
  Record as ResultsRecord,
  Run,
} from "../record/types.ts";
import type { AttemptLocator } from "../record/locator.ts";
import { encodeAttemptLocator } from "../record/locator.ts";

/** accept 资格门失败；CLI 可按 code 映射到本地化文案，message 保留可读的下一步。 */
export type AcceptFailureCode =
  | "not-terminal"
  | "sandbox-kept"
  | "missing-attempt"
  | "timeout"
  | "fingerprint-missing"
  | "experiment-not-found"
  | "eval-not-found"
  | "eval-not-selected"
  | "planning-failed"
  | "pair-mismatch"
  | "batch-mismatch";

export class AcceptError extends Error {
  constructor(
    public readonly code: AcceptFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "AcceptError";
  }
}

export interface AcceptLocatorOptions {
  /** 当前项目根。用于 discovery、配置解析与默认 `.niceeval` 记录根。 */
  cwd: string;
  /** 历史 attempt 的不透明 locator。 */
  locator: string;
  /** 结果根；省略时为 `<cwd>/.niceeval`。 */
  recordRoot?: string;
  /** 测试/嵌入调用方可复用已发现对象，避免重复 import。 */
  config?: Config;
  evals?: readonly DiscoveredEval[];
  experiments?: readonly DiscoveredExperiment[];
  /** 注入 physical planner，测试不需要访问 provider。 */
  planningServices?: SandboxPlanningServices;
  /** 默认当前时刻；测试可固定。 */
  now?: () => string;
  producer?: Producer;
}

export interface AcceptPreparedAttemptOptions {
  recordRoot: string;
  source: AttemptHandle;
  pair: PreparedRunPair;
  currentFingerprint: string;
  currentManifest: EvalManifest;
  currentConfigHash: string;
  /** config 层超时兜底，与正常 runner 的解析链保持一致。 */
  configTimeoutMs?: number;
  currentExperiment?: EvalResult["experiment"];
  knownEvalIds?: readonly string[];
  name?: LocalizedText;
  now?: () => string;
  producer?: Producer;
}

export interface AcceptedAttempt {
  record: ResultsRecord;
  run: Run;
  attempt: AttemptHandle;
  source: AttemptHandle;
  locator: AttemptLocator;
  sourceLocator: AttemptLocator;
  fingerprint: string;
}

export interface PreparedAcceptedAttempt {
  recordRoot: string;
  source: AttemptHandle;
  sourceLocator: AttemptLocator;
  pair: PreparedRunPair;
  sourceResult: EvalResult;
  acceptedFrom: AcceptedResult;
  currentFingerprint: string;
  currentManifest: EvalManifest;
  currentConfigHash: string;
  currentExperiment?: EvalResult["experiment"];
  knownEvalIds?: readonly string[];
  name?: LocalizedText;
  now?: () => string;
  producer?: Producer;
}

/**
 * 从当前项目发现并接受一条历史 locator。只写一条新结果，不运行 eval、Agent 或 Sandbox。
 */
export async function prepareAcceptLocator(options: AcceptLocatorOptions): Promise<PreparedAcceptedAttempt> {
  const cwd = resolve(options.cwd);
  const recordRoot = resolve(options.recordRoot ?? join(cwd, ".niceeval"));
  const prior = await openRecord(recordRoot);
  const source = resolveLocator(prior, options.locator);

  const config = options.config ?? await loadConfigFile(cwd);
  const evals = options.evals ?? await discoverEvals(cwd);
  const experiments = options.experiments ?? await discoverExperiments(cwd);

  return prepareAcceptTarget(source, {
    recordRoot,
    config,
    evals,
    experiments,
    getPreparedPairs: (experiment) =>
      planExperimentPairs(experiment, [source.evalId], evals, config, options.planningServices),
    now: options.now,
    producer: options.producer,
  });
}

interface AcceptPrepareContext {
  recordRoot: string;
  config: Config;
  evals: readonly DiscoveredEval[];
  experiments: readonly DiscoveredExperiment[];
  /** 该 experiment 当前批次要接受的全部 eval 的 physical planning 结果;单 locator 入口每次只含自己那一个 eval,
   *  批量入口按 experiment 记忆化、多条 locator 共享同一次调用(见 `acceptLocators`)。 */
  getPreparedPairs: (experiment: DiscoveredExperiment) => Promise<readonly PreparedRunPair[]>;
  /** fingerprint 源码哈希的跨 locator 去重仓库,与 planCarry(fingerprint.ts)同一用法。 */
  sourceCache?: Map<string, Promise<string>>;
  now?: () => string;
  producer?: Producer;
}

/** 已知 config/evals/experiments 与 sandbox planning 来源时,单条 locator 的 discovery + 指纹重算。 */
async function prepareAcceptTarget(
  source: AttemptHandle,
  ctx: AcceptPrepareContext,
): Promise<PreparedAcceptedAttempt> {
  const sourceLocator = locatorOf(source);
  const experiment = ctx.experiments.find((candidate) => candidate.id === source.experimentId);
  if (experiment === undefined) {
    throw new AcceptError(
      "experiment-not-found",
      `Current project does not discover experiment "${source.experimentId}" for locator "${sourceLocator}".`,
    );
  }
  const targetEval = ctx.evals.find((candidate) => candidate.id === source.evalId);
  if (targetEval === undefined) {
    throw new AcceptError(
      "eval-not-found",
      `Current project does not discover eval "${source.evalId}" for locator "${sourceLocator}".`,
    );
  }
  const selection = resolveExperimentEvals({
    experimentId: experiment.id,
    selector: experiment.evals,
    cliPatterns: [targetEval.id],
    evals: ctx.evals,
  });
  if (!selection.selectedEvals.some((candidate) => candidate.id === targetEval.id)) {
    throw new AcceptError(
      "eval-not-selected",
      `Experiment "${experiment.id}" does not select eval "${targetEval.id}" under its current evals selector.`,
    );
  }

  const run = agentRunOf(experiment, selection.selectedEvalIds);
  const prepared = await ctx.getPreparedPairs(experiment);
  const pair = prepared.find((candidate) => candidate.evalDef.id === targetEval.id);
  if (pair === undefined) {
    throw new AcceptError("pair-mismatch", `No current planning pair for ${experiment.id} × ${targetEval.id}.`);
  }
  // 与 planCarry(fingerprint.ts)同一口径重算配置身份:Judge 走 experiment > eval > config
  // 逐字段解析,而不是 configIdentityForRun 默认的单层 run.judge——否则这里落盘的
  // fingerprint/configHash 只含 experiment 级 judge,下一次 exp 用完整链重算出不同指纹,
  // 形成 accept → previous-result 死循环(docs/feature/experiments/cache.md「Judge 的解析链」)。
  const resolvedJudge = resolveJudge(run.judge, targetEval.judge, ctx.config.judge);
  const identity = configIdentityForRun(run, pair.plan, resolvedJudge);
  const { fingerprint, manifest } = await fingerprintWithManifest(pair, ctx.sourceCache, {
    _tag: "Current",
    identity,
  });
  const configHash = hashConfigIdentity(identity);
  // 这条结果自己的 eval 才进 sandboxPlansByEval——`prepared` 在批量入口下可能覆盖同 experiment
  // 本批的其它 eval(见 acceptLocators 的记忆化 planning),不能把它们混进这条结果的 currentExperiment。
  const sandboxPlansByEval: globalThis.Record<string, JsonValue> = {
    [targetEval.id]: linkedRunRecordIdentity(pair.plan),
  };
  const currentExperiment = experimentRunInfo(
    run,
    pair.plan,
    sandboxPlansByEval,
    ctx.config,
    resolvedJudge,
  );
  return prepareAcceptedAttempt({
    recordRoot: ctx.recordRoot,
    source,
    pair,
    currentFingerprint: fingerprint,
    currentManifest: manifest,
    currentConfigHash: configHash,
    configTimeoutMs: ctx.config.timeoutMs,
    currentExperiment,
    knownEvalIds: selection.selectedEvalIds,
    name: ctx.config.name,
    now: ctx.now,
    producer: ctx.producer,
  });
}

/** 单次 physical planning 调用:给定 experiment 与要接受的 eval id 集合,规划一次、返回全部 pair。 */
async function planExperimentPairs(
  experiment: DiscoveredExperiment,
  evalIds: readonly string[],
  evals: readonly DiscoveredEval[],
  config: Config,
  planningServices: SandboxPlanningServices | undefined,
): Promise<readonly PreparedRunPair[]> {
  const selection = resolveExperimentEvals({
    experimentId: experiment.id,
    selector: experiment.evals,
    cliPatterns: evalIds,
    evals,
  });
  const run = agentRunOf(experiment, selection.selectedEvalIds);
  try {
    return await Effect.runPromise(prepareRunSandboxes(
      selection.selectedEvals,
      [run],
      planningServices,
      { configTimeoutMs: config.timeoutMs },
    ));
  } catch (cause) {
    throw new AcceptError(
      "planning-failed",
      `Current Sandbox planning for ${experiment.id} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

const ACCEPT_PREPARE_CONCURRENCY = 8;

/** 手写小并发池,不引第三方依赖:discovery 与 sandbox planning 已按 experiment 记忆化,
 *  但逐 locator 的指纹/manifest 计算仍有磁盘 IO,批量 accept 不放开到无限并发。 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** 单 locator 兼容入口：prepare 后走同一份单 snapshot commit。 */
export async function acceptLocator(options: AcceptLocatorOptions): Promise<AcceptedAttempt> {
  const prepared = await prepareAcceptLocator(options);
  const accepted = await writeAcceptedAttempts([prepared]);
  const first = accepted[0];
  if (first === undefined) throw new Error("acceptLocator committed no attempt.");
  return first;
}

export interface AcceptLocatorsOptions extends Omit<AcceptLocatorOptions, "locator"> {
  locators: readonly string[];
}

/**
 * 多 locator 入口：discovery 与 sandbox planning 只 hoist 一次(config/evals/experiments 全批共享,
 * planning 按 experiment 记忆化——同一 experiment 本批全部目标 eval 合并成一次
 * `prepareRunSandboxes` 调用),不再让每条 locator 各自并发重跑一遍完整 discovery + planning
 * (137 条 locator 曾这样撑爆 4GB 堆,见 memory/accept-batch-per-locator-planning-oom.md)。
 * 所有 locator 先完成 prepare，成功后按各自 experiment 分组，每组各自创建并封口一个 snapshot。
 */
export async function acceptLocators(options: AcceptLocatorsOptions): Promise<readonly AcceptedAttempt[]> {
  if (options.locators.length === 0) {
    throw new AcceptError("missing-attempt", "accept requires at least one locator.");
  }
  if (new Set(options.locators).size !== options.locators.length) {
    throw new AcceptError("batch-mismatch", "accept rejects duplicate locators.");
  }

  const cwd = resolve(options.cwd);
  const recordRoot = resolve(options.recordRoot ?? join(cwd, ".niceeval"));
  const prior = await openRecord(recordRoot);
  const config = options.config ?? await loadConfigFile(cwd);
  const evals = options.evals ?? await discoverEvals(cwd);
  const experiments = options.experiments ?? await discoverExperiments(cwd);

  const sources = options.locators.map((locator) => resolveLocator(prior, locator));

  // 先按 experiment 汇总本批全部目标 eval,memoized planning 的第一次调用就能拿到完整集合,
  // 不必等每条 locator 各自触发再追加(并发展开时谁先到不确定)。
  const evalIdsByExperiment = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = evalIdsByExperiment.get(source.experimentId) ?? new Set<string>();
    set.add(source.evalId);
    evalIdsByExperiment.set(source.experimentId, set);
  }
  const planningCache = new Map<string, Promise<readonly PreparedRunPair[]>>();
  function planPairsForExperiment(experiment: DiscoveredExperiment): Promise<readonly PreparedRunPair[]> {
    let cached = planningCache.get(experiment.id);
    if (cached === undefined) {
      const evalIds = [...(evalIdsByExperiment.get(experiment.id) ?? [])];
      cached = planExperimentPairs(experiment, evalIds, evals, config, options.planningServices);
      planningCache.set(experiment.id, cached);
    }
    return cached;
  }

  // 指纹计算共享一个 sourceCache,与 planCarry(fingerprint.ts)同一用法:同一份 eval 源码/数据
  // 文件在多条 locator 间只读一次、哈希一次。
  const sourceCache = new Map<string, Promise<string>>();

  const prepared = await mapWithConcurrency(sources, ACCEPT_PREPARE_CONCURRENCY, (source) =>
    prepareAcceptTarget(source, {
      recordRoot,
      config,
      evals,
      experiments,
      getPreparedPairs: (experiment) => planPairsForExperiment(experiment),
      sourceCache,
      now: options.now,
      producer: options.producer,
    }),
  );

  return writeAcceptedAttempts(prepared);
}

/** 已完成当前 planning/fingerprint 的低层入口，便于 runner/测试复用且不重复 discovery。 */
export async function prepareAcceptedAttempt(options: AcceptPreparedAttemptOptions): Promise<PreparedAcceptedAttempt> {
  const { source, pair } = options;
  const sourceLocator = locatorOf(source);
  if (source.evalId !== pair.evalDef.id || source.experimentId !== pair.run.experimentId) {
    throw new AcceptError(
      "pair-mismatch",
      `Historical attempt ${source.experimentId}/${source.evalId} does not match current pair ` +
        `${pair.run.experimentId}/${pair.evalDef.id}.`,
    );
  }
  validateAcceptance(source, pair, options.configTimeoutMs);
  const sourceResult = withArtifactBase(source);
  const oldFingerprint = sourceResult.fingerprint;
  if (oldFingerprint === undefined || oldFingerprint.length === 0) {
    throw new AcceptError("fingerprint-missing", `Attempt "${source.locator}" has no historical fingerprint.`);
  }

  const historicalManifest = await loadManifest(source);
  const historicalIdentity = configIdentityFromResult(sourceResult);
  const historicalConfig = historicalIdentity === undefined
    ? undefined
    : Object.fromEntries(configIdentityPaths(historicalIdentity));
  const comparison = compareFingerprints(
    oldFingerprint,
    options.currentFingerprint,
    historicalManifest,
    options.currentManifest,
    historicalConfig,
  );
  const deltas = comparison.kind === "match"
    ? []
    : comparison.kind === "changed"
      ? comparison.deltas
      : comparison.diagnostic.observedDeltas ?? [];
  const differences = deltas.map(acceptedDifferenceOf);
  const acceptedFrom: AcceptedResult = {
    locator: sourceLocator,
    fingerprint: oldFingerprint,
    acceptedFingerprint: options.currentFingerprint,
    differences,
  };

  return {
    recordRoot: options.recordRoot,
    source,
    sourceLocator,
    pair,
    sourceResult,
    acceptedFrom,
    currentFingerprint: options.currentFingerprint,
    currentManifest: options.currentManifest,
    currentConfigHash: options.currentConfigHash,
    ...(options.currentExperiment === undefined ? {} : { currentExperiment: options.currentExperiment }),
    ...(options.knownEvalIds === undefined ? {} : { knownEvalIds: options.knownEvalIds }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.producer === undefined ? {} : { producer: options.producer }),
  };
}

/** 单条低层入口保持旧 API，内部也严格走 prepare → commit。 */
export async function acceptPreparedAttempt(options: AcceptPreparedAttemptOptions): Promise<AcceptedAttempt> {
  const prepared = await prepareAcceptedAttempt(options);
  const accepted = await writeAcceptedAttempts([prepared]);
  const first = accepted[0];
  if (first === undefined) throw new Error("acceptPreparedAttempt committed no attempt.");
  return first;
}

/**
 * 已完成全部资格校验的批量 commit；调用方必须先拿到完整 prepared 列表。
 * 按 experimentId 分组，每组各自创建并封口一个 snapshot——一次 commit 可以跨多个 experiment,
 * 但仍共享同一个 record root(见 docs/feature/experiments/cache.md「accept」)。
 */
export async function writeAcceptedAttempts(
  preparedAttempts: readonly PreparedAcceptedAttempt[],
): Promise<readonly AcceptedAttempt[]> {
  const first = preparedAttempts[0];
  if (first === undefined) throw new AcceptError("missing-attempt", "accept requires at least one prepared locator.");
  for (const prepared of preparedAttempts) {
    if (prepared.recordRoot !== first.recordRoot) {
      throw new AcceptError(
        "batch-mismatch",
        "All accepted locators must belong to the same record root so they can share one commit.",
      );
    }
    if (prepared.pair.run.experimentId === undefined) {
      throw new AcceptError("pair-mismatch", "Accepted attempts require an experiment id.");
    }
  }

  // 按 experiment 分组;同一 experiment 内两个 locator 解析到同一个当前 (eval, attempt) 目标
  // 仍判重复拒绝,跨 experiment 的同名 eval 不算重复——分组内部维护各自的去重集。
  const groups = new Map<string, PreparedAcceptedAttempt[]>();
  for (const prepared of preparedAttempts) {
    const experimentId = prepared.pair.run.experimentId!;
    const group = groups.get(experimentId);
    if (group === undefined) groups.set(experimentId, [prepared]);
    else group.push(prepared);
  }
  for (const [experimentId, group] of groups) {
    const targetAttempts = new Set<string>();
    for (const prepared of group) {
      const target = `${prepared.source.evalId}|${prepared.source.result.attempt}`;
      if (targetAttempts.has(target)) {
        throw new AcceptError(
          "batch-mismatch",
          `Multiple source locators target the same current attempt ${experimentId}/${target}; choose exactly one source.`,
        );
      }
      targetAttempts.add(target);
    }
  }

  const now = (first.now ?? (() => new Date().toISOString()))();
  const writer = createWriter(first.recordRoot, {
    producer: first.producer ?? { name: "niceeval" },
    snapshotStartedAt: now,
  });

  // 返回值必须按调用方传入的 preparedAttempts 顺序还原;分组打乱了处理顺序,用引用做索引。
  const locatorByPrepared = new Map<PreparedAcceptedAttempt, AttemptLocator>();
  for (const [experimentId, group] of groups) {
    // 快照级字段(agent/model/configHash/name)按本组取,不再从全批 first 拿——
    // 否则跨 experiment 批次会把另一个 experiment 的身份写进这个 experiment 的 run.json。
    const groupFirst = group[0]!;
    // manifests 是这个 experiment 自己的袋子;不同 experiment 各自独立,不共享同一个对象,
    // 否则跨 experiment 同名 eval 会互相覆盖对方的指纹输入清单。
    const manifests: globalThis.Record<string, EvalManifest> = {};
    const knownEvalIds = new Set<string>();
    for (const prepared of group) {
      manifests[prepared.source.evalId] = prepared.currentManifest;
      knownEvalIds.add(prepared.source.evalId);
      for (const evalId of prepared.knownEvalIds ?? []) knownEvalIds.add(evalId);
    }
    // prepare 阶段每条 locator 单独按「只选中自己那一题」重算指纹,但快照级 pair plan
    // 不承担报告选题。快照级覆盖声明必须是本 experiment 组**全部**接受的题；currentSample
    // 只消费物理 attempts,只写 groupFirst 的 plans 也不能让批量 accept 的 view/show 塌成 1 题。
    const experiment = experimentForAcceptedGroup(group);
    const snapshot = await writer.run({
      experimentId,
      agent: groupFirst.pair.run.agent.name,
      ...(groupFirst.pair.run.model !== undefined ? { model: groupFirst.pair.run.model } : {}),
      startedAt: now,
      configHash: groupFirst.currentConfigHash,
      ...(experiment === undefined ? {} : { experiment }),
      ...(knownEvalIds.size === 0 ? {} : { knownEvalIds: [...knownEvalIds] }),
      manifests,
      ...(groupFirst.name === undefined ? {} : { name: groupFirst.name }),
    });
    for (const prepared of group) {
      const locator = encodeAttemptLocator({
        runId: snapshot.runId,
        evalId: prepared.source.evalId,
        attempt: prepared.source.result.attempt,
      });
      await writer.writeAttemptFor(acceptedResultFor(prepared, locator, snapshot.runId));
      locatorByPrepared.set(prepared, locator);
    }
    await snapshot.finish();
  }

  const record = await openRecord(first.recordRoot);
  return preparedAttempts.map((prepared) => {
    const locator = locatorByPrepared.get(prepared)!;
    const attempt = resolveLocator(record, locator);
    return {
      record,
      run: attempt.run,
      attempt,
      source: prepared.source,
      locator,
      sourceLocator: prepared.sourceLocator,
      fingerprint: prepared.currentFingerprint,
    };
  });
}

/** 把同 experiment 一批 accept 的逐 Eval Sandbox plan 合成 Run 级投影。 */
function experimentForAcceptedGroup(
  group: readonly PreparedAcceptedAttempt[],
): EvalResult["experiment"] | undefined {
  const bases = group
    .map((prepared) => prepared.currentExperiment)
    .filter((experiment): experiment is NonNullable<typeof experiment> => experiment !== undefined);
  const base = bases[0];
  if (base === undefined) return undefined;

  const sandboxPlansByEval: globalThis.Record<string, JsonValue> = {
    ...base.sandboxPlansByEval,
  };
  for (const prepared of group) {
    const plans = prepared.currentExperiment?.sandboxPlansByEval;
    if (plans === undefined) continue;
    for (const [evalId, plan] of Object.entries(plans)) {
      sandboxPlansByEval[evalId] = plan;
    }
  }
  return {
    ...base,
    sandboxPlansByEval,
  };
}

function acceptedResultFor(
  prepared: PreparedAcceptedAttempt,
  locator: AttemptLocator,
  locatorRunId: string,
): EvalResult {
  const {
    agent: _agent,
    model: _model,
    experimentId: _experimentId,
    experiment: _experiment,
    locator: _sourceLocator,
    locatorRunId: _sourceLocatorRunId,
    fingerprint: _sourceFingerprint,
    configHash: _sourceConfigHash,
    acceptedFrom: _previousAcceptedFrom,
    migratedFrom: _previousMigratedFrom,
    ...copied
  } = prepared.sourceResult;
  void _agent;
  void _model;
  void _experimentId;
  void _experiment;
  void _sourceLocator;
  void _sourceLocatorRunId;
  void _sourceFingerprint;
  void _sourceConfigHash;
  void _previousAcceptedFrom;
  void _previousMigratedFrom;
  return {
    ...copied,
    id: prepared.source.evalId,
    experimentId: prepared.pair.run.experimentId,
    agent: prepared.pair.run.agent.name,
    ...(prepared.pair.run.model === undefined ? {} : { model: prepared.pair.run.model }),
    ...(prepared.currentExperiment === undefined ? {} : { experiment: prepared.currentExperiment }),
    fingerprint: prepared.currentFingerprint,
    configHash: prepared.currentConfigHash,
    locator,
    locatorRunId,
    acceptedFrom: prepared.acceptedFrom,
  };
}

function locatorOf(attempt: AttemptHandle): AttemptLocator {
  if (attempt.locator !== undefined) return attempt.locator;
  return encodeAttemptLocator(attempt.locatorIdentity ?? {
    runId: attempt.result.locatorRunId ?? attempt.run.runId,
    evalId: attempt.evalId,
    attempt: attempt.result.attempt,
  });
}

function agentRunOf(experiment: DiscoveredExperiment, selectedEvalIds: readonly string[]): AgentRun {
  return {
    agent: experiment.agent,
    ...(experiment.model !== undefined ? { model: experiment.model } : {}),
    ...(experiment.reasoningEffort !== undefined ? { reasoningEffort: experiment.reasoningEffort } : {}),
    flags: experiment.flags,
    attempts: experiment.attempts,
    earlyExit: experiment.earlyExit,
    ...(experiment.sandbox !== undefined ? { sandbox: experiment.sandbox } : {}),
    sandboxReuse: experiment.sandboxReuse,
    ...(experiment.judge !== undefined ? { judge: experiment.judge } : {}),
    ...resolveRunTimeout(undefined, experiment.timeoutMs),
    ...(experiment.budget !== undefined ? { budget: experiment.budget } : {}),
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    ...(experiment.description !== undefined ? { description: experiment.description } : {}),
    ...(Object.keys(experiment.labels).length > 0 ? { labels: experiment.labels } : {}),
    selectedEvalIds,
    ...(experiment.maxConcurrency !== undefined ? { maxConcurrency: experiment.maxConcurrency } : {}),
    ...(experiment.setup !== undefined ? { setup: experiment.setup } : {}),
    ...(experiment.teardown !== undefined ? { teardown: experiment.teardown } : {}),
    ...(experiment.classifyFailure !== undefined ? { classifyFailure: experiment.classifyFailure } : {}),
  };
}

function validateAcceptance(source: AttemptHandle, pair: PreparedRunPair, configTimeoutMs?: number): void {
  const result = source.result;
  if (result.verdict !== "passed" && result.verdict !== "failed") {
    throw new AcceptError(
      "not-terminal",
      `Attempt "${source.locator}" is ${result.verdict}; only passed or failed terminal results can be accepted.`,
    );
  }
  if (result.sandbox?.kept === true) {
    throw new AcceptError("sandbox-kept", `Attempt "${source.locator}" kept its Sandbox and cannot be accepted.`);
  }
  const evalHistory = source.run.evals.find((evalEntry) => evalEntry.id === source.evalId);
  if (!Number.isInteger(result.attempt) || result.attempt < 0) {
    throw new AcceptError("missing-attempt", `Attempt ${source.evalId} has an invalid sequence number.`);
  }
  // openRecord 产出的 Run 总有 evalHistory；低层嵌入调用方可提供手工句柄，缺少这份
  // 索引时不凭空宣称序号缺失，仍让其它资格门决定是否可接受。
  if (evalHistory !== undefined) {
    const attemptNumbers = new Set(evalHistory.attempts.map((attempt) => attempt.result.attempt));
    for (let index = 0; index <= result.attempt; index++) {
      if (!attemptNumbers.has(index)) {
        throw new AcceptError(
          "missing-attempt",
          `Attempt ${source.evalId}#${index} is missing; an incomplete attempt sequence cannot be accepted.`,
        );
      }
    }
  }
  const timeoutMs = resolvedTimeoutMsForCarry(pair.run, pair.evalDef, configTimeoutMs);
  const executionMs = result.executionMs ?? result.durationMs;
  if (typeof executionMs !== "number" || !Number.isFinite(executionMs) || executionMs < 0 || executionMs > timeoutMs) {
    throw new AcceptError(
      "timeout",
      `Attempt "${source.locator}" exceeds the current timeout (${String(timeoutMs)} ms).`,
    );
  }
}

async function loadManifest(source: AttemptHandle): Promise<EvalManifest | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(source.run.dir, MANIFESTS_FILE), "utf8")) as unknown;
    return parseRunManifests(raw)[source.evalId];
  } catch {
    return undefined;
  }
}

function acceptedDifferenceOf(delta: FingerprintDelta): AcceptedDifference {
  return {
    selector: delta.selector,
    ...(delta.from !== undefined ? { from: delta.from } : {}),
    ...(delta.to !== undefined ? { to: delta.to } : {}),
  };
}
