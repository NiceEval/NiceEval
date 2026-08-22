// Braintrust 报告器:把一次 niceeval 运行作为一个 Braintrust experiment 上报,
// 每个 attempt 一行(scores = 断言,metrics = 时长/token/成本),跨提交比较与团队共享。
// `braintrust` 是可选依赖:动态 import,装了才用得上,没装在 onInvocationStart 报错
// (reporter 错误按框架约定只记 diagnostic,不会让运行崩)。

import type { EvalResult, JsonValue, Reporter } from "../../types.ts";
import type {
  AssertionCoverage,
  AssertionEntryRead,
  AssertionLimitation,
  AssertionsProjection,
  ScoreContribution,
} from "../../assertions/record/model.ts";
import type { ScoreProjection } from "../../eval/record/score.ts";
/** Closed assessment rows; this reporter does not reopen Record. */
type AttemptSlotProjectedEntry<Value> =
  | { readonly state: "excluded" | "not-recorded" | "core-invalid" }
  | {
      readonly state: "attachment-result";
      readonly attachment:
        | { readonly state: "available"; readonly value: Value }
        | { readonly state: "unavailable" | "unsupported" | "invalid" }
        | {
            readonly state: "migration-required";
            readonly from: string;
            readonly to: string;
            readonly command?: string;
          };
    };
import type { Verdict } from "../../shared/types.ts";
import { reportActivity } from "../feedback/sink.ts";

export interface BraintrustConfig {
  /** Braintrust 项目名;省略时用 "niceeval"。 */
  project?: string;
  /** Braintrust 项目 id;与 project 给一个即可。 */
  projectId?: string;
  /** 实验名;省略时由 Braintrust 自动命名。 */
  experiment?: string;
  /** 作为对比基线(diff base)的既有实验名。 */
  baseExperiment?: string;
  /** 作为对比基线(diff base)的既有实验 id。 */
  baseExperimentId?: string;
  /** true = 更新同名既有实验,而不是新建一个。 */
  update?: boolean;
  /** 实验级附加 metadata;与 niceeval 自动写入的字段合并,同名以这里为准。 */
  metadata?: globalThis.Record<string, JsonValue>;
  /** API key;省略时 SDK 读 BRAINTRUST_API_KEY 环境变量。 */
  apiKey?: string;
}

/**
 * Braintrust SDK 的最小类型面。本地声明是为了不把 `braintrust` 变成编译期依赖;
 * 动态 import 后按这个形状断言。
 */
interface BraintrustSdk {
  // SDK 里 init 同步返回(登录与建实验都是惰性的);统一 await,同步/异步都兼容。
  init(options: {
    project?: string;
    projectId?: string;
    experiment?: string;
    baseExperiment?: string;
    baseExperimentId?: string;
    update?: boolean;
    apiKey?: string;
    metadata?: globalThis.Record<string, JsonValue>;
    setCurrent?: boolean;
  }): BraintrustExperiment | Promise<BraintrustExperiment>;
  flush(): Promise<void>;
}

interface BraintrustExperiment {
  log(event: BraintrustLogEvent): void;
  summarize(): Promise<{ experimentUrl?: string }>;
}

export interface BraintrustLogEvent {
  id?: string;
  input?: string;
  output?: string;
  error?: EvalResult["error"];
  scores?: globalThis.Record<string, number>;
  metadata?: globalThis.Record<string, JsonValue>;
  metrics?: globalThis.Record<string, number>;
}

/**
 * A post-Record Projection calculation supplies this optional assessment. The
 * live Reporter callback currently has no RecordProjection input, so its
 * absence is represented explicitly rather than as a made-up Attachment read.
 */
export type BraintrustAssessment =
  | {
      readonly state: "projected";
      /** Exact Report-style public projections, including every data state. */
      readonly assertions: AttemptSlotProjectedEntry<AssertionsProjection<unknown>>;
      readonly verdict: AttemptSlotProjectedEntry<Verdict>;
      readonly score?: AttemptSlotProjectedEntry<ScoreProjection>;
    }
  | {
      readonly state: "not-projected";
      readonly reason: "reporter-contract-does-not-provide-record-projections";
    };

const NOT_PROJECTED_ASSESSMENT: BraintrustAssessment = Object.freeze({
  state: "not-projected" as const,
  reason: "reporter-contract-does-not-provide-record-projections" as const,
});

/**
 * 创建 Braintrust 报告器。挂在 `defineConfig({ reporters })` 上观测整次运行,
 * 或挂在单个 eval 的 `reporters` 上只观测它(同一实例被多个 eval 引用时共享一个实验)。
 */
export function Braintrust(config: BraintrustConfig = {}): Reporter {
  let sdk: BraintrustSdk | undefined;
  let experiment: BraintrustExperiment | undefined;

  return {
    async onInvocationStart(evals) {
      sdk = await loadBraintrustSdk();
      experiment = await sdk.init({
        project: config.projectId ? undefined : (config.project ?? "niceeval"),
        projectId: config.projectId,
        experiment: config.experiment,
        baseExperiment: config.baseExperiment,
        baseExperimentId: config.baseExperimentId,
        update: config.update,
        apiKey: config.apiKey,
        // 不再写顶层单一 agent:一次 Invocation 可能横跨多个 (agent, model, flags) 配置,
        // 启动时还没有任何结果,写一个必然只代表其中一份配置的值就是撒谎(见
        // docs/runner.md「Reporter 与运行器事件」)。每行自己的 agent 身份仍在
        // toBraintrustEvent() 的 metadata.agent 里,逐 attempt 精确;跨行的 agent 集合可以
        // 从 Braintrust 自己按 metadata.agent 分组得到,不需要实验级再存一份。
        metadata: {
          evals: evals.map((e) => e.id),
          ...config.metadata,
        },
        // 不设为全局 current experiment,避免污染用户代码里的 braintrust 全局态。
        setCurrent: false,
      });
    },

    onEvalComplete(result) {
      experiment?.log(toBraintrustEvent(result, NOT_PROJECTED_ASSESSMENT));
    },

    async onInvocationComplete() {
      if (!experiment) return;
      try {
        await sdk?.flush();
        const summary = await experiment.summarize();
        if (summary.experimentUrl) {
          reportActivity(`Braintrust experiment: ${summary.experimentUrl}`);
        }
      } finally {
        experiment = undefined;
        sdk = undefined;
      }
    },
  };
}

/**
 * EvalResult identity/transport data plus an optional post-Record assessment
 * become one Braintrust row. Assertions, Verdict, and Score only enter through
 * that assessment's public Attachment projections; this function never reads
 * a historical result graph.
 */
export function toBraintrustEvent(
  result: EvalResult,
  assessment: BraintrustAssessment = NOT_PROJECTED_ASSESSMENT,
): BraintrustLogEvent {
  const projectedVerdict = assessment.state === "projected"
    ? availableProjectionValue(assessment.verdict)
    : undefined;
  const verdict = projectedVerdict ?? result.verdict;

  const metrics: globalThis.Record<string, number> = {};
  if (result.startedAt) {
    const start = Date.parse(result.startedAt) / 1000;
    if (Number.isFinite(start)) {
      metrics.start = start;
      metrics.end = start + result.durationMs / 1000;
    }
  }
  if (result.usage) {
    const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, reasoningTokens, requests } = result.usage;
    if (inputTokens !== undefined) metrics.prompt_tokens = inputTokens;
    if (outputTokens !== undefined) metrics.completion_tokens = outputTokens;
    if (inputTokens !== undefined && outputTokens !== undefined) metrics.tokens = inputTokens + outputTokens;
    if (cacheReadTokens !== undefined) metrics.cache_read_tokens = cacheReadTokens;
    if (cacheCreationTokens !== undefined) metrics.cache_creation_tokens = cacheCreationTokens;
    if (reasoningTokens !== undefined) metrics.reasoning_tokens = reasoningTokens;
    if (requests !== undefined) metrics.requests = requests;
  }
  // estimated_cost_usd 恒为价目表估算(EvalResult.estimatedCostUSD,见 estimateCost);
  // observed 成本单独留在 result.usage.costUSD,不混入本指标。
  if (result.estimatedCostUSD !== undefined) metrics.estimated_cost_usd = result.estimatedCostUSD;

  const metadata: globalThis.Record<string, JsonValue> = {
    eval: result.id,
    agent: result.agent,
    attempt: result.attempt,
    verdict,
    status: verdict,
    evaluationAlgorithm: result.evaluationAlgorithm,
    evaluationKind: result.evaluationKind,
    assessmentProjection: assessment.state,
  };
  const scores: globalThis.Record<string, number> = {};
  if (assessment.state === "projected") {
    metadata.assertions = projectionMetadata(
      assessment.assertions,
      (assertions) => ({ entries: assertionMetadata(assertions.entries) }),
    );
    metadata.verdictProjection = projectionMetadata(
      assessment.verdict,
      (value) => ({ value }),
    );
    if (assessment.score !== undefined) {
      metadata.score = projectionMetadata(assessment.score, scoreMetadata);
      const score = availableProjectionValue(assessment.score);
      if (score?.state === "complete") scores["niceeval:score"] = score.earned;
    }
  } else {
    metadata.assessmentProjectionReason = assessment.reason;
  }
  if (result.model !== undefined) metadata.model = result.model;
  if (result.experimentId !== undefined) metadata.experiment = result.experimentId;
  if (result.experiment?.flags && Object.keys(result.experiment.flags).length > 0) {
    metadata.flags = result.experiment.flags;
  }
  if (result.skipReason !== undefined) metadata.skipReason = result.skipReason;
  // 一次运行内 (experiment, eval, agent, model, attempt) 唯一;Braintrust 按 id 合并重复行。
  const id = [result.experimentId ?? "", result.id, result.agent, result.model ?? "", `a${result.attempt}`].join("|");

  return {
    id,
    input: result.description ?? result.id,
    output: lastAssistantText(result.events),
    error: result.error,
    metadata,
    metrics,
    ...(Object.keys(scores).length > 0 ? { scores } : {}),
  };
}

function availableProjectionValue<Value>(
  entry: AttemptSlotProjectedEntry<Value>,
): Value | undefined {
  return entry.state === "attachment-result" && entry.attachment.state === "available"
    ? entry.attachment.value
    : undefined;
}

function projectionMetadata<Value>(
  entry: AttemptSlotProjectedEntry<Value>,
  available: (value: Value) => globalThis.Record<string, JsonValue>,
): JsonValue {
  if (entry.state !== "attachment-result") {
    return { state: entry.state };
  }
  switch (entry.attachment.state) {
    case "available":
      return { state: "available", ...available(entry.attachment.value) };
    case "unavailable":
      return { state: "unavailable" };
    case "migration-required":
      return {
        state: "migration-required",
        from: entry.attachment.from,
        to: entry.attachment.to,
        ...(entry.attachment.command === undefined ? {} : { command: entry.attachment.command }),
      };
    case "unsupported":
    case "invalid":
      return { state: entry.attachment.state };
  }
}

function assertionMetadata(entries: readonly AssertionEntryRead<unknown>[]): JsonValue {
  const metadata: JsonValue[] = [];
  for (const entry of entries) {
    const display = entry.entry.display;
    const decision = entry.entry.decision;
    const item: globalThis.Record<string, JsonValue> = {
      entryId: entry.entry.entryId,
      groupPath: [...display.groupPath],
      outcome: entry.state === "available" ? decision.result : entry.state,
      coverage: coverageMetadata(entry.entry.materials.coverage),
      limitations: entry.entry.materials.limitations.map(limitationMetadata),
      scoreContribution: scoreContributionMetadata(entry.entry.contribution),
    };
    if (display.label !== undefined) item.label = display.label;
    if (display.key !== undefined) item.key = display.key;
    const reason = assertionReason(entry);
    if (reason !== undefined) item.reason = reason;
    metadata.push(item);
  }
  return metadata;
}

function assertionReason(entry: AssertionEntryRead<unknown>): string | undefined {
  if (entry.state !== "available") return entry.reason;
  switch (entry.entry.decision.result) {
    case "matched":
      return undefined;
    case "mismatched":
    case "unavailable":
    case "errored":
    case "not-applicable":
      return entry.entry.decision.reason ?? undefined;
  }
}

function coverageMetadata(
  coverage: AssertionCoverage,
): globalThis.Record<string, JsonValue> {
  const metadata: globalThis.Record<string, JsonValue> = { state: coverage.state };
  if (coverage.state !== "complete") metadata.reason = coverage.reason;
  return metadata;
}

function limitationMetadata(
  limitation: AssertionLimitation,
): globalThis.Record<string, JsonValue> {
  switch (limitation.kind) {
    case "redacted":
      return { kind: limitation.kind, fieldCount: limitation.fieldCount };
    case "sampled":
      return {
        kind: limitation.kind,
        captured: limitation.captured,
        ...(limitation.knownTotal === undefined ? {} : { knownTotal: limitation.knownTotal }),
      };
    case "truncated":
      return { kind: limitation.kind, omittedBytes: limitation.omittedBytes };
    case "provider-limited":
      return { kind: limitation.kind };
  }
}

function scoreContributionMetadata(
  contribution: ScoreContribution,
): globalThis.Record<string, JsonValue> {
  switch (contribution.state) {
    case "not-scored":
      return { state: contribution.state };
    case "earned":
      return {
        state: contribution.state,
        points: contribution.points,
        earned: contribution.earned,
      };
    case "unavailable":
      return {
        state: contribution.state,
        points: contribution.points,
        reason: contribution.reason,
      };
  }
}

function scoreMetadata(score: ScoreProjection): globalThis.Record<string, JsonValue> {
  switch (score.state) {
    case "complete":
      return { state: score.state, earned: score.earned, comparable: score.comparable };
    case "partial":
      return {
        state: score.state,
        earned: score.earned,
        reasons: [...score.reasons],
        comparable: score.comparable,
      };
    case "unavailable":
      return {
        state: score.state,
        reasons: [...score.reasons],
        comparable: score.comparable,
      };
  }
}

/** agent 的最终回复文本(事件流里最后一条 assistant message);没有就不填。 */
function lastAssistantText(events: EvalResult["events"]): string | undefined {
  if (!events) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "message" && e.role === "assistant") return e.text;
  }
  return undefined;
}

/** 动态 import 说明:specifier 放变量里,`braintrust` 不进编译期依赖,没装也能 typecheck。 */
const BRAINTRUST_PACKAGE = "braintrust";

async function loadBraintrustSdk(): Promise<BraintrustSdk> {
  try {
    return (await import(BRAINTRUST_PACKAGE)) as unknown as BraintrustSdk;
  } catch {
    throw new Error(
      "The 'braintrust' package is required for the Braintrust reporter but was not found. Install it with: npm install braintrust (and set BRAINTRUST_API_KEY).",
    );
  }
}
