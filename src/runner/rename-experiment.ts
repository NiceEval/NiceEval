// Experiment 身份改名后的结果重绑核心。
//
// 这里只做 discovery / planning / fingerprint 预检和 Record 写入，不启动 Eval、Agent 或
// Sandbox。正式写入严格复用同一份 plan，目标快照只创建一次，旧结果树只读不改。

import { join, relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";
import { loadConfigFile } from "../load-config.ts";
import { linkedRunRecordIdentity, type SandboxPlanningServices } from "../sandbox/plan.ts";
import { encodeAttemptLocator, type AttemptLocator } from "../record/locator.ts";
import { experimentDirOf } from "../record/format.ts";
import { openRecord, withArtifactBase } from "../record/open.ts";
import { createWriter } from "../record/writer.ts";
import type { AttemptHandle, Producer, Record as ResultsRecord, Run } from "../record/types.ts";
import type { EvalManifest } from "../record/manifest.ts";
import {
  discoverEvals,
  discoverExperiments,
  type DiscoveryError,
} from "./discover.ts";
import { resolveExperimentEvals } from "./eval-selection.ts";
import { fingerprintWithManifest, hashConfigIdentity } from "./fingerprint.ts";
import { configIdentityForRun } from "./config-identity.ts";
import { resolveJudge } from "./judge-config.ts";
import { experimentRunInfo } from "./attempt.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "./sandbox-selection.ts";
import { resolveRunTimeout } from "./timeout.ts";
import type {
  AgentRun,
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
  EvalResult,
  RenamedResult,
} from "./types.ts";

export type ExperimentRenameReason =
  | "source-empty"
  | "target-not-found"
  | "target-has-results"
  | "source-unreadable"
  | "artifact-unavailable"
  | "nothing-to-migrate";

export class ExperimentRenameError extends Error {
  constructor(
    public readonly reason: ExperimentRenameReason,
    message: string,
    public readonly plan?: ExperimentRenamePlan,
  ) {
    super(message);
    this.name = "ExperimentRenameError";
  }
}

/** Failures at the concrete Promise boundaries owned by experiment rename. */
export class ExperimentRenameOperationError extends Data.TaggedError("ExperimentRenameOperationError")<{
  readonly operation:
    | "config-load"
    | "record-open"
    | "fingerprint"
    | "writer-run"
    | "writer-write-attempt"
    | "writer-finish";
  readonly message: string;
}> {}

export type ExperimentRenameEffectFailure =
  | ExperimentRenameError
  | ExperimentRenameOperationError
  | DiscoveryError;

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function renamePromise<A>(
  operation: ExperimentRenameOperationError["operation"],
  operationEffect: () => Promise<A>,
): Effect.Effect<A, ExperimentRenameOperationError> {
  return Effect.tryPromise({
    try: operationEffect,
    catch: (cause) => new ExperimentRenameOperationError({ operation, message: causeMessage(cause) }),
  });
}

export interface ExperimentRenameOptions {
  /** 当前项目根。用于 discovery、配置解析与默认 `.niceeval` 结果根。 */
  cwd: string;
  /** 旧实验身份。 */
  oldId: string;
  /** 当前项目发现到的新实验身份。 */
  newId: string;
  recordRoot?: string;
  config?: Config;
  evals?: readonly DiscoveredEval[];
  experiments?: readonly DiscoveredExperiment[];
  /** 测试/嵌入调用方可复用的 physical planner。 */
  planningServices?: SandboxPlanningServices;
  /** 固定迁移时刻，保证计划与审计字段共用同一值。 */
  now?: () => string;
  producer?: Producer;
  /** 仅供已打开 Record 的嵌入调用方复用；写盘仍以 recordRoot 为目标。 */
  record?: ResultsRecord;
}

export interface ExperimentRenameMigration {
  evalId: string;
  sourceLocator: string;
  targetExperimentId: string;
  fingerprint: string;
}

export interface ExperimentRenameExcluded {
  evalId: string;
  reason: string;
}

export interface ExperimentRenameBlocked {
  reason: ExperimentRenameReason;
  evalId?: string;
  conflictingEvals?: readonly string[];
  detail?: string;
}

export interface ExperimentRenamePlan {
  status: "plan";
  oldId: string;
  newId: string;
  migrations: readonly ExperimentRenameMigration[];
  excluded: readonly ExperimentRenameExcluded[];
  blocked?: ExperimentRenameBlocked;
}

export interface ExperimentRenameDoneEntry {
  evalId: string;
  sourceLocator: string;
  locator: string;
  fingerprint: string;
  verdict: "passed" | "failed";
  renamedFrom: RenamedResult;
}

export interface RenamedExperiment {
  status: "done";
  oldId: string;
  newId: string;
  snapshotPath: string;
  migrated: readonly ExperimentRenameDoneEntry[];
}

export interface ExperimentRenameRejected {
  status: "rejected";
  oldId: string;
  newId: string;
  reason: ExperimentRenameReason;
  evalId?: string;
  conflictingEvals?: readonly string[];
  detail?: string;
}

interface RenamePlanEntry {
  evalId: string;
  attempt: number;
  verdict: "passed" | "failed";
  sourceLocator: string;
  fingerprint: string;
  targetFingerprint: string;
  configHash: string;
  artifactBase: string;
  source: AttemptHandle;
}

interface InternalRenamePlan {
  plan: ExperimentRenamePlan;
  entries: readonly RenamePlanEntry[];
  pairByEval: ReadonlyMap<string, PreparedRunPair>;
  manifestByEval: ReadonlyMap<string, EvalManifest>;
  targetRun: AgentRun;
  targetExperiment: DiscoveredExperiment;
  config: Config;
  producer: Producer;
  recordRoot: string;
}

const internalPlans = new WeakMap<ExperimentRenamePlan, InternalRenamePlan>();

export function planExperimentRename(
  options: ExperimentRenameOptions,
): Effect.Effect<ExperimentRenamePlan, ExperimentRenameOperationError | DiscoveryError> {
  return Effect.gen(function*() {
    const oldId = options.oldId;
    const newId = options.newId;
    const base = {
      status: "plan" as const,
      oldId,
      newId,
      migrations: [] as readonly ExperimentRenameMigration[],
      excluded: [] as readonly ExperimentRenameExcluded[],
    };

    if (oldId === newId) {
      return rememberPlan({ ...base, blocked: { reason: "source-unreadable", detail: "Source and target experiment ids must differ." } }, undefined);
    }

    const cwd = resolve(options.cwd);
    const recordRoot = resolve(options.recordRoot ?? join(cwd, ".niceeval"));
    const config = options.config ?? (yield* renamePromise("config-load", () => loadConfigFile(cwd)));
    const evals = options.evals ?? (yield* discoverEvals(cwd));
    const experiments = options.experiments ?? (yield* discoverExperiments(cwd));
    const record = options.record ?? (yield* renamePromise("record-open", () => openRecord(recordRoot)));
    const sourceExperiment = record.experiments.find((candidate) => candidate.id === oldId);
    if (sourceExperiment === undefined || sourceExperiment.runs.every((run) => run.attempts.length === 0)) {
      const sourceDir = resolve(recordRoot, experimentDirOf(oldId));
      const unreadableSource = record.unreadable.find((entry) => entry.dir === sourceDir || entry.dir.startsWith(`${sourceDir}${sep}`));
      return rememberPlan({
        ...base,
        blocked: unreadableSource === undefined
          ? { reason: "source-empty" }
          : { reason: "source-unreadable", detail: unreadableSource.detail ?? unreadableSource.reason },
      }, undefined);
    }

    const targetExperiment = experiments.find((candidate) => candidate.id === newId);
    if (targetExperiment === undefined) {
      return rememberPlan({ ...base, blocked: { reason: "target-not-found" } }, undefined);
    }

    const targetHistory = record.experiments.find((candidate) => candidate.id === newId);
    const conflicts = [...new Set(
      (targetHistory?.runs.flatMap((run) => run.attempts) ?? [])
        .filter((attempt) => attempt.result.verdict === "passed" || attempt.result.verdict === "failed")
        .map((attempt) => attempt.evalId),
    )].sort();
    if (conflicts.length > 0) {
      return rememberPlan({ ...base, blocked: { reason: "target-has-results", conflictingEvals: conflicts } }, undefined);
    }

    const selection = yield* Effect.sync(() => resolveExperimentEvals({
      experimentId: newId,
      selector: targetExperiment.evals,
      cliPatterns: [],
      evals,
    }));
    const selectedEvalIds = selection.selectedEvalIds;
    const selectedIds = new Set(selectedEvalIds);
    const sourceAttempts: AttemptHandle[] = [];
    const seenEvalIds = new Set<string>();
    for (const run of [sourceExperiment.latestRun, ...sourceExperiment.runs.filter((candidate) => candidate !== sourceExperiment.latestRun)]) {
      const attemptsByEval = new Map<string, AttemptHandle[]>();
      for (const attempt of run.attempts) {
        const group = attemptsByEval.get(attempt.evalId) ?? [];
        group.push(attempt);
        attemptsByEval.set(attempt.evalId, group);
      }
      for (const [evalId, attempts] of attemptsByEval) {
        if (seenEvalIds.has(evalId)) continue;
        seenEvalIds.add(evalId);
        sourceAttempts.push(...attempts);
      }
    }
    const excluded: ExperimentRenameExcluded[] = [];
    const terminalCandidates: AttemptHandle[] = [];
    const seenLocators = new Set<string>();
    for (const source of sourceAttempts) {
      const sourceLocator = locatorOf(source);
      if (seenLocators.has(sourceLocator)) {
        return rememberPlan({ ...base, excluded, blocked: { reason: "source-unreadable" } }, undefined);
      }
      seenLocators.add(sourceLocator);
      if (source.result.verdict !== "passed" && source.result.verdict !== "failed") {
        excluded.push({
          evalId: source.evalId,
          reason: `${source.result.verdict} results do not migrate`,
        });
        continue;
      }
      if (!selectedIds.has(source.evalId)) {
        excluded.push({
          evalId: source.evalId,
          reason: `${newId} no longer selects this eval`,
        });
        continue;
      }
      terminalCandidates.push(source);
    }

    if (terminalCandidates.length === 0) {
      return rememberPlan({ ...base, excluded, blocked: { reason: "nothing-to-migrate" } }, undefined);
    }

    if (terminalCandidates.some((source) => source.evidenceState === "dangling")) {
      return rememberPlan({ ...base, excluded, blocked: { reason: "artifact-unavailable" } }, undefined);
    }

    const targetRun = agentRunOf(targetExperiment, selectedEvalIds);
    const planning = yield* Effect.either(prepareRunSandboxes(
      selection.selectedEvals,
      [targetRun],
      options.planningServices,
      { configTimeoutMs: config.timeoutMs },
    ));
    if (planning._tag === "Left") {
      return rememberPlan({
        ...base,
        excluded,
        blocked: { reason: "source-unreadable", detail: causeMessage(planning.left) },
      }, undefined);
    }
    const pairs = planning.right;

    const pairByEval = new Map(pairs.map((pair) => [pair.evalDef.id, pair]));
    const sourceCache = new Map<string, Promise<string>>();
    const targetByEval = new Map<string, {
      pair: PreparedRunPair;
      fingerprint: string;
      configHash: string;
      manifest: EvalManifest;
    }>();
    for (const evalDef of selection.selectedEvals) {
      const pair = pairByEval.get(evalDef.id);
      if (pair === undefined) {
        return rememberPlan({ ...base, excluded, blocked: { reason: "source-unreadable" } }, undefined);
      }
      const judge = resolveJudge(targetRun.judge, evalDef.judge, config.judge);
      const identity = configIdentityForRun(targetRun, pair.plan, judge);
      const { fingerprint, manifest } = yield* renamePromise(
        "fingerprint",
        () => fingerprintWithManifest(pair, sourceCache, { _tag: "Current", identity }),
      );
      targetByEval.set(evalDef.id, {
        pair,
        fingerprint,
        configHash: hashConfigIdentity(identity),
        manifest,
      });
    }

    const entries: RenamePlanEntry[] = [];
    for (const source of terminalCandidates) {
      const current = targetByEval.get(source.evalId);
      const verdict = source.result.verdict;
      if (verdict !== "passed" && verdict !== "failed") continue;
      if (current === undefined || source.result.fingerprint === undefined) {
        continue;
      }
      entries.push({
        evalId: source.evalId,
        attempt: source.result.attempt,
        verdict,
        sourceLocator: locatorOf(source),
        fingerprint: source.result.fingerprint,
        targetFingerprint: current.fingerprint,
        configHash: current.configHash,
        artifactBase: withArtifactBase(source).artifactBase!,
        source,
      });
    }
    if (entries.length === 0) {
      return rememberPlan({ ...base, excluded, blocked: { reason: "nothing-to-migrate" } }, undefined);
    }

    const plan: ExperimentRenamePlan = {
      ...base,
      excluded,
      migrations: entries.map((entry) => ({
        evalId: entry.evalId,
        sourceLocator: entry.sourceLocator,
        targetExperimentId: newId,
        fingerprint: entry.targetFingerprint,
      })),
    };
    const producer = options.producer ?? { name: "niceeval" };
    const manifestByEval = new Map<string, EvalManifest>();
    for (const [evalId, current] of targetByEval) manifestByEval.set(evalId, current.manifest);
    const internal: InternalRenamePlan = {
      plan,
      entries,
      pairByEval,
      targetRun,
      targetExperiment,
      config,
      producer,
      recordRoot,
      manifestByEval,
    };
    internalPlans.set(plan, internal);
    return plan;
  });
}

export function renameExperiment(
  options: ExperimentRenameOptions,
): Effect.Effect<RenamedExperiment, ExperimentRenameEffectFailure> {
  return Effect.gen(function*() {
    const plan = yield* planExperimentRename(options);
    if (plan.blocked !== undefined) {
      return yield* Effect.fail(new ExperimentRenameError(
        plan.blocked.reason,
        `Cannot rename experiment "${plan.oldId}" to "${plan.newId}": ${plan.blocked.reason}.`,
        plan,
      ));
    }
    const internal = internalPlans.get(plan);
    if (internal === undefined) {
      return yield* Effect.fail(new ExperimentRenameError(
        "source-unreadable",
        "Rename plan is not writable in this process.",
        plan,
      ));
    }
    const first = internal.entries[0];
    if (first === undefined) {
      return yield* Effect.fail(new ExperimentRenameError(
        "nothing-to-migrate",
        "Rename plan contains no entries.",
        plan,
      ));
    }

    const now = (options.now ?? (() => new Date().toISOString()))();
    const writer = createWriter(internal.recordRoot, {
      producer: internal.producer,
      snapshotStartedAt: now,
    });
    const firstPair = internal.pairByEval.get(first.evalId);
    if (firstPair === undefined) {
      return yield* Effect.fail(new ExperimentRenameError(
        "source-unreadable",
        `Missing physical plan for eval "${first.evalId}".`,
        plan,
      ));
    }
    const plansByEval: globalThis.Record<string, import("../types.ts").JsonValue> = {};
    for (const pair of internal.pairByEval.values()) plansByEval[pair.evalDef.id] = linkedRunRecordIdentity(pair.plan);
    const selectedEvals = (internal.targetRun.selectedEvalIds.length > 0
      ? internal.targetRun.selectedEvalIds
      : [first.evalId]);
    const targetDefs = [...internal.pairByEval.values()].map((pair) => pair.evalDef);
    const firstDef = targetDefs.find((evalDef) => evalDef.id === first.evalId) ?? targetDefs[0];
    const experimentInfo = firstDef === undefined
      ? undefined
      : experimentRunInfo(
          internal.targetRun,
          firstPair.plan,
          plansByEval,
          internal.config,
          resolveJudge(internal.targetRun.judge, firstDef.judge, internal.config.judge),
        );
    const snapshot = yield* renamePromise("writer-run", () => writer.run({
      experimentId: internal.targetExperiment.id,
      agent: internal.targetRun.agent.name,
      ...(internal.targetRun.model === undefined ? {} : { model: internal.targetRun.model }),
      startedAt: now,
      configHash: first.configHash,
      ...(experimentInfo === undefined ? {} : { experiment: experimentInfo }),
      knownEvalIds: [...selectedEvals],
      manifests: Object.fromEntries(internal.entries.flatMap((entry) => {
        const manifest = internal.manifestByEval.get(entry.evalId);
        return manifest === undefined ? [] : [[entry.evalId, manifest] as const];
      })),
      ...(internal.config.name === undefined ? {} : { name: internal.config.name }),
    }));

    for (const entry of internal.entries) {
      const source = entry.source;
      const sourceResult = withArtifactBase(source);
      const renamedFrom: RenamedResult = {
        experimentId: plan.oldId,
        locator: entry.sourceLocator,
        fingerprint: entry.fingerprint,
        at: now,
      };
      const locator = encodeAttemptLocator({ runId: snapshot.runId, evalId: entry.evalId, attempt: entry.attempt });
      const renamed: EvalResult = {
        ...sourceResult,
        id: entry.evalId,
        experimentId: plan.newId,
        agent: internal.targetRun.agent.name,
        ...(internal.targetRun.model === undefined ? {} : { model: internal.targetRun.model }),
        ...(experimentInfo === undefined ? {} : { experiment: experimentInfo }),
        fingerprint: entry.targetFingerprint,
        configHash: entry.configHash,
        locator,
        locatorRunId: snapshot.runId,
        artifactBase: sourceResult.artifactBase,
        renamedFrom,
      };
      yield* renamePromise("writer-write-attempt", () => writer.writeAttemptFor(renamed));
    }
    yield* renamePromise("writer-finish", () => snapshot.finish({ completedAt: now }));
    const record = yield* renamePromise("record-open", () => openRecord(internal.recordRoot));
    const renamedExperiment = record.experiments.find((experiment) => experiment.id === plan.newId);
    if (renamedExperiment === undefined) {
      return yield* Effect.fail(new ExperimentRenameError(
        "source-unreadable",
        `Record did not contain renamed experiment "${plan.newId}".`,
        plan,
      ));
    }
    const run = renamedExperiment.latestRun;
    const migrated = run.attempts.map((attempt) => ({
      evalId: attempt.evalId,
      sourceLocator: attempt.result.renamedFrom!.locator,
      locator: attempt.locator!,
      fingerprint: attempt.result.fingerprint!,
      verdict: attempt.result.verdict as "passed" | "failed",
      renamedFrom: attempt.result.renamedFrom!,
    }));
    return {
      status: "done",
      oldId: plan.oldId,
      newId: plan.newId,
      snapshotPath: relative(resolve(options.cwd), run.dir).split(sep).join("/"),
      migrated,
    };
  });
}

function rememberPlan(plan: ExperimentRenamePlan, internal: InternalRenamePlan | undefined): ExperimentRenamePlan {
  if (internal !== undefined) internalPlans.set(plan, internal);
  return plan;
}

function locatorOf(source: AttemptHandle): AttemptLocator {
  if (source.locator !== undefined) return source.locator;
  return encodeAttemptLocator(source.locatorIdentity ?? {
    runId: source.result.locatorRunId ?? source.run.runId,
    evalId: source.evalId,
    attempt: source.result.attempt,
  });
}

function agentRunOf(experiment: DiscoveredExperiment, selectedEvalIds: readonly string[]): AgentRun {
  return {
    agent: experiment.agent,
    ...(experiment.model === undefined ? {} : { model: experiment.model }),
    ...(experiment.reasoningEffort === undefined ? {} : { reasoningEffort: experiment.reasoningEffort }),
    flags: experiment.flags,
    attempts: experiment.attempts,
    earlyExit: experiment.earlyExit,
    ...(experiment.sandbox === undefined ? {} : { sandbox: experiment.sandbox }),
    sandboxReuse: experiment.sandboxReuse,
    ...(experiment.judge === undefined ? {} : { judge: experiment.judge }),
    ...resolveRunTimeout(undefined, experiment.timeoutMs),
    ...(experiment.budget === undefined ? {} : { budget: experiment.budget }),
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    ...(experiment.description === undefined ? {} : { description: experiment.description }),
    ...(Object.keys(experiment.labels).length === 0 ? {} : { labels: experiment.labels }),
    selectedEvalIds,
    ...(experiment.maxConcurrency === undefined ? {} : { maxConcurrency: experiment.maxConcurrency }),
    ...(experiment.setup === undefined ? {} : { setup: experiment.setup }),
    ...(experiment.teardown === undefined ? {} : { teardown: experiment.teardown }),
    ...(experiment.classifyFailure === undefined ? {} : { classifyFailure: experiment.classifyFailure }),
  };
}
