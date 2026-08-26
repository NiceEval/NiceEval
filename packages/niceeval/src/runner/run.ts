// 运行器主调度:发现产出的 eval × agent × runs → attempt,有界并发调度。
// 职责只有编排:指纹缓存在 fingerprint.ts,单 attempt 生命周期在 attempt.ts,
// reporter 编排 / 汇总在 report.ts，Direct Agent 的 Sandbox 占位适配器在 direct-agent-sandbox.ts。

import { Effect, Cause, Data, Deferred, Either, Exit, Option } from "effect";
import { probeJudgeEffect } from "../assertions/judge.ts";
import type { SealedAttemptAssertions } from "../assertions/api.ts";
import { t } from "../i18n/index.ts";
import { cacheKey, planProjectTarget } from "./fingerprint.ts";
import { OtelReceiverPool } from "../o11y/otlp/turn-otel.ts";
import {
  errorFromThrown,
  // attemptOrigin re-exported via timing for Run diagnostics

  attemptFailureDeclaration,
  experimentRunInfo,
  runAttemptEffect,
  scoreFactOutcomeForAttemptError,
  type AttemptFailureDeclaration,
  type SandboxCleanupFailure,
} from "./attempt.ts";
import type {
  DiagnosticRecord,
  EvalResult,
  InvocationShape,
  InvocationSummary,
  JsonValue,
  ResolvedJudgeConfig,
  Reporter,
  ReporterRegistration,
  SandboxBuildRecord,
} from "../types.ts";
import type {
  AgentRun,
  Attempt,
  AttemptError,
  ExperimentHookContext,
  LifecyclePhase,
  InvocationReceipt,
  AttemptRef,
  RunOptions,
} from "./types.ts";
import { attemptOrigin, artifactPrepareTimingHook, createRunTimingRecorder, runOrigin } from "./timing.ts";
import { buildFailureOrigin, startSandboxBuilds } from "../sandbox/build-coordinator.ts";
import { ArtifactPrepareCoordinator } from "../agents/provisioner.ts";
import { collectBuildPreparation, toBuildPreparation } from "./build-preparation.ts";
import type { BuildKey } from "../sandbox/identity.ts";
import { firstLine, getEnv } from "../util.ts";
import { runReporter, emitReporterEvent, scopeReporter, summarize } from "./report.ts";
import {
  reportAttemptLifecycle,
  reportBudgetExhausted,
  reportDiagnostic,
  reportExperimentHook,
  reportExperimentProgress,
  reportFailure,
  reportInterrupted,
  reportLockWait,
  reportPrecheck,
  reportRunActivity,
} from "./feedback/sink.ts";
import { failureDetailFromCurrentReusedAttempt, failureDetailFromResult } from "./feedback/failure.ts";
import { COORDINATION_RECOVERED_CODE, EVALUATION_ALGORITHM, runWho, HALT_DIAGNOSTIC_CODE } from "./types.ts";
import { ReusableSandboxPool } from "./sandbox-pool.ts";
import { liveSandboxRuntimeServices } from "../sandbox/runtime.ts";
import { detectReuseContamination, reuseContaminationMessage } from "./reuse-diagnostics.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";
import { registerExperimentTeardown, unregisterExperimentTeardown } from "./experiment-cleanup-registry.ts";
import { cleanupCallback } from "./cleanup-timeout.ts";
import { resolveAttemptTimeout } from "./timeout.ts";
import { hostname } from "node:os";
import { linkPluginLifecycles, type GroupPluginContext } from "../plugin/contracts.ts";
import {
  isOrphanedTeardownRegistration,
  readTeardownRegistrationsEffect,
  removeTeardownRegistrationIfPresentEffect,
  teardownEntryId,
  writeTeardownRegistrationEffect,
} from "./teardown-registry.ts";
import {
  acquireCaseLockEffect,
  isCaseLockExpired,
  readCaseLockEffect,
  CASE_LOCK_HEARTBEAT_INTERVAL_MS,
  type CaseLockEffectClaim,
  type CaseLockRecord,
} from "./lock.ts";
import {
  acquireSharedStateLeaseEffect,
  currentProcessIdentityEffect,
  type SharedStateLeaseEffectClaim,
} from "./shared-state-lease.ts";
import {
  openRunnerRecordCoordinator,
  prepareRunnerRecordReuse,
  type RunnerRecordAttempt,
} from "./record.ts";
import { bindRunnerRunObservabilityDiagnostics } from "./source-receipts/runtime.ts";
import { sandboxReusePoolDescriptor } from "./sandbox-reuse.ts";
import { prepareSetupPrefixes } from "./setup-prefix-preparation.ts";

export class RunModeConflictError extends Data.TaggedError("RunModeConflictError")<{
  readonly keepSandbox: NonNullable<RunOptions["keepSandbox"]>;
  readonly conflictingExperimentIds: readonly string[];
  readonly conflictingEvalGroups: readonly {
    readonly experimentId: string | undefined;
    readonly evalGroupId: string;
  }[];
  readonly message: string;
}> {}

/** 反馈层的 attempt 身份 + 展示 label,两个 sink.ts lifecycle 调用点共用,避免各自手写
 *  同一组字段(见 memory 的 live-who-key-mismatch-freezes-rows —— 手写副本漏改是真实事故源)。 */
function feedbackIdentity(a: Attempt): AttemptRef {
  return { experimentId: a.run.experimentId, evalId: a.evalDef.id, attempt: a.attempt };
}
function feedbackWho(a: Attempt): string {
  return runWho({ agentName: a.run.agent.name, model: a.run.model, experimentId: a.run.experimentId });
}

const SHARED_BUILD_FAILURE_DIAGNOSTIC = "sandbox-build-failed";

function sharedBuildFailureRoot(error: AttemptError): { readonly code: string; readonly message: string } {
  const codeMatch = /\bERR_[A-Z0-9_]+\b/u.exec(error.message);
  const code = codeMatch?.[0] ?? error.code;
  const focused = codeMatch === null
    ? error.message.slice(-600)
    : error.message.slice(codeMatch.index, codeMatch.index + 600);
  return { code, message: focused.trim() || error.message.slice(-600).trim() || error.code };
}

function sharedBuildFailureDetail(a: Attempt, error: AttemptError): string {
  const failureId = error.origin.scope === "run"
    ? error.origin.timingNodeId
    : `${error.code}:${a.evalDef.id}`;
  const root = sharedBuildFailureRoot(error);
  let message = root.message;
  const encode = () => JSON.stringify({
      schema: "niceeval.shared-build-failure/v1",
      failureId,
      evalId: a.evalDef.id,
      attemptOrdinal: a.attempt,
      phase: "sandbox.image.build",
      errorCode: root.code,
      message,
      ...(root.code === "ERR_PNPM_IGNORED_BUILDS"
        ? { remediation: "pnpm-allow-builds" }
        : {}),
    });
  let encoded = encode();
  while (new TextEncoder().encode(encoded).byteLength > 1_000 && message.length > 0) {
    message = message.slice(0, Math.floor(message.length * 0.75));
    encoded = encode();
  }
  return encoded;
}
function attemptIdentityKey(
  experimentId: string | undefined,
  agentName: string,
  model: string | undefined,
  evalId: string,
): string {
  return JSON.stringify([experimentId, agentName, model ?? null, evalId]);
}

function attemptGroupKey(run: AgentRun, evalId: string): string {
  return attemptIdentityKey(run.experimentId, run.agent.name, run.model, evalId);
}

function reuseResultRequiresRetirement(result: EvalResult): boolean {
  return result.error?.code === "timeout" ||
    result.error?.code === "agent-send-failed" ||
    result.error?.code === "plugin-resource-prepare-failed" ||
    result.diagnostics?.some((diagnostic) => diagnostic.code === "teardown-failed") === true;
}

export type { AgentRun, RunOptions } from "./types.ts";

/** Only declared, configured capabilities are prechecked. A missing model or
 * key is an ordinary consumed-Fact unavailable outcome and does no network I/O. */
export function judgeProbeTargets(evals: readonly (ResolvedJudgeConfig | undefined)[]): ResolvedJudgeConfig[] {
  return judgeProbePlan(evals.map((judge, index) => ({ id: `#${index}`, judge }))).targets.map((target) => target.judge);
}

/** 一份探测目标的去重键:同一个 (model, baseUrl, apiKeyEnv) 只探一次,也用来把探测结局
 *  归回「哪些 Experiment × Eval pair 依赖这个端点」。 */
function judgeTargetKey(jc: ResolvedJudgeConfig): string {
  return `${jc.model ?? ""}|${jc.baseUrl}|${jc.apiKeyEnv}`;
}

/** `judgeProbeTargets` 的完整形态:除了去重后的探测目标,还给出「哪个 pair 依赖哪个目标」——
 *  预检失败只作废需要 judge 的那些 pair(见 docs/feature/judge/library.md「派发前预检」),
 *  所以必须能把探测结局按 pair 归因,不能只知道有几个端点要探。 */
export function judgeProbePlan(
  evals: ReadonlyArray<{ id: string; judge: ResolvedJudgeConfig | undefined }>,
): { targets: Array<{ key: string; judge: ResolvedJudgeConfig }>; evalKeys: Map<string, string> } {
  const targets: Array<{ key: string; judge: ResolvedJudgeConfig }> = [];
  const evalKeys = new Map<string, string>();
  const seen = new Set<string>();
  for (const e of evals) {
    const jc = e.judge;
    if (jc === undefined || jc.model === undefined || !getEnv(jc.apiKeyEnv)) continue;
    const key = judgeTargetKey(jc);
    evalKeys.set(e.id, key);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ key, judge: jc });
  }
  return { targets, evalKeys };
}

/** Connect an application-owned AbortSignal to the current Effect Scope. */
function interruptOnAbort(signal: AbortSignal): Effect.Effect<never> {
  return Effect.async((resume) => {
    const abort = () => resume(Effect.interrupt);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * The Runner is Effect-native from writer acquisition through dispatch and
 * publication. NodeRuntime is deliberately owned by the CLI/application edge.
 */
export function runEvals<AttachmentError, AttachmentRequirements>(
  opts: RunOptions<AttachmentError, AttachmentRequirements>,
) {
  return Effect.scoped(Effect.gen(function* () {
  const invocationScope = yield* Effect.scope;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const t0 = startedAtMs;
  // These roots have deliberately different ownership. `coordinationRoot`
  // contains only local Runner state; `recordRoot` is the portable fact root
  // passed unchanged to the Record reader/writer coordinator.
  const coordinationRoot = opts.coordinationRoot ?? `${process.cwd()}/.niceeval`;
  const recordRoot = opts.recordRoot;

  // `--keep-sandbox` 要把单条 Attempt 的最终现场转交给用户，
  // `sandboxReuse` 则让整个 Invocation 的 pool 继续拥有并在收尾时销毁同一个 Case。
  // 两种 ownership 不能同时成立；在 carry planning/build/provider 等任何资源动作之前
  // 拒绝，避免产生“已登记 kept 但 pool finalizer 又销毁”的假现场。
  if (opts.keepSandbox !== undefined) {
    const conflictingEvalGroups = [...new Map(opts.agentRuns.flatMap((run) =>
      selectedEvalsForRun(opts.evals, run)
        .filter((evalDef) => evalDef.evalGroup !== undefined)
        .map((evalDef) => {
          const value = Object.freeze({
            experimentId: run.experimentId,
            evalGroupId: evalDef.evalGroup!.id,
          });
          return [JSON.stringify([value.experimentId, value.evalGroupId]), value] as const;
        }))
      ).values()];
    const conflictingExperiments = [...new Set(
      opts.agentRuns
        .filter((run) =>
          run.sandboxReuse || conflictingEvalGroups.some((group) => group.experimentId === run.experimentId)
        )
        .map((run) => run.experimentId),
    )];
    if (conflictingExperiments.length > 0 || conflictingEvalGroups.length > 0) {
      throw new RunModeConflictError({
        keepSandbox: opts.keepSandbox,
        conflictingExperimentIds: Object.freeze(conflictingExperiments),
        conflictingEvalGroups: Object.freeze(conflictingEvalGroups),
        message:
          `--keep-sandbox cannot be combined with reusable Sandbox ownership` +
          `${conflictingExperiments.length === 0
            ? ""
            : ` (experiments: ${conflictingExperiments.map((id) => JSON.stringify(id)).join(", ")})`}` +
          `${conflictingEvalGroups.length === 0
            ? ""
            : ` (Eval Groups: ${conflictingEvalGroups.map(({ experimentId, evalGroupId }) =>
              `${JSON.stringify(experimentId)} / ${JSON.stringify(evalGroupId)}`).join(", ")})`}. ` +
          "Drop --keep-sandbox or select only fresh, ungrouped Evals.",
      });
    }
  }

  // Physical planning produces immutable current inputs. Record reuse receives
  // only this projection and its own frozen view; no historic result facade
  // participates in dispatch or display.
  const targetPlan = yield* planProjectTarget(
    opts.evals,
    opts.agentRuns,
    opts.config.timeoutMs,
    {
      configJudge: opts.config.judge,
      ...(opts.keepSandbox === undefined ? {} : { keepSandbox: opts.keepSandbox }),
    },
  );
  const {
    preparedPairsByKey,
    plannedConfigHashes,
    resolvedJudgesByKey,
    plannedFingerprints,
  } = targetPlan;

  // Plugin link produces one effective immutable AgentRun per source Run. All
  // runtime work after physical planning must consume that same linked value.
  const effectiveRunBySource = new Map<AgentRun, AgentRun>();
  for (const prepared of preparedPairsByKey.values()) {
    const prior = effectiveRunBySource.get(prepared.sourceRun);
    if (prior !== undefined && prior !== prepared.run) {
      throw new Error(`Plugin link produced inconsistent effective runs for Experiment ${JSON.stringify(prepared.sourceRun.experimentId)}.`);
    }
    effectiveRunBySource.set(prepared.sourceRun, prepared.run);
  }
  const effectiveAgentRuns = Object.freeze(opts.agentRuns.map((sourceRun) =>
    effectiveRunBySource.get(sourceRun) ?? sourceRun));
  opts = { ...opts, agentRuns: effectiveAgentRuns };

  const reuse = yield* prepareRunnerRecordReuse({
    evals: opts.evals,
    runs: opts.agentRuns,
    config: opts.config,
    plannedFingerprints,
    plannedConfigHashes,
    ...(opts.rerun === undefined ? {} : { rerun: opts.rerun }),
    ...(opts.keepSandbox === undefined ? {} : { keepSandbox: opts.keepSandbox }),
  });

  // Coordinator creates draft Runs first, then uses their real `draft.runId`
  // values and the frozen Record view to partition every Slot into reuse/gap.
  const recordCoordinator = yield* openRunnerRecordCoordinator({
    recordRoot,
    startedAt: t0,
    evals: opts.evals,
    runs: opts.agentRuns,
    reuse,
  });
  // The draft is the only authority for a Run identity. Session, shape and
  // reporters all observe this same mapping; no caller can replace it with a
  // synthetic legacy value.
  const runIds = recordCoordinator.runIdsByExperiment;
  const carriedAttemptsByKey = recordCoordinator.carriedAttemptsByKey;

  const reusedAttempts = yield* recordCoordinator.readCarriedResults();
  const runsByExperimentId = new Map(opts.agentRuns.map((run) => [run.experimentId, run] as const));
  const runForReusedAttempt = (readback: (typeof reusedAttempts)[number]): AgentRun => {
    const run = runsByExperimentId.get(readback.target.experimentId);
    if (run === undefined) {
      throw new Error(`Record reuse readback references unknown Experiment ${JSON.stringify(readback.target.experimentId)}.`);
    }
    return run;
  };
  // Readback is the sole authority for the externally visible carry count.
  // In particular, the CLI must not guess this before the frozen current view
  // has rejected every non-reusable source.
  const reusedFailures = Object.freeze(reusedAttempts.flatMap((readback) => {
    const failure = failureDetailFromCurrentReusedAttempt(readback, runForReusedAttempt(readback));
    return failure === undefined ? [] : [failure];
  }));
  if (opts.onCurrentRecordReusePlan !== undefined) {
    yield* opts.onCurrentRecordReusePlan({ reused: reusedAttempts.length, reusedFailures, runIds });
  } else {
    // Direct library callers have no feedback coordinator. Preserve their
    // fallback failure signal without turning a current readback into a legacy
    // result-shaped facade.
    for (const failure of reusedFailures) {
      reportFailure(failure);
    }
  }
  // Session 文件在首次派发前创建；它只记录 Run 身份与轻量计数，锁和实验闸仍各自维护。
  if (opts.session !== undefined) {
    yield* opts.session.start({
      runIds,
      agentRuns: opts.agentRuns,
      carriedAttemptsByKey,
      startedAt,
    });
  }

  const preparedPlansByRun = new Map<AgentRun, globalThis.Record<string, JsonValue>>();
  for (const prepared of preparedPairsByKey.values()) {
    const plans = preparedPlansByRun.get(prepared.run) ?? {};
    plans[prepared.evalDef.id] = prepared.identity;
    preparedPlansByRun.set(prepared.run, plans);
  }

  // 展开 attempts。每个 Eval Group 是一条按规范化 Eval ID 稳定串行的 lane；每个未分组 Eval 是一条
  // attempt-major lane。先按 lane 深度铺成全 Invocation 的 wave，保证任一 lane 的下一槽位
  // 都不会排到其它 lane 的首槽位之前。carried 槽位先从 lane 删除，不占 wave 也不触发 Sandbox。
  const attempts: Attempt[] = [];
  // Group 串行链与 wave 闸都是 Effect Deferred 协调:等待是 Deferred.await 的 Effect,
  // 释放是 Deferred 结算 Effect,不再经过裸 Promise resolve。
  const groupedPredecessors = new WeakMap<Attempt, Effect.Effect<void>>();
  const groupedReleases = new WeakMap<Attempt, Effect.Effect<void>>();
  const groupedTails = new Map<AgentRun, Map<string, Effect.Effect<void>>>();
  const dispatchWaveNumbers = new WeakMap<Attempt, number>();
  type SchedulingSlot = {
    readonly run: AgentRun;
    readonly i: number;
    readonly evalDef: ReturnType<typeof selectedEvalsForRun>[number];
  };
  const lanes: SchedulingSlot[][] = [];
  for (const run of effectiveAgentRuns) {
    // selectedEvalIds 已由 CLI 在构造 AgentRun 时对候选 eval 各求值一次算好(见
    // eval-selection.ts 的 resolveExperimentEvals());这里只按 resolved id 取 eval,
    // 不重新调用用户谓词(见 docs/feature/record/architecture.md「selectedEvalIds」)。
    const evals = selectedEvalsForRun(opts.evals, run);
    const grouped = new Map<string, Array<(typeof evals)[number]>>();
    for (const evalDef of evals) {
      if (evalDef.evalGroup === undefined) continue;
      grouped.set(evalDef.evalGroup.id, [...(grouped.get(evalDef.evalGroup.id) ?? []), evalDef]);
    }
    const addedGroups = new Set<string>();
    for (const evalDef of evals) {
      if (evalDef.evalGroup === undefined) {
        lanes.push([...Array(run.attempts).keys()].map((i) => ({ run, i, evalDef })));
        continue;
      }
      if (addedGroups.has(evalDef.evalGroup.id)) continue;
      addedGroups.add(evalDef.evalGroup.id);
      const groupEvals = grouped.get(evalDef.evalGroup.id) ?? [];
      lanes.push(groupEvals
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .flatMap((groupEval) => [...Array(run.attempts).keys()].map((i) => ({ run, i, evalDef: groupEval }))));
    }
  }
  const runnableLanes = lanes
    .map((lane) => lane.filter(({ run, i, evalDef }) =>
      !carriedAttemptsByKey.get(cacheKey(run, evalDef.id))?.has(i)))
    .filter((lane) => lane.length > 0);
  // LPT 仍作为 wave 内的稳定 tie-breaker：关键路径较长的 Experiment 先入同一波，但每一波
  // 最多只给每条 lane 一个新机会，不能再把整条长 Run 堆到其它 Group 前面。
  const runnableCountByRun = new Map<AgentRun, number>();
  for (const lane of runnableLanes) {
    const run = lane[0]!.run;
    runnableCountByRun.set(run, (runnableCountByRun.get(run) ?? 0) + lane.length);
  }
  const rounds = (run: AgentRun): number => {
    const width = Math.min(run.maxConcurrency ?? opts.maxConcurrency, opts.maxConcurrency);
    return Math.ceil((runnableCountByRun.get(run) ?? 0) / width);
  };
  runnableLanes.sort((left, right) => rounds(right[0]!.run) - rounds(left[0]!.run));
  const slots: Array<SchedulingSlot & { readonly wave: number }> = [];
  const waveCount = Math.max(0, ...runnableLanes.map((lane) => lane.length));
  for (let wave = 0; wave < waveCount; wave += 1) {
    for (const lane of runnableLanes) {
      const slot = lane[wave];
      if (slot !== undefined) slots.push({ ...slot, wave });
    }
  }
  for (const { run, i, evalDef, wave } of slots) {
        const carryKey = cacheKey(run, evalDef.id);
        // 携带以 attempt 为粒度:只跳过这个具体序号确实被携入的那些(见 fingerprint.ts 的
        // `carriedAttemptsByKey`),不是"这个组合有过携入就跳过前 N 个"——attempts:5 里若只有
        // 序号 1 是上一轮的终态、序号 0 是 errored,这里必须只跳过序号 1、照常调度序号 0。
        if (carriedAttemptsByKey.get(carryKey)?.has(i)) continue;
        // key 标识「同一个运行配置下的同一条 eval」,earlyExit 的跳过/abort 只应作用于
        // 同 key 的重试轮。experimentId 必须进 key:两个实验可以同 agent 同 model、只差
        // flags(feature A/B 正是这种形状),漏掉它会让先过的实验把其它实验的同名 eval
        // 整个跳掉——花了钱还丢结果。
        const key = attemptGroupKey(run, evalDef.id);
        const prepared = preparedPairsByKey.get(cacheKey(run, evalDef.id));
        if (prepared === undefined) {
          throw new Error(`Missing prepared Sandbox plan for ${JSON.stringify(cacheKey(run, evalDef.id))}.`);
        }
        if (prepared.run !== run) {
          throw new Error(
            `Plugin effective Run invariant failed for ${JSON.stringify(cacheKey(run, evalDef.id))}.`,
          );
        }
        const configHash = plannedConfigHashes.get(cacheKey(run, evalDef.id));
        if (configHash === undefined) {
          throw new Error(`Missing planned config hash for ${JSON.stringify(cacheKey(run, evalDef.id))}.`);
        }
        const fingerprint = plannedFingerprints.get(cacheKey(run, evalDef.id));
        if (fingerprint === undefined) {
          throw new Error(`Missing planned fingerprint for ${JSON.stringify(cacheKey(run, evalDef.id))}.`);
        }
        if (!resolvedJudgesByKey.has(carryKey)) {
          throw new Error(`Missing planned Judge resolution for ${JSON.stringify(carryKey)}.`);
        }
        const sandboxPlansByEval = preparedPlansByRun.get(run);
        if (sandboxPlansByEval === undefined) {
          throw new Error(`Missing Experiment plan map for ${JSON.stringify(run.experimentId)}.`);
        }
        const attempt: Attempt = {
          evalDef,
          run,
          attempt: i,
          key,
          fingerprint,
          configHash,
          judge: resolvedJudgesByKey.get(carryKey),
          plan: prepared.plan,
          sandboxPlansByEval,
        };
        attempts.push(attempt);
        dispatchWaveNumbers.set(attempt, wave);
        if (evalDef.evalGroup !== undefined) {
          let tails = groupedTails.get(run);
          if (tails === undefined) groupedTails.set(run, (tails = new Map()));
          const predecessor = tails.get(evalDef.evalGroup.id) ?? Effect.void;
          const settled = yield* Deferred.make<void>();
          groupedPredecessors.set(attempt, predecessor);
          groupedReleases.set(attempt, Deferred.succeed(settled, undefined).pipe(Effect.asVoid));
          tails.set(evalDef.evalGroup.id, Deferred.await(settled));
        }
  }

  // 公平闸只保护每条 lane 的首槽位：任一 lane 的后续槽位都要等所有 lane 的首槽位
  // 至少拿到过一次全局并发位（或在此前确定不派发）。首波以后不再跨 lane 组 wave；
  // Group 自己的 predecessor 已经保证 lane 内串行，继续要求第 N 波全部抵达会让慢 lane
  // 尚未完成的当前槽挡住快 lane 的空闲后继，制造真实空闲和时间轴空白。
  // arrive 同时挂在派发点与 ensuring，保持未派发/中断路径也能结算首波。
  const dispatchWaveReady = new WeakMap<Attempt, Effect.Effect<void>>();
  const dispatchWaveArrive = new WeakMap<Attempt, Effect.Effect<void>>();
  const firstWave = attempts.filter((attempt) => dispatchWaveNumbers.get(attempt) === 0);
  let firstWaveRemaining = firstWave.length;
  const firstWaveSettled = yield* Deferred.make<void>();
  const firstWaveReady = firstWaveRemaining === 0
    ? Effect.void
    : Deferred.await(firstWaveSettled);
  for (const attempt of attempts) {
    const isFirst = dispatchWaveNumbers.get(attempt) === 0;
    dispatchWaveReady.set(attempt, isFirst ? Effect.void : firstWaveReady);
    if (!isFirst) {
      dispatchWaveArrive.set(attempt, Effect.void);
      continue;
    }
    let arrived = false;
    dispatchWaveArrive.set(attempt, Effect.gen(function* () {
      if (arrived) return;
      arrived = true;
      firstWaveRemaining -= 1;
      if (firstWaveRemaining === 0) {
        yield* Deferred.succeed(firstWaveSettled, undefined);
      }
    }));
  }

  // 预检 judge:验证 API key + 端点可达,避免跑完 agent 才发现 judge 不通。
  // 放在 attempts 展开之后,fail fast 只对会真正触发 judge 的运行生效
  // (目标收集逻辑见 judgeProbeTargets;全部结果携入、attempts 为空时也自然跳过)。
  // 预检失败的受影响 pair:experimentId|evalId → 失败原因(带实际探测端点)。同一个 Eval
  // 可被多个 Experiment 用不同 Judge 跑 A/B，不能让一个端点的失败连坐另一个配对。
  // 不派发、不建沙箱,逐条落成 errored(见下方 judgePrecheckFailures 的消费点);其余 eval
  // 照常派发——一条 judge 配置问题不没收整批与它无关的结果。
  const judgePrecheckFailures = new Map<string, string>();
  {
    const uniquePairs = [...new Map(attempts.map((a) => [cacheKey(a.run, a.evalDef.id), a])).entries()];
    const plannedByPair = new Map<string, number>();
    for (const attempt of attempts) {
      const pairKey = cacheKey(attempt.run, attempt.evalDef.id);
      plannedByPair.set(pairKey, (plannedByPair.get(pairKey) ?? 0) + 1);
    }
    const { targets, evalKeys } = judgeProbePlan(
      uniquePairs.map(([id, a]) => ({
        id,
        judge: a.judge,
      })),
    );
    if (targets.length > 0) {
      // judge 预检是一次真实网络往返,可能慢甚至长时间不返回:发运行级行(started/done/failed),
      // 让 live 面板在预检期间显示「为什么还停在 0 running · N queued」,而不是看起来卡死
      // (见 docs/feature/experiments/cli.md「判分预检的显示」)。
      reportPrecheck({ status: "started" });
      const precheckStartedAt = Date.now();
      // 逐个目标各记自己的结局:一个端点不通不该作废依赖另一个(可用)端点的 eval,
      // 而落进 attempt 的 error.message 也必须是它自己那个端点的失败原因。
      const failedByKey = new Map<string, string>();
      for (const target of targets) {
        const err = yield* probeJudgeEffect(target.judge, opts.signal);
        if (err) {
          failedByKey.set(target.key, err);
        }
      }
      for (const [pairKey, key] of evalKeys) {
        const err = failedByKey.get(key);
        if (err === undefined) continue;
        judgePrecheckFailures.set(pairKey, err);
        const pair = uniquePairs.find(([candidate]) => candidate === pairKey)?.[1];
        if (pair === undefined) continue;
        const planned = plannedByPair.get(pairKey) ?? 1;
        // No Attempt exists yet, so this pair-owned warning is the stable
        // machine projection: identity and terminal counts travel in data,
        // without fabricating a locator-addressable eval event.
        reportDiagnostic({
          key: `judge-precheck-failed:${pairKey}`,
          code: "judge-precheck-failed",
          severity: "error",
          message: err,
          data: {
            phase: "judge.precheck",
            ...(pair.run.experimentId === undefined ? {} : { experimentId: pair.run.experimentId }),
            evalId: pair.evalDef.id,
            planned,
            errored: planned,
          },
        });
      }
      reportPrecheck({
        status: failedByKey.size > 0 ? "failed" : "done",
        durationMs: Date.now() - precheckStartedAt,
      });
    }
  }

  // Provider-native setup-prefix artifacts are a Run-level pre-dispatch gate.
  // At capacity one every unique prefix is completed serially and the live
  // prepare VM is released before any ordinary Attempt can acquire a VM.
  const setupPrefixPreparation = yield* prepareSetupPrefixes(
    attempts,
    judgePrecheckFailures,
    opts.signal,
  );

  // Run 级共享构建准备:携带规划后只为仍需 fresh 的 BuildKey 工作。独立并发、不占
  // attempt 并发位;失败按依赖 eval 扇出,origin 指向同一个 sandbox.build timing node。
  // 显式 buildPreparation 优先(测试注入);否则从 pair-owned ProviderPlan 自动收集。
  const runTiming = createRunTimingRecorder();
  let sandboxBuildRecords: SandboxBuildRecord[] = [];
  const buildFailureByPair = new Map<string, AttemptError>();

  const collected =
    opts.buildPreparation === undefined
      ? yield* collectBuildPreparation({
          preparedPairs: [...preparedPairsByKey.values()],
          carriedAttemptsByKey,
        })
      : Option.none();
  const buildPreparation = opts.buildPreparation === undefined
    ? Option.flatMap(collected, toBuildPreparation)
    : Option.some(opts.buildPreparation);
  const buildPrep = Option.getOrUndefined(buildPreparation);
  const buildDependents = new Map<import("../sandbox/build-coordinator.ts").SandboxBuildRef, number>();
  if (buildPrep !== undefined) {
    for (const attempt of attempts) {
      const keys = buildPrep.pairBuildKeys[cacheKey(attempt.run, attempt.evalDef.id)] ?? [];
      for (const key of keys) buildDependents.set(key, (buildDependents.get(key) ?? 0) + 1);
    }
  }
  // 共享构建**不阻塞派发**:整批 key 同时开工,每条 attempt 只等自己引用的那几个 key
  // (case.md「Run 级构建协调」第 4 条的逐 key 放行)。全局 barrier 会让 10 个已就绪的镜像
  // 陪着最慢的那个构建干等(台账见 memory/shared-build-single-barrier-not-per-buildkey.md)。
  const runningBuilds =
    buildPrep && buildPrep.works.length > 0
      ? startSandboxBuilds(buildPrep.works, {
          timing: runTiming,
          provider: buildPrep.provider,
          maxConcurrency: opts.maxBuildConcurrency ?? buildPrep.maxConcurrency ?? 2,
          ...(buildPrep.buildTimeoutMs !== undefined ? { buildTimeoutMs: buildPrep.buildTimeoutMs } : {}),
          ...(buildPrep.prepareBudgetMs !== undefined ? { prepareBudgetMs: buildPrep.prepareBudgetMs } : {}),
          signal: opts.signal,
          // 最小反馈钩子:共享构建投影为运行级 active 行 / 非 TTY 起止事件,不占 attempt 位。
          onActivity: (event) => {
            const dependents = buildDependents.get(event.ref) ?? 0;
            const shared = `${dependents} attempt${dependents === 1 ? "" : "s"}`;
            const action = event.status === "started"
              ? "checking build cache"
              : event.outcome === "hit"
              ? "build cache hit"
              : event.outcome === "built"
              ? "built once"
              : event.outcome === "cancelled"
              ? "build cancelled"
              : "build failed";
            reportRunActivity({
              id: event.id,
              key: event.key,
              label: `${action} · ${event.label} · ${shared}`,
              status: event.status,
              ...("durationMs" in event ? { durationMs: event.durationMs } : {}),
            });
          },
        })
      : undefined;

  // 逐 pair 的放行闸:第一次问到就记下等待,之后同 pair 的其它 attempt 复用同一条。
  const buildUseKey = (a: Attempt): string => `${cacheKey(a.run, a.evalDef.id)}|${a.attempt}`;
  const buildWaits = new Map<string, Promise<void>>();
  const buildUseHandles = new Map<string, Array<{ release(): Promise<void> | void }>>();
  const buildLocatorsByAttempt = new Map<string, Map<BuildKey, JsonValue>>();
  const buildWorkByRef = new Map(buildPrep?.works.map((work) => [work.ref, work]) ?? []);
  const awaitBuildsFor = (a: Attempt): Promise<void> => {
    const pairKey = cacheKey(a.run, a.evalDef.id);
    const keys = buildPrep?.pairBuildKeys[pairKey];
    if (runningBuilds === undefined || keys === undefined || keys.length === 0) return Promise.resolve();
    const useKey = buildUseKey(a);
    let pending = buildWaits.get(useKey);
    if (pending !== undefined) return pending;
    pending = (async () => {
      for (const key of keys) await runningBuilds.settled(key);
      const locators = new Map<BuildKey, JsonValue>();
      const handles: Array<{ release(): Promise<void> | void }> = [];
      buildUseHandles.set(useKey, handles);
      for (const key of keys) {
        const failure = runningBuilds.failures.get(key);
        if (failure !== undefined) {
          const originFields = buildFailureOrigin(failure);
          buildFailureByPair.set(pairKey, {
            code: originFields.code,
            message: originFields.message,
            origin: runOrigin(originFields.timingNodeId),
            ...(originFields.cause !== undefined ? { cause: originFields.cause } : {}),
          });
          return;
        }
        const source = runningBuilds.sources.get(key);
        const work = buildWorkByRef.get(key);
        if (source !== undefined && work !== undefined) {
          const handle = await source.acquireUse(opts.signal ?? new AbortController().signal);
          handles.push(handle);
          locators.set(work.buildKey, handle.locator);
        }
      }
      if (locators.size > 0) buildLocatorsByAttempt.set(useKey, locators);
    })();
    buildWaits.set(useKey, pending);
    return pending;
  };
  const releaseBuildUsesFor = (a: Attempt): Effect.Effect<void> => Effect.tryPromise({
    try: async () => {
      const handles = buildUseHandles.get(buildUseKey(a)) ?? [];
      buildUseHandles.delete(buildUseKey(a));
      await Promise.all(handles.map((handle) => handle.release()));
    },
    catch: () => undefined,
  }).pipe(Effect.ignore);

  // Run 级 Agent artifact prepare:由 attempt 内探测到目标 Sandbox 平台后触发 single-flight。
  // 绝不能在这里按宿主平台 eager prepare：macOS 宿主跑 Linux Sandbox 会拿到错误制品。
  const artifactPrepare =
    opts.artifactPrepare ??
    new ArtifactPrepareCoordinator(artifactPrepareTimingHook(runTiming));

  // The shared receiver belongs to this invocation Scope. Closing through its
  // finalizer covers ordinary completion, Record write failure, and interrupt
  // uniformly; attempts receive the same immutable pool snapshot.
  const otelPool = yield* Effect.acquireRelease(
    Effect.sync(() => opts.otelPool ?? new OtelReceiverPool(opts.config.telemetry?.port)),
    (pool) => pool.closeEffect().pipe(Effect.ignore),
  );

  // Runtime dependencies are added to a fresh snapshot; caller-owned planning
  // inputs remain immutable for the duration of this invocation.
  const attemptOptions: RunOptions<AttachmentError, AttachmentRequirements> = {
    ...opts,
    coordinationRoot,
    artifactPrepare,
    otelPool,
  };

  // 缓存携入只在 plan 的 Reuse 行给数量,不逐条铺 eval id 清单(见 cli.md「人在终端里怎么用」:
  // 哪些 eval 复用、哪些重跑属于 --dry 与 niceeval view,不占 human 的 scrollback)。

  // onInvocationStart 报「本次实际要跑的 eval」(过滤 + 去重),不是发现到的全部 —— 否则计数误导。
  const runningIds = new Set(attempts.map((a) => a.evalDef.id));
  const runningEvals = [...runningIds].map((id) => ({ id }));
  const shape: InvocationShape = {
    evals: runningEvals.length,
    configs: effectiveAgentRuns.length,
    totalAttempts: attempts.length,
    maxConcurrency: opts.maxConcurrency,
    runIds,
  };
  // eval 级 reporters:实例只观测引用它的 eval(经 scopeReporter 过滤转发)。
  // 已经挂在全局 reporters 里的同一实例不重复挂;同一实例被多个 eval 引用时合并观测集
  // (共享一个目的地,如同一个 Braintrust 实验)。本次没有任何被观测 eval 要跑时整个跳过。
  const scopedSets = new Map<Reporter, Set<string>>();
  for (const e of opts.evals) {
    for (const r of e.reporters ?? []) {
      if (opts.reporters.some((reg) => reg.reporter === r)) continue;
      let ids = scopedSets.get(r);
      if (!ids) scopedSets.set(r, (ids = new Set()));
      ids.add(e.id);
    }
  }
  const reporters: ReporterRegistration[] = [...opts.reporters];
  // EvalDef.reporters 是用户在单个 eval 上挂的补充观测(如「这个 eval 单独也发一份到某个
  // dashboard」),不是 CLI 显式注册的默认/机器出口——与 Config.reporters 同样默认
  // best-effort(见 ReporterRegistration 的字段注释:required 只留给 --junit)。name 用「scope 内第几个」编号,足以在诊断里区分「哪一个 eval 级 reporter」,
  // 不需要用户自己起名字。
  let evalReporterIndex = 0;
  for (const [r, ids] of scopedSets) {
    const scopedRuns = attempts.filter((a) => ids.has(a.evalDef.id)).length;
    if (scopedRuns === 0) continue;
    reporters.push({
      reporter: scopeReporter(r, ids, {
        evals: [...ids].filter((id) => runningIds.has(id)).length,
        configs: effectiveAgentRuns.length,
        totalAttempts: scopedRuns,
        maxConcurrency: opts.maxConcurrency,
        runIds,
      }),
      name: `eval-reporter-${evalReporterIndex++}`,
      required: false,
    });
  }

  for (const reg of reporters) {
    // reporter 只是结果消费方:单个 reporter 抛错记 diagnostic,不能让整次调度崩,也不阻断
    // 其它 reporter 的必要收尾(required/best-effort 的判定权重在 runReporter 内部处理)。
    yield* runReporter(reg, "onInvocationStart", () => reg.reporter.onInvocationStart?.(runningEvals, shape));
  }
  yield* emitReporterEvent(reporters, {
    type: "invocation:start",
    evals: runningEvals,
    shape,
  });
  const results: EvalResult[] = [];
  const passedKeys = new Set<string>();
  // errored = 框架/环境层面的意外(超时、adapter 崩、eval 脚本抛异常……),不是 agent 表现的信号。
  // 同 key 一旦 errored 就会确定性地重复 error,再跑 runs 里剩下的次数纯烧钱;只有 failed(断言
  // 真的没过)才代表 agent 行为的样本,值得跑满 runs 去测通过率。earlyExit 开时两者都提前收尾。
  // run 级 fail-fast(见 docs/runner.md「首过即停」):同一错误 code 在同一 key 连续复现
  // 即判定确定性错误,停止派发受同一配置影响的后续 attempt(如实报 errored 的结果保留;
  // 这是止损,不是「首过即停」,两个机制互不混用)。
  const lastErrorCode = new Map<string, { code: string; streak: number }>();
  const failFastKeys = new Map<string, { code: string; skipped: number }>();
  // 当前 Record reuse 的 passed readback 预置进 passedKeys:上面按序号回填的差额 attempt(carriedCount < run.attempts
  // 那部分)如果不预置这个,会在明明已经拿到过 passed 结果的情况下真的再调度一次 agent——
  // earlyExit 的语义是「已知会通过就不用再跑」,携入的 passed 同样是「已知会通过」,理应同等对待
  // (下面 preflight/body 的 earlyExit 判断本来就只在 a.run.earlyExit 为真时读这两个 Set,所以
  // 这里无条件预置对 --no-early-exit 场景没有副作用)。携入的 failed 故意不预置——failed 本来
  // 就不触发 earlyExit,回填的差额必须真的重跑,才对得起用户调大 runs 的意图(想看这次是不是
  // 还失败,或想凑够 pass@N 的样本量)。
  for (const readback of reusedAttempts) {
    if (readback.verdict !== "passed" || readback.source.evaluationKind !== "pass") continue;
    const run = runForReusedAttempt(readback);
    passedKeys.add(attemptGroupKey(run, readback.target.evalId));
  }

  // budget 护栏:只按「已完成 attempt 的价目表估算成本」判断,不做预测性节流。observed
  // usage.costUSD 不参与 budget。之前的实现会按
  // 「平均成本 × 在飞数」预扣,快到顶就让还没起飞的 attempt 排队等——这在探测阶段(还没有任何
  // 成本样本时)等价于把同一 budgetKey 的并发摁到一个很小的数,且完全没有文档承诺过这个副作用
  // (`apps/docs-site/zh/tutorials/write-experiment.mdx` 对 `budget` 的描述只有一句「这一格配置的预算
  // 上限」)。新语义:已完成 attempt 的花费加总一旦到顶,就不再放新 attempt 起飞(已经在飞的
  // 照常跑完,不会被中途打断);到顶之前不做任何预测性限流,并发完全由 globalSem / runSem 决定。
  // 代价是「已花 + 在飞未结算」的总花费可能短暂超出 budget——这是有意识的取舍:budget 是防止
  // 无限烧钱的安全网,不是精确计费闸,不应该反过来限制吞吐。
  interface BudgetState {
    spent: number;
    /** 已经真正发起过 agent turn、但仍拿不到成本的 attempt 数。provider/setup 在 agent
     *  运行前失败不计入——这种结果没有可执行的计费事实,不能据此声称 adapter 不报成本。 */
    completedAgentRunsNoCost: number;
    unenforceableWarned: boolean;
    /** 因这个 budgetKey 预算到顶而未派发的 attempt 累计数——反馈层 "budget-exhausted" 事件
     *  (见 sink.ts 的 `BudgetExhaustedInput`)要求 emitter 自己维护这个累计值,reducer 不推导。 */
    unstartedCount: number;
  }
  const budgetStates = new Map<string, BudgetState>();
  const budgetState = (key: string): BudgetState => {
    let s = budgetStates.get(key);
    if (!s) {
      s = { spent: 0, completedAgentRunsNoCost: 0, unenforceableWarned: false, unstartedCount: 0 };
      budgetStates.set(key, s);
    }
    return s;
  };
  const budgetReported = new Set<string>();

  // reporter 的 onEvalComplete 要「每个 attempt 完成即时触发」(保流式输出),又不能让
  // 并发 worker 交错写 → 用一个 permit=1 的信号量串起来(替代原先手搓的 reportQueue 链)。
  const reportMutex = yield* Effect.makeSemaphore(1);
  // 沙箱启动单独限流:与 agent 并发(maxConcurrency)解耦,防高并发下 daemon/API 过载。
  // 未显式指定时跟 maxConcurrency 走——各 provider 的推荐值已在 cli 层写进 maxConcurrency 默认值。
  const sandboxSem = yield* Effect.makeSemaphore(opts.maxConcurrency);
  // 相同 provider physical identity 共享一个按需池；不从 AgentRun 重选 template。
  const reusePools = new Map<AgentRun, Map<string, ReusableSandboxPool>>();
  /** A terminal Experiment freezes its own registry before physical stop. */
  const frozenReusePoolRuns = new Set<AgentRun>();
  // A physical Sandbox number is Run-wide, not pool-local: distinct Eval
  // Groups may materialize identical provider plans concurrently and must not
  // both report `reuseSandbox: 1` for different instances.
  const reuseSandboxNumbers = new Map<AgentRun, number>();
  const nextReuseSandboxNumber = (run: AgentRun): number => {
    const next = (reuseSandboxNumbers.get(run) ?? 0) + 1;
    reuseSandboxNumbers.set(run, next);
    return next;
  };
  type ReusePoolSelection =
    | { readonly _tag: "Fresh" }
    | { readonly _tag: "Reuse"; readonly pool: ReusableSandboxPool };
  const reusePoolKeyOf = (a: Attempt): string | undefined => {
    return sandboxReusePoolDescriptor({
      run: a.run,
      evalId: a.evalDef.id,
      ...(a.evalDef.evalGroup === undefined ? {} : { evalGroupId: a.evalDef.evalGroup.id }),
      plan: a.plan,
    })?.key;
  };
  const acquiredReuseAttempts = new WeakSet<Attempt>();
  const authorizedReuseAttempts = new WeakSet<Attempt>();
  const cancelledReuseAttempts = new WeakSet<Attempt>();
  const existingReusePoolFor = (a: Attempt): ReusableSandboxPool | undefined => {
    const key = reusePoolKeyOf(a);
    return key === undefined ? undefined : reusePools.get(a.run)?.get(key);
  };
  const cancelReuseAttempt = (a: Attempt, force = false): boolean => {
    if ((!force && authorizedReuseAttempts.has(a)) || acquiredReuseAttempts.has(a) || cancelledReuseAttempts.has(a)) {
      return false;
    }
    cancelledReuseAttempts.add(a);
    return true;
  };
  const reusePoolFor = (a: Attempt): Effect.Effect<ReusePoolSelection, never, import("effect").Scope.Scope> => {
    const key = reusePoolKeyOf(a);
    if (key === undefined || a.plan._tag !== "Sandbox") {
      return Effect.succeed({ _tag: "Fresh" });
    }
    if (frozenReusePoolRuns.has(a.run)) {
      return Effect.die(new Error("Sandbox reuse registry was frozen before this Attempt could acquire a pool."));
    }
    let bySpec = reusePools.get(a.run);
    if (bySpec === undefined) {
      bySpec = new Map<string, ReusableSandboxPool>();
      reusePools.set(a.run, bySpec);
    }
    let pool = bySpec.get(key);
    if (!pool) {
      // 物理 Sandbox lifecycle 不属于任一 Attempt；反馈与事实落到所属 Experiment 的 Run。
      const experimentContext = makeExperimentHookContext(a.run, "sandbox.create");
      const setupContext = {
        ...experimentContext,
        ...(a.evalDef.evalGroup === undefined ? {} : { evalGroup: {
          id: a.evalDef.evalGroup.id,
          definitionHash: a.evalDef.evalGroup.definitionHash,
        } }),
      };
      const capacity = a.evalDef.evalGroup === undefined
        ? Math.max(1, Math.min(opts.maxConcurrency, a.run.maxConcurrency ?? opts.maxConcurrency))
        : 1;
      const materializationOwnerId = a.evalDef.evalGroup === undefined
        ? a.plan.pair.evalId
        : JSON.stringify(["eval-group", a.run.experimentId, a.evalDef.evalGroup.id]);
      const groupPluginContext: GroupPluginContext | undefined = a.evalDef.evalGroup === undefined
        ? undefined
        : {
            experimentId: a.run.experimentId,
            evalGroupId: a.evalDef.evalGroup.id,
            signal: setupContext.signal,
            progress: setupContext.progress,
            diagnostic: setupContext.diagnostic,
          };
      pool = new ReusableSandboxPool(a.plan, capacity, {
        progress: setupContext.progress,
        diagnostic: setupContext.diagnostic,
      }, setupContext, liveSandboxRuntimeServices, a.run.agent.kind === "sandbox" ? a.run.agent : undefined, runTiming, materializationOwnerId, () => nextReuseSandboxNumber(a.run),
      a.evalDef.evalGroup === undefined ? Object.freeze([]) : linkPluginLifecycles(a.evalDef.evalGroup.plugins ?? [], "group"),
      groupPluginContext);
      bySpec.set(key, pool);
      return pool.managed().pipe(Effect.map((managed) => ({ _tag: "Reuse", pool: managed }) as const));
    }
    return Effect.succeed({ _tag: "Reuse", pool });
  };

  /**
   * Pool ownership is Experiment-scoped, not Invocation-scoped. The last
   * Attempt settlement freezes this registry before stop starts, so no late
   * acquire can create another physical Sandbox between pool stop and the
   * Experiment hook's checkpoint/teardown work.
   */
  const freezeReusablePoolsForRun = (run: AgentRun): Effect.Effect<void> =>
    Effect.sync(() => {
      frozenReusePoolRuns.add(run);
    }).pipe(
      Effect.zipRight(Effect.forEach(
        [...(reusePools.get(run)?.values() ?? [])],
        (pool) => pool.freeze(),
        { concurrency: "unbounded", discard: true },
      )),
    );

  const stopReusablePoolsForRun = (run: AgentRun): Effect.Effect<void, unknown> => Effect.gen(function* () {
    const exits = yield* Effect.forEach(
      [...(reusePools.get(run)?.values() ?? [])],
      (pool) => Effect.exit(pool.stop()),
      { concurrency: "unbounded" },
    );
    const failures: unknown[] = [];
    for (const exit of exits) {
      if (Exit.isFailure(exit)) failures.push(Cause.squash(exit.cause));
    }
    if (failures.length > 0) {
      return yield* Effect.fail(new AggregateError(failures, "Sandbox reuse pool cleanup failed."));
    }
  });

  // 两级并发闸:全局(opts.maxConcurrency)+ 实验级(AgentRun.maxConcurrency,可选)。两者都只
  // 属于本 Invocation；跨 Invocation 的共享外部状态由 sharedState 租约另行保护，不能把
  // `maxConcurrency` 误当成跨进程临界区。
  const globalSem = yield* Effect.makeSemaphore(opts.maxConcurrency);
  // 实验闸是 Invocation 内信号量：同实验的 attempt 即时交接 permit，同批其它实验不受影响。
  const gateLocalSems = new Map<AgentRun, Effect.Semaphore>();
  for (const run of effectiveAgentRuns) {
    if (run.maxConcurrency !== undefined) {
      gateLocalSems.set(
        run,
        yield* Effect.makeSemaphore(Math.max(1, run.maxConcurrency)),
      );
    }
  }

  // provider 级独占串行闸(见 docs/runner.md「调度:有界并发」):声明了 exclusive 的 provider
  // 按 provider 名共享一把 permit=1 的信号量,
  // --max-concurrency / 实验级 maxConcurrency 都不解除。核心不认 provider 名分支:这里只读
  // physical plan 的中性 admission/lane 字段；相同 lane 共用一把锁，表示它们竞争同一份
  // 不可并发底层资源。
  const providerExclusiveSems = new Map<string, Effect.Semaphore>();
  for (const attempt of attempts) {
    if (
      attempt.plan._tag === "Direct" ||
      attempt.plan.providerPlan.scheduling.admission._tag !== "Exclusive"
    ) {
      continue;
    }
    const laneKey = attempt.plan.providerPlan.scheduling.lane.key;
    if (!providerExclusiveSems.has(laneKey)) {
      providerExclusiveSems.set(laneKey, yield* Effect.makeSemaphore(1));
    }
  }
  let exclusiveConcurrencyWarned = false;
  const exclusiveSemFor = (plan: Attempt["plan"]): Effect.Semaphore | undefined => {
    if (plan._tag === "Direct" || plan.providerPlan.scheduling.admission._tag !== "Exclusive") return undefined;
    const laneKey = plan.providerPlan.scheduling.lane.key;
    const sem = providerExclusiveSems.get(laneKey);
    if (sem === undefined) {
      throw new Error(`Missing provider-exclusive semaphore for ${laneKey}`);
    }
    // 如实标注串行事实(一次性,不管命中多少条 attempt):全局上限比 1 高时,这个 provider 的
    // attempt 实际仍然一个一个跑——不管 --max-concurrency 写了多少,这是正确性约束不是调度旋钮。
    if (opts.maxConcurrency > 1 && !exclusiveConcurrencyWarned) {
      exclusiveConcurrencyWarned = true;
      reportDiagnostic({
        key: `provider-exclusive-serial:${laneKey}`,
        code: "provider-exclusive-serial",
        severity: "warning",
        message: t("runner.providerExclusiveSerial", {
          provider: plan.providerPlan.provider,
          concurrency: opts.maxConcurrency,
        }).trimEnd(),
        data: { provider: plan.providerPlan.provider, concurrency: opts.maxConcurrency },
      });
    }
    return sem;
  };

  // 实验级生命周期(见 docs/feature/experiments/architecture.md「实验级生命周期」):
  // setup 整场至多一次——第一个通过派发许可(preflight)的 attempt 触发,后续 attempt 等同一个
  // memoized Effect completion;等待发生在 gated 里、globalSem 之外,不占全局并发位。teardown 是
  // ExperimentDef.teardown 字段,在最后一个 attempt 收尾后执行,当且仅当 setup 时点走到过
  // ——setup 抛错不豁免,未声明 setup 不影响触发。pendingAttempts 按 Attempt 身份结算并挂在
  // Effect.ensuring 上,中断路径同样移除;重复结算不会像数字计数那样下溢。
  type ExperimentSetupOutcome =
    | { readonly _tag: "Succeeded" }
    | { readonly _tag: "Failed"; readonly error: AttemptError };

  type ExperimentSetup =
    | { readonly _tag: "InProgress"; readonly completion: Deferred.Deferred<void, unknown> }
    | ExperimentSetupOutcome;

  /**
   * 生命周期是一条闭合状态链，而不是 optional Promise、boolean 与计数器的笛卡尔积：
   *
   * Dormant → Active(setup 进行中/成功/失败) → TearingDown → TornDown
   *        ↘ UntriggeredComplete（所有 attempt 都在触发点前结算）
   *
   * TearingDown/TornDown 仍携带 setup 与 pendingAttempts，因为强清 drain 可以在 setup 或
   * attempt 尚在飞时先取得收尾执行权；后续 attempt 恢复时仍须读到 setup 的失败结果。
   */
  type ExperimentLifecycle =
    | { readonly _tag: "Dormant"; readonly pendingAttempts: ReadonlySet<Attempt> }
    | {
        readonly _tag: "Active";
        readonly pendingAttempts: ReadonlySet<Attempt>;
        readonly setup: ExperimentSetup;
      }
    | {
        readonly _tag: "TearingDown";
        readonly pendingAttempts: ReadonlySet<Attempt>;
        readonly setup: ExperimentSetup;
        readonly completion: Deferred.Deferred<void, unknown>;
      }
    | {
        readonly _tag: "TornDown";
        readonly pendingAttempts: ReadonlySet<Attempt>;
        readonly setup: ExperimentSetupOutcome;
      }
    | { readonly _tag: "UntriggeredComplete" };

  interface ExperimentLifecycleCell {
    state: ExperimentLifecycle;
    readonly mutex: Effect.Semaphore;
    /**
     * Attempt cleanup is occurrence-owned, but its terminal outcome belongs to
     * this Experiment whenever it owns sharedState. Keep a monotonic ledger
     * until the Experiment makes its one lease-release decision.
     */
    readonly sandboxCleanupFailures: SandboxCleanupFailure[];
    sharedStateClaim?: SharedStateLeaseEffectClaim;
  }
  const expLifecycles = new Map<AgentRun, ExperimentLifecycleCell>();
  for (const a of attempts) {
    if (!a.run.setup && !a.run.teardown && !a.run.sharedState) continue;
    const cell = expLifecycles.get(a.run);
    if (cell) {
      if (cell.state._tag !== "Dormant") throw new Error("Experiment lifecycle initialized after dispatch.");
      cell.state = { _tag: "Dormant", pendingAttempts: new Set([...cell.state.pendingAttempts, a]) };
    } else {
      expLifecycles.set(a.run, {
        state: { _tag: "Dormant", pendingAttempts: new Set([a]) },
        mutex: yield* Effect.makeSemaphore(1),
        sandboxCleanupFailures: [],
      });
    }
  }

  const recordSandboxCleanupFailure = (
    run: AgentRun,
    failure: SandboxCleanupFailure,
  ): void => {
    if (run.sharedState === undefined) return;
    const cell = expLifecycles.get(run);
    if (cell === undefined) return;
    cell.sandboxCleanupFailures.push(failure);
  };

  // 实验域诊断累积器(docs/runner.md「实验域诊断持久化」):只接无法归属单 Attempt 的实验
  // 事实——ctx.diagnostic、teardown failed/late、budget-unenforceable。相同 dedupeKey 只在
  // 同一个 experimentId 桶内折叠 count;不同 Experiment 各自独立累计,不跨来源合并。裸 run
  // (没有 experimentId)没有 Run 可挂,直接丢弃不进这个累积器——只留 reportDiagnostic
  // 的运行期反馈。与之配套的收尾时刻(捕捉每个 Experiment 真正完成的那一刻,不是整个
  // Invocation 收尾的那一刻,才诚实)。
  const experimentDiagnostics = new Map<string, DiagnosticRecord[]>();
  const experimentDedupeIndex = new Map<string, Map<string, DiagnosticRecord>>();
  const experimentCompletedAt = new Map<string, string>();
  const recordExperimentDiagnostic = (input: {
    experimentId: string | undefined;
    code: string;
    level: "warning" | "error";
    message: string;
    phase: LifecyclePhase;
    data?: Readonly<globalThis.Record<string, JsonValue>>;
    command?: string;
    dedupeKey?: string;
  }): void => {
    if (!input.experimentId) return;
    const dedupeIndex = experimentDedupeIndex.get(input.experimentId) ?? new Map<string, DiagnosticRecord>();
    experimentDedupeIndex.set(input.experimentId, dedupeIndex);
    if (input.dedupeKey !== undefined) {
      const existing = dedupeIndex.get(input.dedupeKey);
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
        // 同一运行级事实会随着未派发槽位增加而得到更精确的上下文。反馈 reducer
        // 已经采用最新 data；持久 Run 诊断也必须同样更新，不能把最初的 0 永久写死。
        if (input.data !== undefined || input.command !== undefined) {
          existing.context = {
            ...(input.data ?? {}),
            ...(input.command !== undefined ? { command: input.command } : {}),
          };
        }
        return;
      }
    }
    const record: DiagnosticRecord = {
      code: input.code,
      level: input.level,
      detail: input.message,
      origin: attemptOrigin(input.phase),
      ...(input.data !== undefined || input.command !== undefined
        ? {
            context: {
              ...(input.data ?? {}),
              ...(input.command !== undefined ? { command: input.command } : {}),
            },
          }
        : {}),
    };
    if (input.dedupeKey !== undefined) dedupeIndex.set(input.dedupeKey, record);
    const list = experimentDiagnostics.get(input.experimentId) ?? [];
    list.push(record);
    experimentDiagnostics.set(input.experimentId, list);
  };
  /**
   * Owner tokens are an explicit inspection capability, not ordinary Runner
   * feedback. Keep both the live feedback event and the durable Run diagnostic
   * limited to the key and recovery obligation; `exp --teardown` is the only
   * public surface that renders immutable owner evidence.
   */
  const reportSharedStateRecoveryRequired = (input: {
    readonly run: AgentRun;
    readonly experimentId: string;
    readonly reason: string;
    readonly phase: LifecyclePhase;
  }): void => {
    const key = input.run.sharedState?.key ?? "";
    const message = t("runner.sharedStateRecoveryRequired", { key }).trimEnd();
    reportDiagnostic({
      key: `state-lease-recovery-required:${key || input.experimentId}`,
      code: "state-lease-recovery-required",
      severity: "warning",
      message,
      data: {
        experimentId: input.experimentId,
        sharedStateKey: key,
        reason: input.reason,
      },
    });
    recordExperimentDiagnostic({
      experimentId: input.run.experimentId,
      code: "state-lease-recovery-required",
      level: "warning",
      message,
      phase: input.phase,
      data: { sharedStateKey: key, reason: input.reason },
    });
  };
  /**
   * A blocked sharedState acquisition is normal contention. It is deliberately
   * an info notice and deliberately does not enter a Run's durable diagnostic
   * list: there is no cleanup obligation and no owner evidence to expose.
   */
  const acquireSharedStateClaim = (
    run: AgentRun,
    experimentId: string,
  ): Effect.Effect<SharedStateLeaseEffectClaim, unknown> => Effect.gen(function* () {
    const sharedState = run.sharedState;
    if (sharedState === undefined) {
      return yield* Effect.die(new Error("Attempted to acquire an undeclared sharedState lease."));
    }
    const processIdentity = sharedStateProcessIdentity ?? (yield* currentProcessIdentityEffect());
    sharedStateProcessIdentity = processIdentity;
    const acquired = yield* acquireSharedStateLeaseEffect(
      coordinationRoot,
      sharedState.key,
      {
        experimentId,
        pid: process.pid,
        host: currentHost,
        processIdentity,
      },
      {
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
        onWaitStart: () => {
          const message = t("runner.sharedStateWaiting", { key: sharedState.key }).trimEnd();
          reportDiagnostic({
            key: `state-lease-waiting:${sharedState.key}`,
            code: "state-lease-waiting",
            severity: "info",
            message,
            data: { experimentId, sharedStateKey: sharedState.key },
          });
        },
      },
    );
    return acquired.claim;
  });
  // 强杀后的收尾兜底(docs/feature/experiments/architecture.md「强杀后的收尾兜底」)的磁盘登记
  // 挂在本地协调根下,与留存注册表 `.niceeval/sandboxes/` 同一个根（默认 cwd/.niceeval，
  // 与 attempt.ts 的 `coordinationRoot` 兜底同一口径）。
  const currentHost = hostname();
  // Establish process identity lazily: only a configured sharedState opts in
  // to this fail-closed cross-process coordination requirement.
  let sharedStateProcessIdentity: string | undefined;
  const makeExperimentHookContext = (run: AgentRun, phase: LifecyclePhase): ExperimentHookContext => {
    const experimentId = run.experimentId;
    return {
      experimentId: run.experimentId,
      selectedEvalIds: run.selectedEvalIds,
      signal: opts.signal ?? new AbortController().signal,
      // progress 是短命状态:只更新本实验运行级行的 detail,不属于任何 attempt 的 active 条目。
      progress: (u) => {
        const suffix = u.current !== undefined && u.total !== undefined ? ` (${u.current}/${u.total})` : "";
        reportExperimentProgress({ experimentId, detail: `${u.message}${suffix}` });
      },
      // diagnostic 双落:运行级永久事件流（human/json 都有即时反馈）+ 实验域诊断累积器
      // (持久化,该 Experiment 的 Run 封口时一次写入)——两条通路相互独立,互不派生
      // (docs/runner.md「实验域诊断持久化」)。实验级钩子的事实不属于任何单个 Attempt,不落
      // result.json。
      diagnostic: (input) => {
        reportDiagnostic({
          key: input.dedupeKey ?? `${input.code}:experiment:${experimentId}`,
          code: input.code,
          severity: input.level,
          message: input.message,
          data: { experimentId, ...(input.data ?? {}) },
        });
        recordExperimentDiagnostic({
          experimentId: run.experimentId,
          code: input.code,
          level: input.level,
          message: input.message,
          phase,
          ...(input.data !== undefined ? { data: input.data } : {}),
          ...(input.dedupeKey !== undefined ? { dedupeKey: input.dedupeKey } : {}),
        });
      },
    };
  };
  const replaceSetup = (
    cell: ExperimentLifecycleCell,
    setup: ExperimentSetupOutcome,
  ): Effect.Effect<void> => cell.mutex.withPermits(1)(Effect.sync(() => {
    const state = cell.state;
    if (state._tag === "Active" || state._tag === "TearingDown") {
      cell.state = { ...state, setup };
    }
  }));
  const awaitSetup = (setup: ExperimentSetup): Effect.Effect<void, unknown> =>
    setup._tag === "InProgress" ? Deferred.await(setup.completion) : Effect.void;
  const setupOutcomeOf = (setup: ExperimentSetup): ExperimentSetupOutcome => {
    if (setup._tag !== "InProgress") return setup;
    throw new Error("Experiment setup completed without recording its terminal outcome.");
  };
  const releaseSharedStateLease = (
    run: AgentRun,
    cell: ExperimentLifecycleCell,
    cleanupSucceeded: () => boolean,
  ): Effect.Effect<void> => Effect.suspend(() => {
    const claim = cell.sharedStateClaim;
    return Effect.sync(() => claim).pipe(
      Effect.flatMap((heldClaim) => {
        const claim = heldClaim;
        if (claim === undefined) return Effect.void;
        const experimentId = run.experimentId ?? run.agent.name;
        const recoveryRequired = (reason: string): Effect.Effect<void> => Effect.sync(() => {
          reportSharedStateRecoveryRequired({
            run,
            experimentId,
            reason,
            phase: "experiment.teardown",
          });
        });
        if (!cleanupSucceeded()) {
          // A retained lease is a durable recovery obligation, not a reason
          // to leave a daemon heartbeat/timer behind after this Invocation.
          // `abandon` cannot delete or rewrite the record.
          cell.sharedStateClaim = undefined;
          return claim.abandon.pipe(
            Effect.catchAll(() => Effect.void),
            Effect.zipRight(recoveryRequired("cleanup-failed")),
          );
        }
        // Once release starts its heartbeat is interrupted. Do not retain a
        // stale in-memory claim after a failed compare-owner mutation; its
        // durable record is deliberately left for explicit recovery.
        cell.sharedStateClaim = undefined;
        return claim.release.pipe(Effect.catchAll(() => recoveryRequired("release-failed")));
      }),
    );
  });
  const runExperimentTeardown = (
    run: AgentRun,
    cell: ExperimentLifecycleCell,
  ): Effect.Effect<void, unknown> => Effect.uninterruptibleMask((restore) =>
    cell.mutex.withPermits(1)(Effect.gen(function* () {
      const current = cell.state;
      // setup 时点没走到就没有收尾义务；已完成与在飞状态分别复用自己的确定 Effect。
      if (current._tag === "Dormant" || current._tag === "UntriggeredComplete" || current._tag === "TornDown") {
        return undefined;
      }
      if (current._tag === "TearingDown") return current.completion;

      // 正常路径、强清 drain 与崩溃路径共同把 Active 原子转成 TearingDown；后到者只 await
      // 同一个 Deferred，因此不双跑、也不空转。
      const completion = yield* Deferred.make<void, unknown>();
      const experimentId = run.experimentId ?? run.agent.name;
      cell.state = {
        _tag: "TearingDown",
        pendingAttempts: current.pendingAttempts,
        setup: current.setup,
        completion,
      };
      let cleanupSucceeded = true;
      const teardown = Effect.gen(function* () {
        // A failed setup still has teardown obligations. Capture its outcome
        // rather than short-circuiting the physical pool/provider cleanup.
        yield* Effect.exit(awaitSetup(current.setup));

        // Last Attempt settle -> freeze registry -> stop every reusable pool
        // (Sandbox lifecycle teardown + provider finalizer) -> author hook.
        // Stop failures are recorded but never skip later cleanup.
        const pools = yield* Effect.exit(
          freezeReusablePoolsForRun(run).pipe(Effect.zipRight(stopReusablePoolsForRun(run))),
        );
        if (Exit.isFailure(pools)) {
          cleanupSucceeded = false;
          const message = `Sandbox reuse cleanup failed before Experiment teardown: ${String(Cause.squash(pools.cause))}`;
          reportDiagnostic({
            key: `sandbox-reuse-cleanup-failed:${experimentId}`,
            code: "sandbox-reuse-cleanup-failed",
            severity: "warning",
            message,
            data: { experimentId },
          });
          recordExperimentDiagnostic({
            experimentId: run.experimentId,
            code: "sandbox-reuse-cleanup-failed",
            level: "warning",
            message,
            phase: "experiment.teardown",
          });
        }

        // Attempt cleanup has reached a real terminal state by the time the
        // final Attempt settles. The Attempt keeps cleanup failures diagnostic-
        // only so later finalizers run, therefore this Experiment ledger owns
        // the sharedState release decision.
        if (cell.sandboxCleanupFailures.length > 0) {
          cleanupSucceeded = false;
          const details = cell.sandboxCleanupFailures
            .map((failure) => `${failure.stage}: ${failure.error.message}`)
            .join("; ");
          const message = `Sandbox cleanup failed before Experiment teardown: ${details}`;
          reportDiagnostic({
            key: `sandbox-cleanup-failed:${experimentId}`,
            code: "sandbox-cleanup-failed",
            severity: "warning",
            message,
            data: { experimentId, failureCount: cell.sandboxCleanupFailures.length },
          });
          recordExperimentDiagnostic({
            experimentId: run.experimentId,
            code: "sandbox-cleanup-failed",
            level: "warning",
            message,
            phase: "experiment.teardown",
          });
        }

        if (run.teardown) {
          reportExperimentHook({ experimentId, hook: "teardown", status: "started" });
          const startedAt = Date.now();
          const ctx = makeExperimentHookContext(run, "experiment.teardown");
          yield* cleanupCallback(() => run.teardown!(ctx)).pipe(Effect.matchEffect({
            onSuccess: () => Effect.sync(() => {
              reportExperimentHook({
                experimentId,
                hook: "teardown",
                status: "done",
                durationMs: Date.now() - startedAt,
              });
            }),
            onFailure: (error) => Effect.sync(() => {
              cleanupSucceeded = false;
              reportExperimentHook({
                experimentId,
                hook: "teardown",
                status: "failed",
                durationMs: Date.now() - startedAt,
              });
              // Teardown failure never skips subsequent release handling, but
              // it makes automatic lease release unsafe.
              const message = t("runner.experimentTeardownFailed", {
                experimentId,
                message: error instanceof Error ? error.message : String(error),
              }).trimEnd();
              reportDiagnostic({
                key: `experiment-teardown-failed:${experimentId}`,
                code: "experiment-teardown-failed",
                severity: "warning",
                message,
                data: { experimentId },
              });
              recordExperimentDiagnostic({
                experimentId: run.experimentId,
                code: "experiment-teardown-failed",
                level: "warning",
                message,
                phase: "experiment.teardown",
              });
            }),
          }));
        }
        // This Experiment has reached its terminal cleanup point whether its
        // individual cleanup steps succeeded or failed.
        experimentCompletedAt.set(experimentId, new Date().toISOString());
      }).pipe(
        Effect.ensuring(
          cell.mutex.withPermits(1)(Effect.gen(function* () {
            const state = cell.state;
            const pendingAttempts = state._tag === "TearingDown"
              ? state.pendingAttempts
              : current.pendingAttempts;
            const setup = state._tag === "TearingDown" ? state.setup : current.setup;
            cell.state = { _tag: "TornDown", pendingAttempts, setup: setupOutcomeOf(setup) };
            // settle 后才注销：drain 在执行体在飞时仍能看见本项。
            yield* unregisterExperimentTeardown(experimentId);
            if (run.experimentId) {
              yield* removeTeardownRegistrationIfPresentEffect(
                coordinationRoot,
                teardownEntryId(run.experimentId, process.pid),
              ).pipe(Effect.ignore);
            }
          })),
        ),
        // Include both the cleanup body and its lifecycle-registration
        // finalizer in this decision. A failure while unregistering the
        // teardown ownership is still an incomplete cleanup and must retain
        // the sharedState lease; release itself remains outside this check.
        Effect.onExit((exit) => Exit.isFailure(exit)
          ? Effect.sync(() => {
              cleanupSucceeded = false;
            })
          : Effect.void),
        // Lease release happens only when all prior cleanup was successful.
        // Otherwise the durable owner token remains for the public explicit
        // recovery command; the CLI exit sweep is not allowed to erase it.
        // Read `cleanupSucceeded` only when this finalizer executes. Passing
        // its current boolean while constructing the pipeline would capture
        // the initial `true` and could release after a later teardown failure.
        Effect.ensuring(Effect.suspend(() => releaseSharedStateLease(run, cell, () => cleanupSucceeded))),
      );
      // The initiating waiter may be interrupted, but the one published
      // cleanup fiber must still advance through every later cleanup stage.
      // `cleanupCallback` remains explicitly interruptible for its own
      // bounded timeout; this mask only prevents a caller's cancellation from
      // skipping pool stop or Experiment teardown entirely.
      const settle = Effect.exit(Effect.uninterruptible(teardown)).pipe(
        Effect.flatMap((exit) => Deferred.done(completion, exit)),
        Effect.asVoid,
      );
      yield* settle.pipe(Effect.forkIn(invocationScope));
      return completion;
    })).pipe(
      Effect.flatMap((completion) => completion === undefined ? Effect.void : restore(Deferred.await(completion))),
    ),
  );
  /**
   * 启动自愈:本实验触发 setup 之前,先核对磁盘上是否有它自己的遗留登记——上一次运行同一
   * experimentId 被强杀、来不及删除。同宿主且 pid 已死才是遗留义务;pid 活或异宿主可能是
   * 并发 run,不触碰。sharedState caller 必须已先取得同 key exact authority；再原子删登记拿到执行权,
   * 再补执行一次它的 teardown(新进程语义:
   * ctx.selectedEvalIds 从登记恢复,不依赖已丢失的 setup 产物)。失败只记诊断,不阻断、
   * 不重试本次 run 的调度——recovery 补偿的是上一次的泄漏,不是这一次的前提条件。
   */
  const recoverOrphanedTeardownRegistration = (
    run: AgentRun,
    experimentId: string,
  ): Effect.Effect<void, unknown> => Effect.suspend(() => {
    if (!run.experimentId || !run.teardown) return Effect.void;
    return Effect.gen(function* () {
      const registrations = yield* readTeardownRegistrationsEffect(coordinationRoot).pipe(
        Effect.catchAll(() => Effect.succeed([])),
      );
      for (const { id, entry } of registrations) {
        if (entry.experimentId !== run.experimentId || !isOrphanedTeardownRegistration(entry, currentHost)) continue;
        const claimed = yield* removeTeardownRegistrationIfPresentEffect(coordinationRoot, id).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        );
        if (!claimed) continue; // 已被另一个进程抢先删除，义务已被别处接手。
        reportExperimentHook({ experimentId, hook: "teardown", status: "started", recovery: true });
        const startedAt = Date.now();
        const recoveryCtx: ExperimentHookContext = {
          experimentId,
          selectedEvalIds: entry.selectedEvalIds,
          signal: opts.signal ?? new AbortController().signal,
          progress: (u) => {
            const suffix = u.current !== undefined && u.total !== undefined ? ` (${u.current}/${u.total})` : "";
            reportExperimentProgress({ experimentId, detail: `${u.message}${suffix}` });
          },
          diagnostic: (input) => {
            reportDiagnostic({
              key: input.dedupeKey ?? `${input.code}:experiment:${experimentId}`,
              code: input.code,
              severity: input.level,
              message: input.message,
              data: { experimentId, ...(input.data ?? {}) },
            });
            recordExperimentDiagnostic({
              experimentId: run.experimentId,
              code: input.code,
              level: input.level,
              message: input.message,
              phase: "experiment.teardown",
              ...(input.data !== undefined ? { data: input.data } : {}),
              ...(input.dedupeKey !== undefined ? { dedupeKey: input.dedupeKey } : {}),
            });
          },
        };
        yield* cleanupCallback(() => run.teardown!(recoveryCtx)).pipe(Effect.matchEffect({
          onSuccess: () => Effect.sync(() => {
            reportExperimentHook({
              experimentId,
              hook: "teardown",
              status: "done",
              durationMs: Date.now() - startedAt,
              recovery: true,
            });
          }),
          onFailure: (error) => Effect.sync(() => {
            reportExperimentHook({
              experimentId,
              hook: "teardown",
              status: "failed",
              durationMs: Date.now() - startedAt,
              recovery: true,
            });
            const message = t("runner.experimentTeardownFailed", {
              experimentId,
              message: error instanceof Error ? error.message : String(error),
            }).trimEnd();
            reportDiagnostic({
              key: `experiment-teardown-failed:${experimentId}`,
              code: "experiment-teardown-failed",
              severity: "warning",
              message,
              data: { experimentId },
            });
            recordExperimentDiagnostic({
              experimentId: run.experimentId,
              code: "experiment-teardown-failed",
              level: "warning",
              message,
              phase: "experiment.teardown",
            });
          }),
        }));
      }
    });
  });
  // Startup recovery can exist even when every Attempt is carried (or there
  // are no selected Attempts), so it cannot borrow an ExperimentLifecycleCell.
  // Each selected run instead gets an independent completion gate; the first
  // real setup awaits the same gate before it can claim or initialize state.
  const startupRecoveryCompletions = new Map<AgentRun, Deferred.Deferred<void, unknown>>();
  const startupRecoveryCompletionsToAwait: Deferred.Deferred<void, unknown>[] = [];
  const ensureExperimentSetup = (a: Attempt): Effect.Effect<void, unknown> => {
    const cell = expLifecycles.get(a.run)!;
    return Effect.uninterruptibleMask((restore) => {
      const startupRecovery = startupRecoveryCompletions.get(a.run);
      return (startupRecovery === undefined ? Effect.void : restore(Deferred.await(startupRecovery))).pipe(
        Effect.zipRight(cell.mutex.withPermits(1)(Effect.gen(function* () {
        const current = cell.state;
        if (current._tag === "Active" || current._tag === "TearingDown") return current.setup;
        if (current._tag === "TornDown") return undefined;
        if (current._tag === "UntriggeredComplete") {
          return yield* Effect.die(new Error("Experiment lifecycle cannot be triggered after all attempts settled."));
        }

        const run = a.run;
        const experimentId = run.experimentId ?? run.agent.name;
        if (run.sharedState && cell.sharedStateClaim === undefined) {
          cell.sharedStateClaim = yield* restore(acquireSharedStateClaim(run, experimentId));
        }
        const completion = yield* Deferred.make<void, unknown>();
        // 先写 Active、再登记和启动 worker：随后任何 attempt 或强清都会复用同一个 Effect 完成点。
        cell.state = {
          _tag: "Active",
          pendingAttempts: current.pendingAttempts,
          setup: { _tag: "InProgress", completion },
        };
        if (run.teardown || run.sharedState) {
          yield* registerExperimentTeardown(experimentId, () => runExperimentTeardown(run, cell));
        }
        let setupStartedAt: number | undefined;
        const setupBody = Effect.gen(function* () {
          // startup gate 已补做已有遗留收尾；sharedState 时此处已经持有同 key exact authority。
          // 再核对一次可覆盖 gate 之后才出现的孤儿登记，随后原子写入本次登记；两步都先于 setup。
          if (run.teardown && run.experimentId) {
            yield* recoverOrphanedTeardownRegistration(run, experimentId);
            yield* writeTeardownRegistrationEffect(coordinationRoot, {
              experimentId: run.experimentId,
              selectedEvalIds: run.selectedEvalIds,
              pid: process.pid,
              host: currentHost,
              startedAt: new Date().toISOString(),
            }).pipe(Effect.catchAll((error) => Effect.sync(() => {
              const message = t("runner.teardownRegistrationWriteFailed", {
                experimentId,
                message: error instanceof Error ? error.message : String(error),
              }).trimEnd();
              reportDiagnostic({
                key: `teardown-registration-write-failed:${experimentId}`,
                code: "teardown-registration-write-failed",
                severity: "warning",
                message,
                data: { experimentId },
              });
              recordExperimentDiagnostic({
                experimentId: run.experimentId,
                code: "teardown-registration-write-failed",
                level: "warning",
                message,
                phase: "experiment.setup",
              });
            })));
          }
          if (!run.setup) return;
          setupStartedAt = Date.now();
          reportExperimentHook({ experimentId, hook: "setup", status: "started" });
          const ctx = makeExperimentHookContext(run, "experiment.setup");
          const value = yield* Effect.tryPromise({
            try: () => Promise.resolve().then(() => run.setup!(ctx)),
            catch: (error) => error,
          });
          const returned = value as unknown;
          if (typeof returned === "function") {
            // tsx 旧式 setup cleanup 只在 author callback 边界适配；主错误说明迁移方向。
            yield* cleanupCallback(returned as () => unknown).pipe(Effect.catchAll(() => Effect.void));
            return yield* Effect.fail(new Error(
              t("runner.setupReturnedCleanup", {
                layer: `ExperimentDef.setup (${experimentId})`,
                hint: "ExperimentDef.teardown",
              }).trimEnd(),
            ));
          }
          reportExperimentHook({
            experimentId,
            hook: "setup",
            status: "done",
            durationMs: Date.now() - (setupStartedAt ?? Date.now()),
          });
        });
        const setupWorker = setupBody.pipe(
          Effect.matchEffect({
            onSuccess: () => replaceSetup(cell, { _tag: "Succeeded" }),
            onFailure: (error) => Effect.sync(() => {
              reportExperimentHook({
                experimentId,
                hook: "setup",
                status: "failed",
                durationMs: Date.now() - (setupStartedAt ?? Date.now()),
              });
            }).pipe(Effect.zipRight(replaceSetup(cell, {
              _tag: "Failed",
              error: { ...errorFromThrown(error, "experiment.setup"), code: "experiment-setup-failed" },
            }))),
          }),
          Effect.onExit((exit) => {
            const recordUnexpectedExit = Exit.isFailure(exit)
              ? replaceSetup(cell, {
                  _tag: "Failed",
                  error: {
                    ...errorFromThrown(Cause.squash(exit.cause), "experiment.setup"),
                    code: "experiment-setup-failed",
                  },
                })
              : Effect.void;
            return recordUnexpectedExit.pipe(
              Effect.zipRight(Deferred.done(completion, exit)),
              Effect.asVoid,
            );
          }),
        );
        yield* restore(setupWorker).pipe(Effect.forkIn(invocationScope));
        return cell.state.setup;
        })).pipe(
          Effect.flatMap((setup) => setup === undefined ? Effect.void : restore(awaitSetup(setup))),
        )),
      );
    });
  };

  const hasOrphanedTeardownRegistration = (run: AgentRun): Effect.Effect<boolean, never> => Effect.suspend(() => {
    if (!run.experimentId || !run.teardown) return Effect.succeed(false);
    return readTeardownRegistrationsEffect(coordinationRoot).pipe(
      Effect.map((registrations) => registrations.some(({ entry }) =>
        entry.experimentId === run.experimentId && isOrphanedTeardownRegistration(entry, currentHost))),
      // A missing or unreadable registration directory must never invent an
      // orphan cleanup obligation. The normal setup path still records a
      // diagnostic if it cannot write this Invocation's own registration.
      Effect.catchAll(() => Effect.succeed(false)),
    );
  });
  /**
   * Startup self-heal remains a selected-Experiment responsibility even for a
   * full-carry / zero-Attempt Invocation. For sharedState it first obtains the
   * exact current key's authority. Thus an active or recovering generation is
   * waited on, never implicitly torn down or replaced.
   */
  const recoverStartupOrphanedTeardown = (
    run: AgentRun,
    experimentId: string,
  ): Effect.Effect<void, unknown> => Effect.gen(function* () {
    if (!(yield* hasOrphanedTeardownRegistration(run))) return;
    if (run.sharedState === undefined) {
      yield* recoverOrphanedTeardownRegistration(run, experimentId);
      return;
    }
    const claim = yield* acquireSharedStateClaim(run, experimentId);
    yield* recoverOrphanedTeardownRegistration(run, experimentId).pipe(
      Effect.ensuring(claim.release.pipe(Effect.catchAll(() => Effect.sync(() => {
        reportSharedStateRecoveryRequired({
          run,
          experimentId,
          reason: "startup-recovery-release-failed",
          phase: "experiment.teardown",
        });
      }))),
      ),
    );
  });
  const startupRecoveryByExperimentId = new Map<string, Deferred.Deferred<void, unknown>>();
  for (const run of effectiveAgentRuns) {
    if (!run.experimentId || !run.teardown) continue;
    let completion = startupRecoveryByExperimentId.get(run.experimentId);
    if (completion === undefined) {
      const createdCompletion = yield* Deferred.make<void, unknown>();
      completion = createdCompletion;
      startupRecoveryByExperimentId.set(run.experimentId, createdCompletion);
      startupRecoveryCompletionsToAwait.push(createdCompletion);
      const recovery = recoverStartupOrphanedTeardown(run, run.experimentId).pipe(
        Effect.exit,
        Effect.flatMap((exit) => Deferred.done(createdCompletion, exit)),
        Effect.asVoid,
      );
      yield* recovery.pipe(Effect.forkIn(invocationScope));
    }
    startupRecoveryCompletions.set(run, completion);
  }

  const settleExperimentAttempt = (a: Attempt): Effect.Effect<void, unknown> => {
    const cell = expLifecycles.get(a.run)!;
    return cell.mutex.withPermits(1)(Effect.sync(() => {
      const state = cell.state;
      if (state._tag === "UntriggeredComplete") return false;
      const pendingAttempts = new Set(state.pendingAttempts);
      pendingAttempts.delete(a);
      if (state._tag === "Dormant") {
        cell.state = pendingAttempts.size === 0
          ? { _tag: "UntriggeredComplete" }
          : { _tag: "Dormant", pendingAttempts };
        return false;
      }
      if (state._tag === "Active") {
        cell.state = { ...state, pendingAttempts };
        return pendingAttempts.size === 0;
      }
      cell.state = { ...state, pendingAttempts };
      return false;
    })).pipe(
      Effect.flatMap((startTeardown) => startTeardown ? runExperimentTeardown(a.run, cell) : Effect.void),
    );
  };

  // ─────────────────────── 派发许可链(docs/runner.md「调度:有界并发」) ───────────────────────
  // 一条 attempt 要真正开跑,顺序通过四道许可,顺序本身是契约:
  //   ① 止损闸(checkDispatchHalt)→ ② 实验闸(跨 Invocation 逐槽租约)→ ③ 全局并发位
  //   → ④ 派发时刻非阻塞试锁(用例锁)→ preflight → body
  // ②③ 是资源许可,④ 是「这条用例归谁跑」的仲裁。撞上别人持有的新鲜锁时,④ 立刻把 ③ 和 ②
  // 都还回去(不还就会拿着实验闸名额干等持锁方——同一实验的名额域跨 Invocation 共用,
  // maxConcurrency: 1 下这是必然死锁),该用例转 elsewhere 挂起,腾出的位子由排队中的下一条
  // attempt 接手;锁释放/过期后重查携带,仍要自跑的那些从 ① 重新走一遍这条链。

  /**
   * 一把止损闸(docs/feature/error-classification/architecture.md「止损执行体」)。粒度两级:
   * 每个 experiment 一把实验闸,每个 (experiment, eval) 一把 eval 闸;实验闸落下**蕴含**该实验
   * 全部 eval 闸——检查点同时读两把,不做物理级联(eval 闸的数量随选择集变化,级联要遍历,
   * 蕴含只要多读一个字段)。
   *
   * 两个状态载体各有不可替代的角色,不是同一件事的两份副本:
   * - `latch`:`Effect.unsafeMakeLatch(false)`,落闸 = `unsafeOpen()`。`open` 幂等且不可回退,
   *   「落闸幂等、invocation 内不可逆」因此是结构保证而不是调用方自律;`latch.await` 同时是
   *   「等到这把闸落下」的 Effect,给等在全局并发位上的 fiber 当中止信号(见 withGlobalSlot)。
   * - `halted`:同步读的镜像。派发检查点在每轮循环开头问一次,不能为此付一次 await
   *   (`Effect.Latch` 没有同步状态读)。恒在 `unsafeOpen()` 之前置位,两者不会互相领先。
   * 实验闸名额租约与撞用例锁后的 elsewhere 轮询都直接竞速 `latch.await`。这样止损只让等待
   * 成功收束；用户取消仍保留为 Effect interruption Cause，不再穿过 AbortSignal / Promise 边界。
   */
  interface HaltGate {
    readonly scope: "eval" | "experiment";
    /** 展示与折叠用的实验身份(裸 run 退回 agent 名,与 budgetKey / teardown 诊断同一口径)。 */
    readonly experimentId: string;
    /** 持久化用的真实 experimentId;裸 run 没有 Run 可挂,为 undefined。 */
    readonly persistedExperimentId: string | undefined;
    /** eval 闸才有。 */
    readonly evalId: string | undefined;
    /** 两条诊断通路共用的折叠键(= scope + evalId,契约见 architecture.md「诊断」)。 */
    readonly dedupeKey: string;
    readonly latch: Effect.Latch;
    halted: boolean;
    /** 被这把闸拦下、未派发的 attempt 数(进 InvocationCompletion.unstarted)。 */
    unstarted: number;
    /** 触发落闸的失败 message,即作者的修复提示;走完通知与诊断两条通路。 */
    message: string;
    /** 触发落闸的失败所在的生命周期阶段;`--json` 的 warning 事件从 data.phase 读它。 */
    phase: LifecyclePhase;
  }
  const haltGates = new Map<string, HaltGate>();
  const haltGateKey = (run: AgentRun, evalId: string | undefined): string =>
    evalId === undefined
      ? `dispatch-halted:experiment:${run.experimentId ?? run.agent.name}`
      : `dispatch-halted:eval:${run.experimentId ?? run.agent.name}|${evalId}`;
  const haltGateOf = (run: AgentRun, evalId: string | undefined): HaltGate => {
    const dedupeKey = haltGateKey(run, evalId);
    let gate = haltGates.get(dedupeKey);
    if (!gate) {
      gate = {
        scope: evalId === undefined ? "experiment" : "eval",
        experimentId: run.experimentId ?? run.agent.name,
        persistedExperimentId: run.experimentId,
        evalId,
        dedupeKey,
        latch: Effect.unsafeMakeLatch(false),
        halted: false,
        unstarted: 0,
        message: "",
        phase: "eval.run",
      };
      haltGates.set(dedupeKey, gate);
    }
    return gate;
  };
  // 闸预先建好(而不是落闸那一刻懒建):等待中的 fiber 要能先订阅 latch / abort,懒建会让
  // 「先开始等、后落闸」的 attempt 订阅到一个已经被换掉的对象上,永远等不到中止。
  for (const a of attempts) {
    haltGateOf(a.run, undefined);
    haltGateOf(a.run, a.evalDef.id);
  }
  /** 这条 attempt 头上的两把闸,实验闸在前(蕴含关系:实验闸落下即视为本 eval 也落闸)。 */
  const haltGatesOf = (a: Attempt): readonly [HaltGate, HaltGate] => [
    haltGateOf(a.run, undefined),
    haltGateOf(a.run, a.evalDef.id),
  ];

  /**
   * 止损闸检查点:「这条 attempt 是否被作者声明的止损闸拦下」。落闸后本 eval / 本实验剩余
   * attempt 不再派发,计入 `unstarted`、完成状态落 `incomplete`(契约见
   * docs/feature/error-classification/README.md「自愈阶梯与止损阶梯」)。
   *
   * 每轮循环都会重新问一次:挂起在 elsewhere 的用例被唤醒后同样先过这道闸,不会绕开已经落下
   * 的闸重新入场。检查点存在良性竞态——闸落下的瞬间可能有 attempt 已越过检查、照常跑完,
   * 代价是多烧一个沙箱,不为它引入额外互斥(architecture.md「派发」)。
   */
  const checkDispatchHalt = (
    a: Attempt,
  ): { halted: false } | { halted: true; scope: "eval" | "experiment"; gate: HaltGate } => {
    const [experimentGate, evalGate] = haltGatesOf(a);
    if (experimentGate.halted) return { halted: true, scope: "experiment", gate: experimentGate };
    if (evalGate.halted) return { halted: true, scope: "eval", gate: evalGate };
    return { halted: false };
  };

  /** 「等到这条 attempt 头上任一把闸落下」;给 Effect 世界的等待(全局并发位)当中止信号。 */
  const haltAwait = (a: Attempt): Effect.Effect<void> => {
    const [experimentGate, evalGate] = haltGatesOf(a);
    return Effect.raceFirst(experimentGate.latch.await, evalGate.latch.await);
  };

  /**
   * 运行期即时通知:反馈流一条 error 级通知(architecture.md「观察面」的落闸形态)。与持久化的
   * `dispatch-halted` 诊断**同源互不派生**——两条通路各自从同一份 gate 状态取值,谁都不是谁的
   * 派生物。`data.unstarted` 随未派发数增长刷新(reducer 的 upsert 用最新 data 覆盖、count 自增),
   * cli.ts 的 assembleInvocationCompletion 读它折成 InvocationCompletion.unstarted。
   */
  const reportHaltNotice = (gate: HaltGate): void => {
    reportDiagnostic({
      key: gate.dedupeKey,
      // 稳定词法与持久化侧同一个字面量;折叠到哪一条实验 / 用例由 dedupeKey 与 data 的
      // experimentId / evalId 回答,不编进 code(见 sink.ts 的 DiagnosticInput.code)。
      code: HALT_DIAGNOSTIC_CODE,
      severity: "error",
      message: t(
        gate.scope === "experiment" ? "runner.dispatchHaltedExperiment" : "runner.dispatchHaltedEval",
        { message: gate.message },
      ).trimEnd(),
      data: {
        experimentId: gate.experimentId,
        scope: gate.scope,
        ...(gate.evalId !== undefined ? { evalId: gate.evalId } : {}),
        phase: gate.phase,
        unstarted: gate.unstarted,
      },
    });
  };

  /**
   * 落闸:attempt 封口的空间轴回执携带超出 `"attempt"` 的 scope 时调用(唯一入口)。
   * 幂等——并发 attempt 同时声明同一死因是常态,重复触发只折叠两条通路的诊断计数;不可逆——
   * latch 只开不关,在飞 attempt 之后成功也不重开派发;不抢占——本函数只置状态,不碰任何
   * 已经在跑的 attempt。
   */
  const closeHaltGate = (a: Attempt, declaration: AttemptFailureDeclaration): void => {
    const scope = declaration.class.scope;
    if (scope !== "eval" && scope !== "experiment") return; // 缺省档:死因只属于本次执行,无闸可落
    const gate = haltGateOf(a.run, scope === "experiment" ? undefined : a.evalDef.id);
    const message = firstLine(declaration.text);
    // 持久化通路:按 dedupeKey 折叠成一条 dispatch-halted(docs 的形状),落进该 Experiment 的
    // run.json。裸 run 没有 Run 可挂,recordExperimentDiagnostic 自己丢弃。
    recordExperimentDiagnostic({
      experimentId: gate.persistedExperimentId,
      code: HALT_DIAGNOSTIC_CODE,
      level: "error",
      message,
      phase: declaration.phase,
      dedupeKey: gate.dedupeKey,
      data: { scope, ...(gate.evalId !== undefined ? { evalId: gate.evalId } : {}) },
    });
    if (!gate.halted) {
      gate.message = message;
      gate.phase = declaration.phase;
      gate.halted = true; // 同步镜像先置位,再开 latch:两者不会互相领先
      gate.latch.unsafeOpen();
    }
    reportHaltNotice(gate);
  };

  const haltInvocationForEnvironment = (
    failure: import("../sandbox/backend.ts").SandboxSetupPrefixCacheAmbiguityError,
  ): void => {
    const message =
      `Sandbox environment is incomplete: setup-prefix operation ${JSON.stringify(failure.operationId)} ` +
      `has no proven publish terminal. Run \`${failure.diagnosticCommand}\` before starting another Invocation.`;
    const seen = new Set<HaltGate>();
    for (const attempt of attempts) {
      const gate = haltGateOf(attempt.run, undefined);
      if (seen.has(gate)) continue;
      seen.add(gate);
      recordExperimentDiagnostic({
        experimentId: gate.persistedExperimentId,
        code: "sandbox-environment-incomplete",
        level: "error",
        message,
        phase: "sandbox.prepare",
        dedupeKey: `sandbox-environment-incomplete:${failure.operationId}`,
        data: {
          scope: "invocation",
          operationId: failure.operationId,
          terminal: failure.terminal,
          diagnosticCommand: failure.diagnosticCommand,
        },
      });
      if (!gate.halted) {
        gate.message = message;
        gate.phase = "sandbox.prepare";
        gate.halted = true;
        gate.latch.unsafeOpen();
      }
      reportHaltNotice(gate);
    }
  };

  /**
   * 未派发记账:与 run 级 fail-fast / budget 停派发同一条通路——每个未派发 attempt 各发一次
   * `attempt:early-exit`(queued → completed,反馈层五项计数守恒),再把当次累计的未派发数刷进
   * 同一条 `dispatch-halted` 诊断。不为没跑过的 attempt 制造 `errored` 记录(architecture.md
   * 「记账」);退出码由观察到失败的那条 `errored` attempt 判红。
   */
  const accountDispatchHalted = (a: Attempt, gate: HaltGate): void => {
    recordCoordinator.markNotDispatched(a);
    gate.unstarted += 1;
    reportAttemptLifecycle({
      type: "attempt:early-exit",
      at: Date.now(),
      identity: feedbackIdentity(a),
      who: feedbackWho(a),
    });
    reportHaltNotice(gate);
  };

  /**
   * Eval Group 的不可用策略只约束同一台物理 Sandbox 的后续槽位；它不复用通用
   * dispatch-halted 语义，也绝不把「本来没开始」的槽位伪造成 EvalResult。Group lane
   * 已按规范化 Eval ID 串行，所以 gate 只需同步镜像：前一槽位释放 predecessor 后，下一
   * 槽位在任何 Build / Sandbox 动作前就能看见它。其它 Group 和其它 Experiment 没有共享它。
   */
  interface EvalGroupUnavailableGate {
    readonly experimentId: string | undefined;
    readonly displayExperimentId: string;
    readonly groupId: string;
    readonly onUnavailable: "stop-group" | "replace-sandbox";
    readonly dedupeKey: string;
    readonly failuresByPhase: Map<"sandbox.create" | "sandbox.prepare" | "sandbox.reset", number>;
    stopped: boolean;
    unstarted: number;
    /** Physical stage is more precise than the closed public LifecyclePhase vocabulary. */
    stage: "sandbox.create" | "sandbox.prepare" | "sandbox.reset";
    /** Durable diagnostic origin stays within the public lifecycle vocabulary. */
    phase: LifecyclePhase;
    message: string;
  }
  const evalGroupUnavailableGates = new Map<string, EvalGroupUnavailableGate>();
  const evalGroupUnavailableGateOf = (a: Attempt): EvalGroupUnavailableGate | undefined => {
    const group = a.evalDef.evalGroup;
    if (group === undefined) return undefined;
    const key = JSON.stringify([a.run.experimentId ?? a.run.agent.name, a.run.agent.name, group.id]);
    let gate = evalGroupUnavailableGates.get(key);
    if (gate === undefined) {
      gate = {
        experimentId: a.run.experimentId,
        displayExperimentId: a.run.experimentId ?? a.run.agent.name,
        groupId: group.id,
        onUnavailable: group.onUnavailable,
        dedupeKey: `eval-group-unavailable:${a.run.experimentId ?? a.run.agent.name}|${group.id}`,
        failuresByPhase: new Map(),
        stopped: false,
        unstarted: 0,
        stage: "sandbox.create",
        phase: "sandbox.create",
        message: "",
      };
      evalGroupUnavailableGates.set(key, gate);
    }
    return gate;
  };
  // 预建 gate 和 stop-halt 一样避免「上一槽位刚刚失败、下一槽位已开始等」的换对象竞态。
  for (const a of attempts) evalGroupUnavailableGateOf(a);
  const reportEvalGroupUnavailable = (gate: EvalGroupUnavailableGate): void => {
    const message = `Eval Group ${JSON.stringify(gate.groupId)} is unavailable at ${gate.stage}: ${gate.message}`;
    const data = {
      experimentId: gate.displayExperimentId,
      evalGroupId: gate.groupId,
      onUnavailable: gate.onUnavailable,
      phase: gate.stage,
      unstarted: gate.unstarted,
    } as const;
    reportDiagnostic({
      key: gate.dedupeKey,
      code: "eval-group-unavailable",
      severity: "error",
      message,
      data,
    });
    recordExperimentDiagnostic({
      experimentId: gate.experimentId,
      code: "eval-group-unavailable",
      level: "error",
      message,
      phase: gate.phase,
      data,
      dedupeKey: gate.dedupeKey,
    });
  };
  /**
   * stop-group 首次物理失败即封住后续 slot。replace-sandbox 留一次机会给**下一** slot；
   * 池的 retire/create 路径完成替换，绝不回跑已经付出成本的 Attempt。同一 lifecycle
   * 阶段第二次失败说明替换也不可用，此时收束该 Group。
   */
  const recordEvalGroupPhysicalFailure = (
    a: Attempt,
    phase: "sandbox.create" | "sandbox.prepare" | "sandbox.reset",
    error: unknown,
  ): void => {
    const gate = evalGroupUnavailableGateOf(a);
    if (gate === undefined || gate.stopped) return;
    const failures = (gate.failuresByPhase.get(phase) ?? 0) + 1;
    gate.failuresByPhase.set(phase, failures);
    const mustStop = gate.onUnavailable === "stop-group" || failures >= 2;
    if (!mustStop) {
      reportDiagnostic({
        key: `eval-group-replacing-sandbox:${gate.displayExperimentId}|${gate.groupId}|${phase}`,
        code: "eval-group-replacing-sandbox",
        severity: "warning",
        message:
          `Eval Group ${JSON.stringify(gate.groupId)} will replace its physical Sandbox before a later slot ` +
          `after ${phase} failed: ${firstLine(error instanceof Error ? error.message : String(error))}`,
        data: { experimentId: gate.displayExperimentId, evalGroupId: gate.groupId, phase, onUnavailable: gate.onUnavailable },
      });
      return;
    }
    gate.stopped = true;
    gate.stage = phase;
    gate.phase = phase === "sandbox.reset" ? "sandbox.cleanup" : phase;
    gate.message = firstLine(error instanceof Error ? error.message : String(error));
    reportEvalGroupUnavailable(gate);
  };
  const accountEvalGroupUnavailable = (a: Attempt, gate: EvalGroupUnavailableGate): void => {
    gate.unstarted += 1;
    cancelReuseAttempt(a);
    // No result, no replacement: this slot never crossed the dispatch boundary.
    reportAttemptLifecycle({
      type: "attempt:early-exit",
      at: Date.now(),
      identity: feedbackIdentity(a),
      who: feedbackWho(a),
    });
    reportEvalGroupUnavailable(gate);
  };

  const lockIdentity = { pid: process.pid, host: currentHost };

  // 用例锁(docs/feature/experiments/architecture.md「并发 Invocation:用例锁」):按
  // (experimentId, evalId) 给这批已经确定要真实派发的 attempt 分组——被静态携带筛掉的组合
  // 从不出现在 attempts[] 里,天然满足「全携带用例不取锁」;裸 run(无 experimentId)不接入。
  // 一组(runs > 1 的兄弟 attempt)共享同一把锁:谁先到派发时刻谁试,自己已持有的直接放行,
  // 别人持有则全体挂在同一个等待窗口上,不重复试锁、不各自轮询。
  /** 一次非阻塞试锁的结论。`busy` 直接带出这一条用例的挂起窗口——「发现撞锁」与「挂进哪个
   *  窗口」必须是同一步:分成两步的话,兄弟 attempt 归还许可的那几个 microtask 里窗口可能
   *  已经解决并重新取到锁,它再去建窗口就会读到**自己**的新鲜锁、永久等下去。 */
  type CaseLockTry =
    | { kind: "acquired" }
    | { kind: "busy"; window: Effect.Effect<void> };
  interface CaseLockState {
    experimentId: string;
    evalId: string;
    /** 本用例这次计划的全部 attempt;持有者一次认领它们全部,不按 attempt 拆锁。 */
    group: Attempt[];
    /** 还没收尾的 attempt 序号——`lock_wait` 的计数与「锁还留不留」都读它。 */
    pending: Set<number>;
    /** 本进程此刻持有的锁;undefined = 没持有(还没试 / 撞锁挂起中)。 */
    claim?: CaseLockEffectClaim;
    /** 同组兄弟只允许一条 fiber 做磁盘试锁；后到者在临界区内重读 claim / suspension。 */
    acquireMutex: Effect.Semaphore;
    /** 在飞的挂起窗口:撞锁的兄弟全体等同一个 Deferred。 */
    suspension?: Effect.Effect<void>;
    /** 已经用 `lock_wait started` 报进 `elsewhere`、还没被 `resolved` 报出来的 attempt 数。
     *  五项恒等式要求「报进去多少条就要报出来多少条」:收尾时不能拿当下的 `pending.size`
     *  当迁移数——等待期间被中断而提前 settle 的 attempt 会让 `pending` 缩水,差额就永远
     *  挂在 `elsewhere` 上。 */
    inElsewhere: number;
  }
  const caseLocks = new Map<string, CaseLockState>();
  const caseClaimsAwaitingPublication: CaseLockEffectClaim[] = [];
  for (const a of attempts) {
    if (!a.run.experimentId) continue;
    const key = cacheKey(a.run, a.evalDef.id);
    let st = caseLocks.get(key);
    if (!st) {
      st = {
        experimentId: a.run.experimentId,
        evalId: a.evalDef.id,
        group: [],
        pending: new Set<number>(),
        acquireMutex: yield* Effect.makeSemaphore(1),
        inElsewhere: 0,
      };
      caseLocks.set(key, st);
    }
    st.group.push(a);
    st.pending.add(a.attempt);
  }
  const caseStateOf = (a: Attempt): CaseLockState | undefined =>
    a.run.experimentId ? caseLocks.get(cacheKey(a.run, a.evalDef.id)) : undefined;

  /**
   * A late on-disk result cannot become a V1 carried Member in this invocation:
   * the writer's frozen view did not receive an exact source capability during
   * planning. Keep the lock protocol's `resolved` accounting, but dispatch all
   * still-pending Slots normally instead of guessing from legacy result files.
   */
  const resolveCaseWaitWithoutCarry = (
    st: CaseLockState,
    waitStartedAt: number | undefined,
  ): void => {
    const { experimentId, evalId } = st;
    // 这个窗口当初报进 elsewhere 的条数,收尾必须原数报回来(见 CaseLockState.inElsewhere)。
    const inElsewhere = st.inElsewhere;
    st.inElsewhere = 0;
    if (waitStartedAt === undefined) {
      return;
    }
    // 真实挂起窗口收尾:carried + dispatched 恒等于 "started" 报进去的 attempts,这条
    // 恒等式是 elsewhere 不挂账的唯一保证(reducer 只按事件携带的数字增减,不自己推)。
    reportLockWait({
      experimentId,
      evalId,
      status: "resolved",
      carried: 0,
      dispatched: inElsewhere,
      waitedMs: Date.now() - waitStartedAt,
    });
  };

  /**
   * 撞新鲜锁后的挂起窗口:这一条用例转 `elsewhere`(不占全局并发位、不占实验闸名额),每个
   * 心跳周期重读一次锁文件;锁消失(正常释放)或过期(可接管)即结束等待并重查携带。等待没有
   * 超时——心跳新鲜就一直等,用户中断照常退出。同组兄弟共享同一个窗口。
   */
  const suspendUntilCaseFree = (
    st: CaseLockState,
    holder: CaseLockRecord,
  ) => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    if (st.suspension) return st.suspension;
    const startedAt = Date.now();
    // 等待期间本 eval / 本实验的止损闸落下 → 这一轮等待到头(对方可能还要跑很久,没必要陪着)。
    // 窗口照常走完 resolveCaseWaitWithoutCarry 并发出 `lock_wait resolved`:少发一次 resolved,这批 attempt 就
    // 永远挂在 elsewhere 上,五项恒等式当场破。
    const halt = haltAwait(st.group[0]!);
    const stopWaiting = opts.signal === undefined
      ? halt
      : Effect.raceFirst(halt, interruptOnAbort(opts.signal));
    // 窗口打开这一刻本组还没派发的 attempt 全在 queued(本进程没持锁 = 没有一条开跑),
    // 整批迁进 elsewhere;记下条数,收尾的 resolved 原数迁回(见 CaseLockState.inElsewhere)。
    st.inElsewhere = st.pending.size;
    reportLockWait({
      experimentId: st.experimentId,
      evalId: st.evalId,
      status: "started",
      holderPid: holder.pid,
      holderHost: holder.host,
      attempts: st.inElsewhere,
    });

    const poll = Effect.gen(function* () {
      for (;;) {
        const stopped = yield* Effect.raceFirst(
          Effect.sleep(CASE_LOCK_HEARTBEAT_INTERVAL_MS).pipe(Effect.as(false)),
          stopWaiting.pipe(Effect.as(true)),
        );
        if (stopped) return;
        const record = yield* readCaseLockEffect(coordinationRoot, st.experimentId, st.evalId).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
        if (record === undefined || isCaseLockExpired(record, Date.now())) return;
      }
    }).pipe(
      Effect.ensuring(Effect.sync(() => resolveCaseWaitWithoutCarry(st, startedAt))),
    );
    // 等待本身就是挂起窗口。它不绑定刚归还的全局位 Scope；同组后到者拿到同一 Effect，
    // 每个等待者都可被取消，而任一一次完成都会清掉下一轮重新试锁所读的窗口。
    const window: Effect.Effect<void> = poll.pipe(Effect.ensuring(Effect.sync(() => {
      if (st.suspension === window) st.suspension = undefined;
    })));
    st.suspension = window;
    return window;
  }));

  /**
   * 派发时刻的一次**非阻塞**试锁。调用直接留在当前 Effect fiber；`onWaitStart` 只用一个局部
   * AbortController 截断 lock.ts 的轮询，把「新鲜锁」转换成 elsewhere，而用户取消仍沿当前
   * fiber 的 interruption Cause 上抛。撞上过期锁属于一次尝试内部的 rename 接管，照常 acquired。
   */
  const tryAcquireCase = (st: CaseLockState) => st.acquireMutex.withPermits(1)(
    Effect.suspend(() => {
      // 同组兄弟:自己已持有,直接放行。
      if (st.claim) return Effect.succeed<CaseLockTry>({ kind: "acquired" });
      // 已经有兄弟挂在窗口上:全体等同一个窗口,不重复试锁。
      if (st.suspension) return Effect.succeed<CaseLockTry>({ kind: "busy", window: st.suspension });
      return Effect.gen(function* () {
        const { experimentId, evalId } = st;
        // 接管诊断要报"原持有者是谁",但 acquireCaseLockEffect 只回传 takenOver 布尔值——取锁前先
        // 无副作用地读一眼当前记录(纯尽力而为:极端时序下这份快照可能已经不是真正被接管的
        // 那条记录,但诊断本来就是人读提示,不是判定依据)。
        const priorHolder = yield* readCaseLockEffect(coordinationRoot, experimentId, evalId).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
        const giveUp = new AbortController();
        let busyWith: CaseLockRecord | undefined;
        return yield* Effect.uninterruptibleMask((restore) =>
          restore(acquireCaseLockEffect(coordinationRoot, experimentId, evalId, lockIdentity, {
            signal: giveUp.signal,
            onWaitStart: (holder) => {
              busyWith = holder;
              giveUp.abort(); // 撞上新鲜锁 = 这次尝试到此为止,不进入 acquireCaseLockEffect 自己的轮询
            },
          })).pipe(
            Effect.matchEffect({
              onFailure: (error) => {
                const holder = busyWith;
                return holder === undefined
                  ? Effect.fail(error)
                  : suspendUntilCaseFree(st, holder).pipe(
                      Effect.map((window): CaseLockTry => ({ kind: "busy", window })),
                    );
              },
              onSuccess: ({ claim, takenOver }) => Effect.sync((): CaseLockTry => {
                // acquire 返回到 claim 登记之间保持 masked；否则恰好落在这条缝里的 interruption
                // 会让 heartbeat/held 已启动、CaseLockState 却没有 release 句柄。
                st.claim = claim;
                if (takenOver) {
                  const message = t("runner.coordinationRecovered", { experimentId }).trimEnd();
                  reportDiagnostic({
                    key: `${COORDINATION_RECOVERED_CODE}:case-lock:${experimentId}|${evalId}`,
                    code: COORDINATION_RECOVERED_CODE,
                    severity: "info",
                    message,
                    data: {
                      experimentId,
                      evalId,
                      resource: "case-lock",
                      ...(priorHolder !== undefined ? { previousPid: priorHolder.pid, previousHost: priorHolder.host } : {}),
                    },
                  });
                }
                // V1 does not convert late legacy rows into carried Members. The frozen writer view is
                // authoritative, so a lock acquired after another Invocation left still dispatches every pending Slot.
                resolveCaseWaitWithoutCarry(st, undefined);
                return { kind: "acquired" };
              }),
            }),
          )
        );
      });
    }),
  );

  /** 用例全部 attempt(不论真实派发还是被重查携带命中而跳过)都 settle 后删锁;与
   *  ExperimentLifecycle.pendingAttempts 清空触发 teardown 同一种「逐 attempt 身份结算」模式。 */
  const releaseCaseLockIfDone = (st: CaseLockState, attempt: number): Effect.Effect<void> =>
    Effect.sync(() => {
      st.pending.delete(attempt);
      if (st.pending.size > 0) return undefined;
      const claim = st.claim;
      st.claim = undefined;
      return claim;
    }).pipe(
      Effect.tap((claim) => Effect.sync(() => {
        if (claim !== undefined) caseClaimsAwaitingPublication.push(claim);
      })),
    );

  /** 派发链一轮的结局:`done` = 这条 attempt 已经了结(跑完 / 被跳过 / 携入 / 中断),
   *  `suspend` = 撞上别人持有的用例锁,许可全部归还、挂进 `window` 这个 elsewhere 窗口后重来,
   *  `recheck` = 许可获取被止损闸打断,许可全部归还、回到许可链 ① 重新过闸(记账在那里做)。
   *  `recheck` 只在闸已经落下时产生,循环顶因此必然收束,不会空转。 */
  type DispatchOutcome =
    | { kind: "done" }
    | { kind: "suspend"; window: Effect.Effect<void> }
    | { kind: "recheck" };

  /** 全局并发位的显式持有句柄:`withPermits` 的作用域语义没法表达「中途让位、回来再拿」,
   *  而实验级 setup 要求让位(docs/runner.md「调度:有界并发」)。两个成员都
   *  幂等——让位后收尾 finalizer 不会重复归还,回来之后中断也只归还一次。 */
  interface GlobalSlotHold {
    readonly release: Effect.Effect<void>;
    readonly reacquire: Effect.Effect<void>;
  }
  const detachedSlotHold: GlobalSlotHold = Object.freeze({
    release: Effect.void,
    reacquire: Effect.void,
  });

  const withGlobalSlot = <E, R>(
    haltSignal: Effect.Effect<void>,
    use: (slot: GlobalSlotHold) => Effect.Effect<DispatchOutcome, E, R>,
  ): Effect.Effect<DispatchOutcome, E, R> =>
    Effect.uninterruptibleMask((restore) => {
      const state = { held: false };
      const release = Effect.suspend(() =>
        state.held
          ? globalSem.release(1).pipe(
              Effect.map(() => {
                state.held = false;
              }),
            )
          : Effect.void,
      );
      const reacquire = Effect.suspend(() =>
        state.held
          ? Effect.void
          : globalSem.take(1).pipe(
              Effect.map(() => {
                state.held = true;
              }),
            ),
      );
      // 取位本身可中断(restore):Ctrl+C 不该被「等一个全局位」拖住;拿到之后的执行体同样
      // 可中断,只有归还挂在 ensuring 上,中断路径照样跑。
      //
      // 排队等位期间止损闸落下 → 竞速的 haltSignal 先到,这一轮不进场(交回 recheck,由许可链
      // ① 做未派发记账)。这是「等待集中同闸 attempt 经 interruption 中止」在 Effect 世界的落点;
      // 竞速只覆盖「还在等位」这一段——拿到位子那一刻竞速已结算,之后的执行体不再被抢占。
      // `ensuring(release)` 提到最外层(而不是只挂在拿到位子之后):极端时序下 take 已经成功、
      // 竞速却判 haltSignal 赢,位子照样归还,不泄漏一个全局名额。
      return Effect.raceFirst(restore(reacquire).pipe(Effect.as(true)), restore(haltSignal).pipe(Effect.as(false)))
        .pipe(
          Effect.flatMap((entered) =>
            entered
              ? restore(use({ release, reacquire }))
              : Effect.succeed<DispatchOutcome>({ kind: "recheck" }),
          ),
          Effect.ensuring(release),
        );
    });

  /** Invocation 内实验闸的持有作用域。它只限制此 Invocation 的 attempt，不取得任何
   * 跨进程资源；共享外部状态必须由 `sharedState` 生命周期租约保护。 */
  const withExperimentGate = <E, R>(
    a: Attempt,
    use: (slot: GlobalSlotHold) => Effect.Effect<DispatchOutcome, E, R>,
  ): Effect.Effect<DispatchOutcome, E, R> => {
    const localSem = gateLocalSems.get(a.run);
    if (localSem === undefined) return use(detachedSlotHold);
    return Effect.uninterruptibleMask((restore) => {
      const state = { held: false };
      const release = Effect.suspend(() => state.held
        ? localSem.release(1).pipe(Effect.tap(() => Effect.sync(() => {
          state.held = false;
        })))
        : Effect.void);
      const reacquire = Effect.suspend(() => state.held
        ? Effect.void
        : localSem.take(1).pipe(Effect.tap(() => Effect.sync(() => {
          state.held = true;
        }))));
      return restore(reacquire).pipe(
        Effect.flatMap(() => restore(use({ release, reacquire }))),
        Effect.ensuring(release),
      );
    });
  };

  // earlyExit:为每个 key 各建一个 AbortController。某 attempt 通过或 errored 时 abort 它,
  // 让并发进行中的同 key attempt 通过 signal 尽早退出,而不只是等排队的才能被跳过。
  const evalAbortControllers = new Map<string, AbortController>();
  const recordFatalController = new AbortController();
  for (const a of attempts) {
    if (a.evalDef.evaluationKind === "pass" && a.run.earlyExit && !evalAbortControllers.has(a.key)) {
      evalAbortControllers.set(a.key, new AbortController());
    }
  }

  // 所有 Slot 都先成为轻量 coordination fiber。执行资源仍由实验闸、globalSem 与
  // provider lane 严格有界；但 sharedState / predecessor / lock 等待绝不能占住一个
  // 有限 forEach worker，否则同 key waiter 会饿死持有者的后继 Slot，形成环形等待。
  // 因而这里必须 unbounded：它只放大 suspendable fibers，不放大 Agent、Sandbox 或
  // provider 的物理并发。
  // runAttemptEffect 只把「执行错误」收进 EvalResult.error(不 fail),
  // 但中断(Ctrl+C / kill)照常向上传播 —— 所以一条挂掉不会中断其它 attempt,而中断能停掉全部。
  //
  // signal:把 opts.signal 喂给 run → abort 触发根 fiber 中断 → forEach 中断所有子 fiber
  //         → 每个 attempt 的 Sample 跑 release(sb.stop)→ 容器全部停掉(治孤儿)。Effect 保证
  //         所有 finalizer 跑完后才结算,所以下面 summarize 时容器已清理干净。
  //
  // 外部 AbortSignal 以一个 Effect interrupt race 接入本 Scope。中断仍返回 Exit，
  // 于是可以保留部分汇总；非中断缺陷照常向上交给 application edge。
  let interrupted = false;
  const dispatchEffect = Effect.forEach(
      attempts,
      (a) => {
        const budgetKey = a.run.experimentId ?? a.run.agent.name;
        const caseState = caseStateOf(a);

        // preflight:「要不要开始跑」的许可判断(首过即停 + budget 上限检查)。两类判断都是
        // 即时返回、不做任何等待,所以放在授位之后没有「占着全局并发槽位干等」的问题;放在
        // 派发时刻(而不是排队时刻)判,读到的是这一刻最新的通过集与已花费。
        const preflight = Effect.gen(function* () {
            // 首过即停:只由 passed 触发(errored 不中止其余样本,见 docs/feature/experiments/
            // architecture.md「调度接口」)。
            if (a.evalDef.evaluationKind === "pass" && a.run.earlyExit && passedKeys.has(a.key)) {
              cancelReuseAttempt(a);
              recordCoordinator.markNotDispatched(a);
              yield* reportMutex.withPermits(1)(
                emitReporterEvent(reporters, {
                  type: "invocation:earlyExit",
                  evalId: a.evalDef.id,
                  experimentId: a.run.experimentId,
                }),
              );
              reportAttemptLifecycle({
                type: "attempt:early-exit",
                at: Date.now(),
                identity: feedbackIdentity(a),
                who: feedbackWho(a),
              });
              return false;
            }

            // run 级 fail-fast:确定性错误(同一 code 在同一 key 连续复现)已识别 → 停止派发,
            // 未派发计入 unstarted(结论落 incomplete,不伪装成全绿;与首过即停互不混用)。
            const failFast = failFastKeys.get(a.key);
            if (failFast !== undefined) {
              cancelReuseAttempt(a);
              recordCoordinator.markNotDispatched(a);
              failFast.skipped += 1;
              reportAttemptLifecycle({
                type: "attempt:early-exit",
                at: Date.now(),
                identity: feedbackIdentity(a),
                who: feedbackWho(a),
              });
              reportDiagnostic({
                key: `fail-fast:${a.key}`,
                code: "fail-fast",
                severity: "warning",
                message: t("runner.failFast", { evalId: a.evalDef.id, code: failFast.code }).trimEnd(),
                identity: feedbackIdentity(a),
                data: { evalId: a.evalDef.id, code: failFast.code, ...(a.run.experimentId ? { experimentId: a.run.experimentId } : {}) },
              });
              return false;
            }

            const budget = a.run.budget;
            if (budget !== undefined) {
              // 只看已完成 attempt 的价目表估算成本(见上方 BudgetState 注释；observed
              // usage.costUSD 不参与),到顶就跳过新 attempt,
              // 没到顶就立即放行——不等待、不做预测性节流。
              const s = budgetState(budgetKey);
              if (s.spent >= budget) {
                cancelReuseAttempt(a);
                recordCoordinator.markNotDispatched(a);
                if (!budgetReported.has(budgetKey)) {
                  budgetReported.add(budgetKey);
                  yield* reportMutex.withPermits(1)(
                    emitReporterEvent(
                      reporters,
                      { type: "invocation:budgetExceeded", budget, spent: s.spent },
                    ),
                  );
                }
                // 反馈层:对每一个因预算到顶而不派发的 attempt 各发一次(与上面的
                // attempt:early-exit 同构),让 RunFeedbackState 的 queued/completed 计数与
                // cli.ts 的 assembleRunCompletion() 都能感知到「有 attempt 因预算未派发」——
                // 上面 emitReporterEvent 的 invocation:budgetExceeded 只对旧版 Reporter 接口每
                // budgetKey 报一次,不满足反馈层「每个未派发 attempt 各一条」的计数契约,两者
                // 独立并存。只在挂靠 experiment 时报(budget-exhausted 事件要求真实
                // experimentId;裸 run 不产出这类永久事件,与 locator 的省略规则一致)。
                if (a.run.experimentId) {
                  s.unstartedCount += 1;
                  reportBudgetExhausted({
                    experimentId: a.run.experimentId,
                    spent: s.spent,
                    unstarted: s.unstartedCount,
                  });
                }
                return false;
              }
            }
            return true;
          });

        // body:许可链全部通过之后才跑,真正的执行段。
        const body = (globalSlot: GlobalSlotHold, experimentSlot: GlobalSlotHold) =>
          Effect.gen(function* () {
            const concurrencySlot = {
              release: globalSlot.release.pipe(Effect.zipRight(experimentSlot.release)),
              reacquire: experimentSlot.reacquire.pipe(Effect.zipRight(globalSlot.reacquire)),
            };
            // 合并全局信号与本 eval 的首过即停信号:任一 abort → 本 attempt 的信号 abort。
            const evalAc = evalAbortControllers.get(a.key);
            const attemptSignal = AbortSignal.any([
              recordFatalController.signal,
              ...(evalAc === undefined ? [] : [evalAc.signal]),
              ...(opts.signal === undefined ? [] : [opts.signal]),
            ]);
            // BuildKey / CaseKey 已在 Attempt.plan 的 physical completion state 中确定；
            // 这里只把协调器执行结果作为必填运行输入传给 materializer，不回写 Attempt。
            const buildLocators = buildLocatorsByAttempt.get(buildUseKey(a)) ?? new Map<BuildKey, JsonValue>();

            // 派发前的确定性失败(实验级 setup 失败 / 判分预检失败):不派发 agent、不建沙箱。
            // 这类 Slot 没有 origin Attempt，因而会使 V1 draft 保持 incomplete；不能为它
            // 伪造一个没有 sealed Assertions 的 Member。
            const expLc = expLifecycles.get(a.run);
            const setupFailure = expLc === undefined
              ? Option.none<AttemptError>()
              : (() => {
                  const state = expLc.state;
                  const outcome = state._tag === "Active" || state._tag === "TearingDown"
                    ? setupOutcomeOf(state.setup)
                    : state._tag === "TornDown"
                      ? state.setup
                      : undefined;
                  if (outcome === undefined) {
                    throw new Error(`Experiment setup has no outcome in lifecycle state ${state._tag}.`);
                  }
                  return outcome._tag === "Failed" ? Option.some(outcome.error) : Option.none<AttemptError>();
                })();
            const precheckFailure = judgePrecheckFailures.get(cacheKey(a.run, a.evalDef.id));
            const buildFailure = buildFailureByPair.get(cacheKey(a.run, a.evalDef.id));
            const setupPrefixFailure = setupPrefixPreparation.failuresByPair.get(
              cacheKey(a.run, a.evalDef.id),
            );
            let blockedError: AttemptError | undefined = recordFatalController.signal.aborted
              ? {
                  code: "record-invocation-fatal",
                  message: "A prior Record Attempt reservation failed; no further Attempt may start.",
                  origin: attemptOrigin("sandbox.queue"),
                }
              : Option.isSome(setupFailure)
                ? setupFailure.value
              : precheckFailure !== undefined
                ? { code: "judge-precheck-failed", message: precheckFailure, origin: attemptOrigin("judge.precheck") }
                : setupPrefixFailure !== undefined
                  ? errorFromThrown(setupPrefixFailure, "sandbox.prepare")
                : buildFailure !== undefined
                  ? buildFailure
                  : undefined;
            if (blockedError !== undefined) cancelReuseAttempt(a, true);
            if (buildFailure !== undefined) {
              recordExperimentDiagnostic({
                experimentId: a.run.experimentId,
                code: SHARED_BUILD_FAILURE_DIAGNOSTIC,
                level: "error",
                message: sharedBuildFailureDetail(a, buildFailure),
                phase: "sandbox.queue",
              });
            }

            // A scheduler-admitted Attempt owns a durable identity before any
            // attempt-owned sandbox, Agent, or Eval work begins. Reservation
            // failure is invocation-fatal at the Record publish gate.
            const initialPhase: LifecyclePhase = a.run.agent.kind === "sandbox" ? "sandbox.queue" : "eval.run";
            const reservationAttempted = blockedError === undefined;
            let reservedRecordAttempt: RunnerRecordAttempt | undefined;
            if (reservationAttempted) {
              const reservation = yield* Effect.either(recordCoordinator.reserveAttempt(a));
              if (Either.isLeft(reservation)) {
                recordFatalController.abort();
                blockedError = {
                  ...errorFromThrown(reservation.left, initialPhase),
                  code: "record-attempt-reservation-failed",
                };
                cancelReuseAttempt(a, true);
              } else {
                reservedRecordAttempt = reservation.right;
                a.locator = reservation.right.locator;
              }
            }

            let attemptStarted = false;
            let providerQueued = false;
            const startAttempt = (phase: LifecyclePhase): Effect.Effect<void> =>
              Effect.uninterruptible(Effect.suspend(() => {
                if (attemptStarted) return Effect.void;
                attemptStarted = true;
                return reportMutex.withPermits(1)(
                  emitReporterEvent(reporters, {
                    type: "eval:start",
                    eval: { id: a.evalDef.id },
                    agent: a.run.agent,
                    model: a.run.model,
                    attempt: a.attempt,
                    experimentId: a.run.experimentId,
                  }),
                ).pipe(Effect.zipRight(Effect.sync(() => {
                  reportAttemptLifecycle({
                    type: "attempt:start",
                    at: Date.now(),
                    identity: feedbackIdentity(a),
                    who: feedbackWho(a),
                    phase,
                  });
                })));
              }));
            const queueForProvider = (reason: "provider-capacity"): Effect.Effect<void> =>
              Effect.sync(() => {
                if (attemptStarted || providerQueued) return;
                providerQueued = true;
                reportAttemptLifecycle({
                  type: "attempt:queued",
                  at: Date.now(),
                  identity: feedbackIdentity(a),
                  who: feedbackWho(a),
                  reason,
                });
              });
            const providerAdmission = {
              queued: queueForProvider,
              granted: startAttempt("sandbox.create"),
              slot: concurrencySlot,
            };
            const poolSelection: ReusePoolSelection = blockedError === undefined
              ? yield* reusePoolFor(a)
              : { _tag: "Fresh" };
            // 复用池的租借失败(实例创建、SandboxLayer setup 钩子、寿命确认都在池内)是**这条
            // attempt 的终局失败**,不是调度缺陷:失败原样交回这里,先读空间轴回执(作者在
            // setup 钩子里抛的 ExperimentFatalError 由此落闸),再折成 errored 结果走与
            // blockedError 完全相同的下游路径。
            // 拒绝必须经过具名 Effect 边界:否则会变成 defect 打断 forEach,连坐同批其它实验,
            // 且混进兄弟 fiber 的 interrupt 后被当成用户中断吞掉正文(见
            // docs/feature/error-classification/architecture.md「Effect 边界」:attempt fiber 的
            // E 恒为 never;memory/experiment-fatal-presented-as-user-interrupt.md)。
            let sealedEvaluation: SealedAttemptAssertions | undefined;
            const completed = yield* Effect.scoped(Effect.gen(function* () {
              const leased = poolSelection._tag === "Reuse"
                ? Either.match(yield* Effect.either(poolSelection.pool.acquire(
                  resolveAttemptTimeout(a.run, a.evalDef, opts.config)?.timeoutMs,
                  buildLocators,
                  providerAdmission,
                )), {
                  onLeft: (error) => ({ _tag: "Failed" as const, error }),
                  onRight: (lease) => {
                    acquiredReuseAttempts.add(a);
                    return { _tag: "Acquired" as const, lease };
                  },
                })
              : { _tag: "NotRequested" as const };
            const lease = leased._tag === "Acquired" ? leased.lease : undefined;
            // 租借失败归 `sandbox.create` 阶段:池把「创建实例 + 跑 SandboxLayer setup + 确认寿命」
            // 打包成一次借出,调度器这一侧只知道这条 attempt 没能拿到可用实例。
            const leaseError: AttemptError | undefined =
              leased._tag === "Failed" ? errorFromThrown(leased.error, "sandbox.create") : undefined;
            if (leased._tag === "Failed") {
              cancelReuseAttempt(a, true);
              const declaration = attemptFailureDeclaration(a.run.classifyFailure, "sandbox.create", leased.error);
              if (declaration) closeHaltGate(a, declaration);
              // This Attempt did start its physical acquisition and is therefore recorded below
              // as an errored result. The Group policy only decides what a later slot may do.
              recordEvalGroupPhysicalFailure(a, "sandbox.create", leased.error);
            }
            const failedBeforeDispatch = blockedError ?? leaseError;
            if (
              !providerQueued &&
              !attemptStarted &&
              (failedBeforeDispatch !== undefined || lease !== undefined || a.plan._tag === "Direct")
            ) {
              yield* startAttempt(initialPhase);
            }
            const recordedAttempt = a;
            const evaluated = failedBeforeDispatch
              ? ({
                  id: a.evalDef.id,
                  description: a.evalDef.description,
                  experimentId: a.run.experimentId,
                  experiment: experimentRunInfo(
                    a.run,
                    a.plan,
                    a.sandboxPlansByEval,
                    opts.config,
                    a.judge,
                  ),
                  agent: a.run.agent.name,
                  model: a.run.model,
                  verdict: "errored",
                  fingerprint: a.fingerprint,
                  evaluationAlgorithm: EVALUATION_ALGORITHM,
                  attempt: a.attempt,
                  startedAt: new Date().toISOString(),
                  durationMs: 0,
                  factResults: [],
                  factUses: [],
                  evaluationKind: a.evalDef.evaluationKind,
                  ...(a.evalDef.evaluationKind === "score"
                    ? { scoreResult: scoreFactOutcomeForAttemptError(failedBeforeDispatch) }
                    : {}),
                  evidenceCoverage: a.run.agent.evidenceCoverage,
                  error: failedBeforeDispatch,
                } satisfies EvalResult)
              : yield* runAttemptEffect(
                  recordedAttempt,
                  attemptOptions,
                  sandboxSem,
                  {
                    buildLocators,
                    ...(setupPrefixPreparation.preparedByPair.get(cacheKey(a.run, a.evalDef.id)) === undefined
                      ? {}
                      : {
                          preparedSetupPrefix: setupPrefixPreparation.preparedByPair.get(
                            cacheKey(a.run, a.evalDef.id),
                          )!,
                        }),
                    runTiming,
                    parentSignal: attemptSignal,
                    invocationSignal: opts.signal,
                    concurrencySlot,
                    providerAdmission,
                    ...(lease
                      ? {
                          reusedSandbox: {
                            resourceSandbox: lease.resourceSandbox,
                            sandbox: lease.sandbox,
                            reuseSandbox: lease.reuseSandbox,
                            reuseOrdinal: lease.reuseOrdinal,
                          },
                        }
                      : {}),
                    // 止损闸的消费点:attempt 封口读终局失败的空间轴。scope 经这条**封口回执**
                    // 到达调度器,不走错误通道向上传播——attempt fiber 的 E 保持 never,`errored`
                    // 仍是 eval runner 的合法结果而不是调度失败(architecture.md「Effect 边界」)。
                    onFailureClass: (declaration) => closeHaltGate(a, declaration),
                    onEnvironmentIncomplete: haltInvocationForEnvironment,
                    ...(a.run.sharedState !== undefined
                      ? {
                          onSandboxCleanupFailure: (failure: SandboxCleanupFailure) => {
                            recordSandboxCleanupFailure(a.run, failure);
                          },
                        }
                      : {}),
                    onSealedEvaluation: (sealed) =>
                      Effect.sync(() => {
                        sealedEvaluation = sealed;
                      }).pipe(Effect.zipRight(
                        recordCoordinator.noteSealedOrMarkIncomplete(
                          recordedAttempt,
                          sealed,
                        ),
                      )),
                  },
                );
            if (lease) {
              // Attempt 的 Eval/Agent 收尾已在 runAttemptEffect 内完成；reset 失败会淘汰实例，
              // 本条结果如实保留，后续派发创建替代实例。
              // Only the typed plugin resource prepare code carries physical-resource
              // unavailability. An author SandboxLayer prepare command can also fail at
              // `sandbox.prepare`, but it must not retire a pool or trip this Group gate.
              if (evaluated.error?.code === "plugin-resource-prepare-failed") {
                recordEvalGroupPhysicalFailure(a, "sandbox.prepare", new Error(evaluated.error.message));
              }
              const mustRetire = reuseResultRequiresRetirement(evaluated);
              yield* lease.commit(mustRetire ? { _tag: "Retire" } : { _tag: "Reset" });
            }
            return Object.freeze({
              result: evaluated,
            });
            }));
            // Reset/finalizer failures belong to the physical Group instance and
            // only affect later slots; they never rewrite the sealed Attempt.
            if (poolSelection._tag === "Reuse") {
              for (const failure of poolSelection.pool.drainRuntimeFailures()) {
                recordEvalGroupPhysicalFailure(a, failure.stage, failure.error);
              }
            }
            const { result } = completed;
            // A provider-capacity failure can terminate directly from queued;
            // every other executed path retains the historical start/complete
            // pairing even if it failed before reaching provider admission.
            if (!attemptStarted && !providerQueued) yield* startAttempt(initialPhase);
            // A never-started blocked Slot has no origin Attempt. A reserved
            // setup/lease failure still closes its origin Attempt with the
            // errored result, without inventing unavailable rich families.
            let locator: string | undefined;
            if (reservedRecordAttempt !== undefined) {
              locator = reservedRecordAttempt.locator;
              result.locator = locator;
              const recordAttempt = yield* recordCoordinator.completeAttemptOrMarkIncomplete(a, result);
              if (recordAttempt !== undefined) {
                locator = recordAttempt.locator;
                result.locator = locator;
              }
            } else if (!reservationAttempted) {
              recordCoordinator.markNotDispatched(a);
            }
            // 唯一出口覆盖每一个真正执行过的 Attempt。正常路径与 attempt:start 配对；provider
            // reservation 在 grant 前终结时则直接 queued→verdict，不能伪造瞬时 running。
            reportAttemptLifecycle({
              type: "attempt:complete",
              at: Date.now(),
              identity: feedbackIdentity(a),
              who: feedbackWho(a),
              verdict: result.verdict,
              tokenCount: result.usage
                ? (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)
                : undefined,
              estimatedCostUSD: result.estimatedCostUSD,
            });
            if (a.run.budget !== undefined) {
              const s = budgetState(budgetKey);
              if (result.estimatedCostUSD !== undefined) {
                s.spent += result.estimatedCostUSD;
              } else if (result.phases?.some((phase) => phase.children?.some((child) => child.key === "agent.turn"))) {
                s.completedAgentRunsNoCost += 1;
                if (s.spent === 0 && s.completedAgentRunsNoCost >= 3 && !s.unenforceableWarned) {
                  // 连续几次真正跑过 agent 的 attempt 都拿不到成本:budget 对这个 agent
                  // 不可执行,说清楚一次。sandbox.create/setup 等前置失败没有 turn,跳过这里:
                  // 此时应由 attempt error 回答根因,不能再用计费 warning 抢走注意力。
                  // s.unenforceableWarned 已经是 per-budgetKey 的一次性闸门;稳定 key 上的
                  // reportDiagnostic 去重是双保险,不依赖它单独生效。
                  s.unenforceableWarned = true;
                  {
                    const message = t("runner.budgetUnenforceable", { budgetKey }).trimEnd();
                    reportDiagnostic({ key: `budget-unenforceable:${budgetKey}`, code: "budget-unenforceable", severity: "warning", message, data: { budgetKey } });
                    recordExperimentDiagnostic({
                      experimentId: a.run.experimentId,
                      code: "budget-unenforceable",
                      level: "warning",
                      message,
                      phase: "eval.run",
                      data: { budgetKey },
                    });
                  }
                }
              }
            }

            if (a.evalDef.evaluationKind === "pass" && result.verdict === "passed") {
              passedKeys.add(a.key);
              lastErrorCode.delete(a.key);
              evalAc?.abort(); // 让同 key 并发 attempt 尽早退出
            } else if (a.evalDef.evaluationKind === "pass" && a.run.earlyExit && passedKeys.has(a.key)) {
              // 并发情况:同 key 另一个 attempt 已通过后本 attempt 才完成(被 abort 后产出
              // errored),不计入结果。
              return;
            } else if (result.verdict === "errored" && !blockedError) {
              // errored 不中止其余样本(基建可能自愈);只有同一错误 code 连续复现才判定为
              // 确定性错误,进 run 级 fail-fast 停止派发(不 abort 已在飞的 attempt)。
              // 派发前确定性失败(实验级 setup 失败、判分预检失败)的合成结果不进 fail-fast:
              // 它不派发 agent、零成本,契约是受影响的「所有」attempt 逐条记 errored 进报告,
              // 不该被止损机制截短。
              const code = result.error?.code ?? "unexpected-error";
              const prev = lastErrorCode.get(a.key);
              const streak = prev?.code === code ? prev.streak + 1 : 1;
              lastErrorCode.set(a.key, { code, streak });
              if (streak >= 2 && !failFastKeys.has(a.key)) {
                failFastKeys.set(a.key, { code, skipped: 0 });
              }
            } else {
              lastErrorCode.delete(a.key);
            }

            results.push(result);
            // 反馈层的永久失败通知(见 sink.ts 的 FailureInput / docs/feature/experiments/
            // cli.md「什么动态更新,什么逐条追加」表的「failed / errored + locator」行)——
            // 只在拿到 locator 时报(裸 run 没有 locator,不产出这类事件,与上面 result.locator
            // 的省略规则一致),且只报真正计入 results 的 attempt(上面的并发去重分支已经
            // return 掉、不会走到这里,不会为一条被丢弃的重复 attempt 误报失败)。
            if (locator) {
              const failure = failureDetailFromResult(result, sealedEvaluation);
              if (failure) reportFailure(failure);
            }
            yield* reportMutex.withPermits(1)(
              // 每个 reporter 单独兜错:一个写文件失败 / 自定义 reporter 抛错只记 diagnostic,
              // 不让一个回调中断其它回调或后续 attempt。
              Effect.forEach(
                reporters,
                (reg) => runReporter(reg, "onEvalComplete", () => reg.reporter.onEvalComplete?.(result)),
                { concurrency: "unbounded", discard: true },
              ),
            );
            // 和上面的 onEvalComplete 同一把 reportMutex:两条回调路径都要串行化,否则并发
            // attempt 各自触发的 eval:complete 会绕开 permit=1 直接并发跑,和文档承诺的
            // 「报告回调串行化」不一致。
            yield* reportMutex.withPermits(1)(
              emitReporterEvent(reporters, { type: "eval:complete", result }),
            );
          });
        // ③ 全局并发位 → sharedState（如声明，先于 Eval lock）→ 派发时刻试锁 → preflight
        // → 实验级 setup → provider/Sandbox/body。
        // 独占串行 provider:同一 provider 名的所有 attempt 共享一把 permit=1 的锁。
        // sharedState 获取与 Experiment setup 都是宿主协调，不能让等待者占着该 Provider lane；
        // permit 只包真正触及 provider、Sandbox 与 Attempt body 的执行段。
        const exclusiveSem = exclusiveSemFor(a.plan);
        const arriveAtDispatchWave = dispatchWaveArrive.get(a)!;
        const dispatch = (experimentSlot: GlobalSlotHold) => withGlobalSlot(haltAwait(a), (slot) =>
          Effect.gen(function* () {
            yield* arriveAtDispatchWave;
            // 拿到位子的这一刻再问一次闸:排在独占 provider 锁 / 实验闸本地信号量上的那段等待
            // 不在上面的竞速覆盖范围里(竞速只包全局位),闸可能正是在那段时间落下的。
            if (checkDispatchHalt(a).halted) return { kind: "recheck" } as const;
            // sharedState 的等待不得先占 Eval lock 或全局并发位，也不得运行 setup / 创建
            // Sandbox。拿到租约后这个 Invocation 仍继续自己在本轮已形成的 plan，不采用别的
            // Run 在等待期间发布的 attempt。
            if (a.run.sharedState) {
              const proceed = yield* preflight;
              if (!proceed) return { kind: "done" } as const;
              authorizedReuseAttempts.add(a);
              yield* slot.release;
              yield* ensureExperimentSetup(a);
              yield* slot.reacquire;
            }
            // 派发时刻取锁:授位之后才试,非阻塞。撞上别人持有的新鲜锁就把这个位子连同实验闸
            // 名额一起还回去(返回 "suspend"),由外层转入 elsewhere 挂起;位子当场空出来,
            // 排队中的下一条没被锁的用例接手。
            if (caseState) {
              const outcome = yield* tryAcquireCase(caseState);
              if (outcome.kind === "busy") return { kind: "suspend", window: outcome.window } as const;
              if (!a.run.sharedState && (yield* recordCoordinator.adoptLatePublishedAttempt(a))) {
                return { kind: "done" } as const;
              }
            }
            if (!a.run.sharedState) {
              const proceed = yield* preflight;
              if (!proceed) return { kind: "done" } as const;
              authorizedReuseAttempts.add(a);
            }
            if (!a.run.sharedState && (a.run.setup || a.run.teardown)) {
              // 实验级 setup:第一个通过派发许可的 attempt 真正执行,其余等同一个 memoized
              // Effect completion（作者 setup 失败收进 lc.setupFailed，由 body 合成 errored 结果）。
              // 等它的时候让出全局并发位(docs/runner.md「调度:有界并发」——内部等待一律让位,
              // 慢启动的 setup 不许饿死同批其它实验),回来再重新拿位。实验闸名额不让。
              yield* slot.release;
              yield* ensureExperimentSetup(a);
              yield* slot.reacquire;
            }
            const physicalBody = body(slot, experimentSlot).pipe(Effect.as({ kind: "done" } as const));
            if (exclusiveSem === undefined) return yield* physicalBody;
            // 保持原来的物理资源获取顺序：exclusive provider → 全局位 → body。先还全局位
            // 再等 provider，避免一个已完成 sharedState/setup 协调、却仍在排 exclusive lane 的
            // attempt 饿死其它 provider；拿到 lane 后才回补全局位，Sandbox 与 body 因而仍在两把
            // permit 的保护中。中断时两个作用域各自归还自己实际持有的 permit。
            yield* slot.release;
            return yield* exclusiveSem.withPermits(1)(
              slot.reacquire.pipe(Effect.zipRight(physicalBody)),
            );
          }),
        );

        // 许可链的循环外壳:撞锁挂起的用例解决后从 ① 重新走一遍(实验闸名额与全局位都要
        // 重新取,不能拿着别人在等的名额干等)。
        const pipeline = Effect.gen(function* () {
          // Group predecessor has settled before this pipeline begins. A physical failure in
          // that predecessor therefore gates this still-queued slot before build, a provider
          // acquire, resource materialization, or a global dispatch permit.
          const unavailable = evalGroupUnavailableGateOf(a);
          if (unavailable?.stopped) {
            accountEvalGroupUnavailable(a, unavailable);
            return;
          }
          // ⓪ 逐 BuildKey 放行:只等本 eval 引用的那几个 key,不引用任何 key 的 attempt
          // 立刻进入许可链。等在这里不占全局并发位,慢构建因此不挡住同批别的 eval。
          yield* Effect.tryPromise({
            try: () => awaitBuildsFor(a),
            catch: (error) => error,
          });
          for (;;) {
            // ① 止损闸:落闸 → 本 attempt 不派发,计 unstarted(完成状态因此落 incomplete)。
            const halt = checkDispatchHalt(a);
            if (halt.halted) {
              cancelReuseAttempt(a);
              accountDispatchHalted(a, halt.gate);
              return;
            }
            // ② Invocation 内实验闸 → ③ 全局位 → sharedState / 生命周期协调 → Eval lock
            // → exclusive provider permit（如声明）→ body。
            const outcome = yield* withExperimentGate(a, dispatch);
            if (outcome.kind === "done") return;
            // 许可获取被落下的闸打断:许可已随作用域归还,回到 ① 让上面的检查点记账。
            if (outcome.kind === "recheck") continue;
            // ② ③ 已随作用域归还。挂起等锁:不占并发位、计入 elsewhere;锁释放或过期后
            // 按原优先级回到派发队列(下一轮循环)。
            yield* outcome.window;
          }
        });
        const waveReady = dispatchWaveReady.get(a) ?? Effect.void;
        const wavePipeline = waveReady.pipe(Effect.flatMap(() => pipeline));
        const predecessor = groupedPredecessors.get(a);
        const orderedPipeline = predecessor === undefined
          ? wavePipeline
          : predecessor.pipe(Effect.flatMap(() => wavePipeline));
        // 实验级 teardown / sharedState lease 结算:每个 attempt 收尾(含被 preflight 跳过、被中断的、被用例锁
        // 被 preflight 跳过、被中断的)都从身份集合移除；最后一个触发 ExperimentDef.teardown。ensuring
        // 在中断路径同样执行，重复 finalizer 也不会让状态下溢。
        const withExpLifecycle =
          !a.run.setup && !a.run.teardown && !a.run.sharedState
            ? orderedPipeline
            : orderedPipeline.pipe(
                Effect.ensuring(settleExperimentAttempt(a).pipe(Effect.orDie)),
              );
        // 用例锁释放:这个 key 的全部 attempt(真实派发的与被 late-carry 跳过的)都 settle 后
        // 删锁,与上面的实验级 teardown 计数同一种「逐 attempt 收尾时递减,归零触发」模式,
        // 挂在最外层确保晚于实验级 teardown 计数结算(docs「用例全部 attempt 收尾(含沙箱销毁)
        // 后删除自己的锁」)。
        const withCaseLifecycle = !caseState
          ? withExpLifecycle
          : withExpLifecycle.pipe(
              Effect.ensuring(releaseCaseLockIfDone(caseState, a.attempt)),
            );
        const withWaveLifecycle = withCaseLifecycle.pipe(
          Effect.ensuring(releaseBuildUsesFor(a)),
          Effect.ensuring(arriveAtDispatchWave),
        );
        if (predecessor === undefined) return withWaveLifecycle;
        const releaseSuccessor = groupedReleases.get(a)!;
        return withWaveLifecycle.pipe(Effect.ensuring(releaseSuccessor));
      },
      { concurrency: "unbounded", discard: true },
    ).pipe(
      // 中断(用户 Ctrl+C):finalizer 已在中断过程中跑完(容器已停),这里只是把它咽下,
      // 好让流程走到 summarize / onInvocationComplete,用已完成的 results 出一份部分汇总,而不是抛栈。
      // 判据是 `isInterruptedOnly` 而不是 `isInterrupted`:一条 fiber 的缺陷会连带中断兄弟 fiber,
      // 合成的 cause 里同时有 die 与 interrupt,`isInterrupted` 对它同样为真——按它咽下等于把
      // 真·缺陷的正文吞掉、冒充成用户中断(退出码 130),正是
      // memory/experiment-fatal-presented-as-user-interrupt.md 的现象。
      Effect.catchAllCause((cause) => {
        if (Cause.isInterruptedOnly(cause)) {
          interrupted = true;
          return Effect.void;
        }
        return Effect.failCause(cause); // 非中断的意外缺陷:照常抛出
      }),
    );
  const releaseBuildSources = Effect.tryPromise({
    try: async () => {
      const sources = new Set(runningBuilds?.sources.values() ?? []);
      await Promise.all([...sources].map((source) => source.release()));
    },
    catch: () => undefined,
  }).pipe(Effect.ignore);
  const exit = yield* Effect.exit(
    (opts.signal === undefined
      ? dispatchEffect
      : Effect.raceFirst(dispatchEffect, interruptOnAbort(opts.signal)))
      .pipe(Effect.ensuring(releaseBuildSources)),
  );
  // A full-carry / zero-Attempt invocation has no dispatch fiber that could
  // await startup recovery. Seal its selected-Experiment obligation here; for
  // normal runs the per-setup gate above has already awaited the same Deferred.
  const startupRecoveryExit = yield* Effect.exit(
    opts.signal === undefined
      ? Effect.forEach(startupRecoveryCompletionsToAwait, Deferred.await, {
          concurrency: "unbounded",
          discard: true,
        })
      : Effect.raceFirst(
          Effect.forEach(startupRecoveryCompletionsToAwait, Deferred.await, {
            concurrency: "unbounded",
            discard: true,
          }),
          interruptOnAbort(opts.signal),
        ),
  );
  // provenance 在这里齐全:没有任何 attempt 依赖的 key 也照样跑完并留下自己那条记录,
  // 中断路径下同批构建随 signal 收束成 cancelled,不把 run.json 的 sandboxBuilds 落空。
  if (runningBuilds !== undefined) {
    const completedBuilds = yield* Effect.tryPromise({
      try: () => runningBuilds.done,
      catch: (error) => error,
    });
    sandboxBuildRecords = [...completedBuilds.records];
  }
  // 复用污染线索:按实例 × 承接序号聚合本次 Run 真实跑出的结果(携带条目不参与——复用实验
  // 不消费也不产出结果沿用)。只指路,不改判定(见 reuse-diagnostics.ts)。
  for (const notice of detectReuseContamination(results)) {
    reportDiagnostic({
      key: `sandbox-reuse-contamination:${notice.experimentId ?? ""}:${notice.reuseSandbox}:${notice.phase}`,
      code: "sandbox-reuse-contamination",
      severity: "warning",
      message: reuseContaminationMessage(notice),
      data: {
        ...(notice.experimentId !== undefined ? { experimentId: notice.experimentId } : {}),
        reuseSandbox: notice.reuseSandbox,
        phase: notice.phase,
        fromOrdinal: notice.fromOrdinal,
        toOrdinal: notice.toOrdinal,
        count: notice.count,
      },
    });
  }

  // 实验级 teardown 兜底扫尾:正常路径由 per-attempt ensuring 的身份集合归零触发(见上),但一次
  // 真实批跑观察到过结算路径未触发的间歇现象(根因未定位,排查记录见 memory 的
  // experiment-teardown-missed-once-in-batch)。走到这里时 forEach 的全部 fiber 连同 finalizer
  // 都已结算,任何仍停在 Active 的实验都意味着泄漏;在此强制收尾并报警示诊断——
  // 扫尾幂等(cleanup 消费一次性),宁可多一道兜底,不把宿主机资源(隧道/容器)留给用户手拆。
  // 真·缺陷抛出前同样要扫(finalizer 语义,见 docs/feature/experiments/architecture.md
  // 「实验级生命周期」);cli 的 main().catch() 只兜沙箱,不知道实验级 cleanup 的存在。
  const sweepExperimentTeardowns = (): Effect.Effect<void, unknown> => Effect.forEach(
    [...expLifecycles],
    ([run, cell]) => cell.mutex.withPermits(1)(Effect.sync(() => {
      const state = cell.state;
      // 未触发、已完成均无事可扫；在飞的 teardown 仍须 await 同一个 completion。
      if (state._tag === "Dormant" || state._tag === "UntriggeredComplete" || state._tag === "TornDown") {
        return { _tag: "None" } as const;
      }
      if (state._tag === "Active" && run.teardown) {
        return { _tag: "Late", remaining: state.pendingAttempts.size } as const;
      }
      return { _tag: "Await" } as const;
    })).pipe(Effect.flatMap((action) => {
      if (action._tag === "None") return Effect.void;
      if (action._tag === "Late") {
        const experimentId = run.experimentId ?? run.agent.name;
        const message = t("runner.experimentTeardownLate", { experimentId }).trimEnd();
        return Effect.sync(() => {
          reportDiagnostic({
            key: `experiment-teardown-late:${experimentId}`,
            code: "experiment-teardown-late",
            severity: "warning",
            message,
            data: { experimentId, remaining: action.remaining },
          });
          recordExperimentDiagnostic({
            experimentId: run.experimentId,
            code: "experiment-teardown-late",
            level: "warning",
            message,
            phase: "experiment.teardown",
            data: { remaining: action.remaining },
          });
        }).pipe(Effect.zipRight(runExperimentTeardown(run, cell)));
      }
      return runExperimentTeardown(run, cell);
    })),
    { concurrency: 1, discard: true },
  );
  if (Exit.isFailure(exit)) {
    // Only a pure interruption becomes a partial interrupted Invocation. The
    // AbortSignal may have fired concurrently with a real failure/defect, but
    // must never relabel that Cause as a user interrupt or hide it behind 130.
    if (Cause.isInterruptedOnly(exit.cause)) {
      interrupted = true;
    } else {
      return yield* Effect.failCause(exit.cause).pipe(
        Effect.ensuring(sweepExperimentTeardowns().pipe(Effect.orDie)),
      );
    }
  }
  if (Exit.isFailure(startupRecoveryExit)) {
    if (Cause.isInterruptedOnly(startupRecoveryExit.cause)) {
      interrupted = true;
    } else {
      return yield* Effect.failCause(startupRecoveryExit.cause).pipe(
        Effect.ensuring(sweepExperimentTeardowns().pipe(Effect.orDie)),
      );
    }
  }
  if (interrupted) reportInterrupted();
  yield* sweepExperimentTeardowns();

  // Record publication is the intentionally narrow interruption mask. By this
  // point dispatch has stopped and its Scope/finalizers plus experiment
  // teardown have settled; only durable Run publication and the receipt remain.
  // The mask preserves typed writer failures, but this is not an Invocation
  // transaction: SIGINT publication freezes each Run independently, leaving
  // Runs with unsettled real Attempts incomplete while siblings may seal.
  const receipt = yield* Effect.uninterruptibleMask(() =>
    Effect.gen(function* () {
      // These diagnostics are already settled and keyed by exact Experiment /
      // AgentRun identity. Bind them only at the final Runner → Record
      // boundary; the invocation-wide Run timing tree deliberately remains
      // unbound because it cannot be safely attributed to individual Runs.
      for (const run of opts.agentRuns) {
        yield* bindRunnerRunObservabilityDiagnostics({
          run,
          diagnostics: experimentDiagnostics.get(run.experimentId) ?? [],
        });
      }
      const receiptCompletedAtMs = Date.now();
      const publishedRuns = yield* recordCoordinator.publish(
        receiptCompletedAtMs,
        interrupted ? "interrupted" : "normal",
      );
      return Object.freeze({
        invocationId: recordCoordinator.reusePlan.target.invocationId,
        runIds: Object.freeze(publishedRuns.map(({ runId }) => String(runId))),
        startedAt,
        completedAt: new Date(receiptCompletedAtMs).toISOString(),
        completion: interrupted ? "interrupted" : "completed",
      } satisfies InvocationReceipt);
    }),
  ).pipe(
    Effect.ensuring(
      Effect.forEach(caseClaimsAwaitingPublication, (claim) => claim.release.pipe(Effect.ignore), {
        concurrency: 1,
        discard: true,
      }),
    ),
  );

  // Experiment 收尾协议(docs/runner.md):每个真正出现在这次 Invocation 里的 experimentId
  // 各发一次 experiment:complete,携带它自己的 completedAt(真实 teardown 完成时刻,没有
  // teardown 或未触发时退回当前时刻)与实验域诊断累积器里attribute 给它的记录。全部
  // Experiment 此刻都已经收尾(sweepExperimentTeardowns 已经等过),严格早于下面的
  // invocation:summary——Record 已在上面封口；这个事件只给非持久化的 reporter 消费。
  const invocationExperimentIds = new Set(
    effectiveAgentRuns.map((r) => r.experimentId).filter((id): id is string => id !== undefined),
  );
  const runTimings = runTiming.finalize();
  for (const experimentId of invocationExperimentIds) {
    yield* emitReporterEvent(reporters, {
      type: "experiment:complete",
      experimentId,
      completedAt: experimentCompletedAt.get(experimentId) ?? new Date().toISOString(),
      // Only exact current Record readbacks appear in the invocation snapshot.
      reusedAttempts: reusedAttempts.filter((attempt) => attempt.target.experimentId === experimentId),
      diagnostics: experimentDiagnostics.get(experimentId) ?? [],
      // Run 级共享构建时间与 provenance:属于产出它们的 Run;携带条目不继承。
      ...(runTimings !== undefined ? { timings: runTimings } : {}),
      ...(sandboxBuildRecords.length > 0 ? { sandboxBuilds: sandboxBuildRecords } : {}),
      name: opts.config.name,
    });
  }

  // Stable fresh-result ordering is separate from Record readbacks, which retain
  // the planner's target order and are never coerced into EvalResult.
  const order = new Map(opts.evals.map((e, i) => [e.id, i]));
  results.sort(
    (a, b) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
      a.agent.localeCompare(b.agent) ||
      a.attempt - b.attempt,
  );

  const summary = summarize(results, reusedAttempts, startedAt, Date.now() - t0, opts.config.name);
  yield* emitReporterEvent(reporters, { type: "invocation:summary", summary });
  for (const reg of reporters) {
    // required reporter(显式 --junit)在这一步失败,不能中断其它
    // reporter 的收尾——继续跑完剩下的循环,让每个 reporter 都拿到 onInvocationComplete 的机会;
    // 失败本身经 runReporter → reportReporterError 折成诊断,由调用方(cli.ts)读取
    // RunFeedbackState 组装成 InvocationCompletion,让最终 completion/退出码判红(见
    // docs/feature/experiments/cli.md「运行完成状态不只看 verdict 计数」)。
    yield* runReporter(reg, "onInvocationComplete", () => reg.reporter.onInvocationComplete?.(summary));
  }
  return receipt;
  }));
}
