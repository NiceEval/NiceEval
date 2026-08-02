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
  computeConfigHash,
  fingerprintWithManifest,
  resolvedTimeoutMsForCarry,
} from "./fingerprint.ts";
import { configIdentityFromResult, configIdentityPaths } from "./config-identity.ts";
import { manifestDeltas, type FingerprintDelta } from "./manifest.ts";
import { experimentRunInfo } from "./attempt.ts";
import { resolveRunTimeout } from "./timeout.ts";
import {
  prepareRunSandboxes,
  type PreparedRunPair,
} from "./sandbox-selection.ts";
import { linkedRunRecordIdentity, type SandboxPlanningServices } from "../sandbox/plan.ts";
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
  | "pair-mismatch";

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

/**
 * 从当前项目发现并接受一条历史 locator。只写一条新结果，不运行 eval、Agent 或 Sandbox。
 */
export async function acceptLocator(options: AcceptLocatorOptions): Promise<AcceptedAttempt> {
  const cwd = resolve(options.cwd);
  const recordRoot = resolve(options.recordRoot ?? join(cwd, ".niceeval"));
  const prior = await openRecord(recordRoot);
  const source = resolveLocator(prior, options.locator);
  const sourceLocator = locatorOf(source);

  const config = options.config ?? await loadConfigFile(cwd);
  const evals = options.evals ?? await discoverEvals(cwd);
  const experiments = options.experiments ?? await discoverExperiments(cwd);
  const experiment = experiments.find((candidate) => candidate.id === source.experimentId);
  if (experiment === undefined) {
    throw new AcceptError(
      "experiment-not-found",
      `Current project does not discover experiment "${source.experimentId}" for locator "${sourceLocator}".`,
    );
  }
  const targetEval = evals.find((candidate) => candidate.id === source.evalId);
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
    evals,
  });
  if (!selection.selectedEvals.some((candidate) => candidate.id === targetEval.id)) {
    throw new AcceptError(
      "eval-not-selected",
      `Experiment "${experiment.id}" does not select eval "${targetEval.id}" under its current evals selector.`,
    );
  }

  const run = agentRunOf(experiment, selection.selectedEvalIds);
  let prepared: readonly PreparedRunPair[];
  try {
    prepared = await Effect.runPromise(prepareRunSandboxes(
      selection.selectedEvals,
      [run],
      options.planningServices,
      { configTimeoutMs: config.timeoutMs },
    ));
  } catch (cause) {
    throw new AcceptError(
      "planning-failed",
      `Current Sandbox planning for ${experiment.id} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const pair = prepared.find((candidate) => candidate.evalDef.id === targetEval.id);
  if (pair === undefined) {
    throw new AcceptError("pair-mismatch", `No current planning pair for ${experiment.id} × ${targetEval.id}.`);
  }
  const { fingerprint, manifest } = await fingerprintWithManifest(pair);
  const configHash = computeConfigHash(pair);
  const sandboxPlansByEval: globalThis.Record<string, JsonValue> = {};
  for (const candidate of prepared) sandboxPlansByEval[candidate.evalDef.id] = linkedRunRecordIdentity(candidate.plan);
  const currentExperiment = experimentRunInfo(
    run,
    pair.plan,
    sandboxPlansByEval,
    config,
    targetEval.judge,
  );
  return acceptPreparedAttempt({
    recordRoot,
    source,
    pair,
    currentFingerprint: fingerprint,
    currentManifest: manifest,
    currentConfigHash: configHash,
    configTimeoutMs: config.timeoutMs,
    currentExperiment,
    knownEvalIds: selection.selectedEvalIds,
    name: config.name,
    now: options.now,
    producer: options.producer,
  });
}

/** 已完成当前 planning/fingerprint 的低层入口，便于 runner/测试复用且不重复 discovery。 */
export async function acceptPreparedAttempt(options: AcceptPreparedAttemptOptions): Promise<AcceptedAttempt> {
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
  const deltas = manifestDeltas(historicalManifest, options.currentManifest, historicalConfig);
  const differences = deltas.map(acceptedDifferenceOf);
  const acceptedFrom: AcceptedResult = {
    locator: sourceLocator,
    fingerprint: oldFingerprint,
    acceptedFingerprint: options.currentFingerprint,
    differences,
  };

  const now = (options.now ?? (() => new Date().toISOString()))();
  const writer = createWriter(options.recordRoot, {
    producer: options.producer ?? { name: "niceeval" },
    snapshotStartedAt: now,
  });
  const snapshot = await writer.run({
    experimentId: pair.run.experimentId,
    agent: pair.run.agent.name,
    ...(pair.run.model !== undefined ? { model: pair.run.model } : {}),
    startedAt: now,
    configHash: options.currentConfigHash,
    ...(options.currentExperiment !== undefined ? { experiment: options.currentExperiment } : {}),
    ...(options.knownEvalIds?.length ? { knownEvalIds: [...options.knownEvalIds] } : {}),
    manifests: { [source.evalId]: options.currentManifest },
    ...(options.name !== undefined ? { name: options.name } : {}),
  });
  const locator = encodeAttemptLocator({
    runId: snapshot.runId,
    evalId: source.evalId,
    attempt: source.result.attempt,
  });
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
    ...copied
  } = sourceResult;
  void _agent;
  void _model;
  void _experimentId;
  void _experiment;
  void _sourceLocator;
  void _sourceLocatorRunId;
  void _sourceFingerprint;
  void _sourceConfigHash;
  void _previousAcceptedFrom;
  const accepted: EvalResult = {
    ...copied,
    id: source.evalId,
    experimentId: pair.run.experimentId,
    agent: pair.run.agent.name,
    ...(pair.run.model !== undefined ? { model: pair.run.model } : {}),
    ...(options.currentExperiment !== undefined ? { experiment: options.currentExperiment } : {}),
    fingerprint: options.currentFingerprint,
    configHash: options.currentConfigHash,
    locator,
    locatorRunId: snapshot.runId,
    acceptedFrom,
  };
  // artifactBase 已由 withArtifactBase() 设置，writer 的 carry 分支只复制 result.json，
  // 不重新落 artifacts；它保留新 locator/locatorRunId，因此新快照寻址与旧证据寻址分离。
  await writer.writeAttemptFor(accepted);
  await snapshot.finish();

  const record = await openRecord(options.recordRoot);
  const attempt = resolveLocator(record, locator);
  return {
    record,
    run: attempt.run,
    attempt,
    source,
    locator,
    sourceLocator,
    fingerprint: options.currentFingerprint,
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
    strict: false,
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
