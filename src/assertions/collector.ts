// 断言收集器:test 期间记录断言(值断言就地、作用域断言延迟),test 结束后对完整运行
// 结果(AssertionEvaluationContext)统一 finalize 成 AssertionResult[],再交判定。

import type { AssertionResult, ScoreEntry, AssertionEvaluationContext, Severity, SourceLoc } from "../types.ts";
import { captureLoc } from "../source-loc.ts";
import { t } from "../i18n/index.ts";
import { EvalRequirementFailed } from "../context/control-flow.ts";
import {
  externalCauseText,
  normalizeExternalCause,
  type ExternalCause,
} from "../shared/external-cause.ts";

export interface EvalScore {
  score: number;
  detail?: string;
  /** 期望条件的有界文本预览(如 `contains "Brooklyn"`),失败时供 show/view 直接展示。 */
  expected?: string;
  /** 实际值的有界文本预览(被检查值 / 作用域内实际调用清单)。 */
  received?: string;
  /** 这条分数是看着什么材料算出来的(judge 收到的输入等);供 view 展开排查「为什么是这个分」。 */
  evidence?: string;
  /**
   * 仅供旧 Autoevals Judge bridge 传递的有界模型理由。它不是作者 API，也不能由 evidence
   * 推导或替代。
   */
  rationale?: string;
}

/** evaluate 返回它表示「这条断言评不了」:证据通道不完整 / judge 未解析到模型等。 */
export interface EvalUnavailable {
  unavailable: true;
  /** 机器可读原因,如 "judge-model-unresolved"、"evidence-coverage:actions=partial"。 */
  reason: string;
  /** 证据通道的状态或异常摘要；没有可用分数时仍保留排障线索。 */
  evidence?: string;
}

/** 目前会影响 Attempt 判定的证据通道。OTLP 只服务可选观测，不登记在这里。 */
export type EvidenceChannel = "diff";

/** Assertion collector 在采集前给 Runner 的证据需求快照。 */
export interface EvidenceRequirementSnapshot {
  readonly diff: {
    /** 是否存在非 optional 消费者，或作者直接读取了 diff 视图。 */
    readonly required: boolean;
    /** 仅 optional 的消费者数；供诊断/测试解释，不决定 verdict。 */
    readonly optionalConsumers: number;
    /** 非 optional 的显式 diff 断言数。 */
    readonly requiredConsumers: number;
    /** 普通表达式直接读取 `t.sandbox.diff` 的次数。 */
    readonly directReads: number;
  };
}

/** 构造 EvalUnavailable 的便捷工厂(scoped / judge 断言用)。 */
export function unavailable(reason: string, evidence?: string): EvalUnavailable {
  return { unavailable: true, reason, ...(evidence !== undefined ? { evidence } : {}) };
}

function isUnavailable(v: unknown): v is EvalUnavailable {
  return typeof v === "object" && v !== null && (v as EvalUnavailable).unavailable === true;
}

/** 一条尚未评估的断言。evaluate 在 finalize 时拿到完整运行结果再算分 [0,1](或报告评不了)。 */
export interface Spec {
  name: string;
  severity: Severity;
  threshold?: number;
  /** 作者链过 `.stopOnFailure()`；只控制 test() 是否继续，不改变 severity。 */
  stopOnFailure?: true;
  /** 作者用 .optional() 显式允许该断言证据缺席;unavailable 只保留在记录里,不影响判定。 */
  optional?: true;
  detail?: string;
  /**
   * 判分断言(t.judge.autoevals.*)。只有它带的求值要发一次裁判模型请求,是 finalize 期间
   * 唯一可能长时间等待的一类;live 面板的判分推进按它逐条上报(见 finalize 的 onJudgeProgress)。
   */
  judge?: true;
  /** 所属分组路径(外层在前的 t.group 标题数组)。纯组织用,不影响打分。 */
  groupPath?: string[];
  /** 断言在 eval 源码里的调用点(record 时栈回溯抠出)。 */
  loc?: SourceLoc;
  /** 该断言消费的证据通道；optional 的最终语义仍由 `optional` 字段决定。 */
  evidence?: EvidenceChannel;
  /** collector 在 record 时分配的 attempt 级发生顺序。 */
  sourceOrder?: number;
  /**
   * `.points(n)` 挂在这条断言上的挣分权重(仅计分制 eval 的 `t` 类型上可链):`n × score`。
   * 运行时对全部 eval 一视同仁地记录(不需要按题型守护,见 docs/feature/experiments/score-points.md);
   * 通过制 eval 的 `AssertionHandle` 类型上没有 `.points()`,作者写不出来,这里只是同一个宽 Spec
   * 的可选字段。
   */
  points?: number;
  /** stopOnFailure 断言就地求值的结果快照；finalize 直接复用，不再求值一次。 */
  settled?:
    | { kind: "value"; value: number | EvalScore | EvalUnavailable }
    | { kind: "error"; cause: ExternalCause };
  evaluate(ctx: AssertionEvaluationContext): number | EvalScore | EvalUnavailable | Promise<number | EvalScore | EvalUnavailable>;
}

/** 作者拿到的可链式句柄,改严重度 / 阈值 / optional / 计分权重(回头改 spec)。 */
export interface RecordHandle {
  atLeast(threshold: number): RecordHandle;
  gate(threshold?: number): RecordHandle;
  stopOnFailure(): Promise<RecordHandle>;
  /** 降级为纯记录的 soft:不设线,分数照实落盘、永不 fail(judge 的默认严重度就是它)。无参数——要设线用 .atLeast(x)。 */
  soft(): RecordHandle;
  optional(): RecordHandle;
  /** 挂计分权重:`n` 必须是正有限数,非法值立即抛错(不是记一条失败断言)。 */
  points(n: number): RecordHandle;
}

export interface CollectorOptions {
  /**
   * 题型(默认通过制)。计分制下 matcher 自带的默认 gate 只贡献通过线；作者在断言句柄上
   * 显式链 `.gate()` 才是硬要求。两种题型是否中止都只由 `.stopOnFailure()` 决定。
   */
  evaluationKind?: "pass" | "score";
  /**
   * stopOnFailure 断言就地求值时看的实时运行结果(events/diff/沙箱等)。生产 Context 必传；
   * 省略时调用 `.stopOnFailure()` 会报内部接线错误。
   */
  liveContext?: () => Promise<AssertionEvaluationContext>;
  /** 与 SessionManager 共用的 attempt 级序号分配器；直接构造 collector 时使用自身序列。 */
  nextSourceOrder?: () => number;
}

/** 一条判分断言开始求值时的推进快照(见 FinalizeOptions.onJudgeProgress)。 */
export interface JudgeProgress {
  /** 正在评第几条(从 1 起)。 */
  index: number;
  /** 这次 finalize 要评的判分断言总数。 */
  total: number;
  /** 检查方式摘要,如 `closedQA("…")`;与落盘的 detail 同一份文本。 */
  check: string;
}

export interface FinalizeOptions {
  includePoints?: boolean;
  /**
   * 每条判分断言**求值开始前**回调一次;非判分断言不回调,没有判分断言时一次都不回调。
   * 纯反馈通道(runner 把它接到 active 行 detail),不进 AssertionResult、不落盘。
   */
  onJudgeProgress?: (progress: JudgeProgress) => void;
}

/** 前置未过时截断到哪里:该前置本身保留,它之后记录的断言与给分记录一律丢弃。 */
interface AbortPoint {
  specCount: number;
  entryCount: number;
  name: string;
}

export class AssertionCollector {
  private readonly specs: Spec[] = [];
  private readonly groupStack: string[] = [];
  private readonly entries: ScoreEntry[] = [];
  private readonly evaluationKind: "pass" | "score";
  private readonly liveContext: (() => Promise<AssertionEvaluationContext>) | undefined;
  private localSourceOrder = 0;
  private readonly nextSourceOrder: () => number;
  /** 待结算的 stopOnFailure 求值(按调用顺序)；runner 收尾也会兜底结算未 await 的调用。 */
  private pending: Promise<AbortPoint | undefined>[] = [];
  private aborted: AbortPoint | undefined;
  /** 普通表达式读取 `t.sandbox.diff` 时记账；任意值流无法可靠绑定回某条 Spec。 */
  private directDiffReads = 0;
  private readonly unavailableEvidence = new Map<EvidenceChannel, string>();

  constructor(options: CollectorOptions = {}) {
    this.evaluationKind = options.evaluationKind ?? "pass";
    this.liveContext = options.liveContext;
    this.nextSourceOrder = options.nextSourceOrder ?? (() => ++this.localSourceOrder);
  }

  get hasEntries(): boolean {
    return this.specs.length > 0;
  }

  /** 记录作者直接读取 diff 视图；这类读取无法从任意值流静态反推 optional。 */
  requireEvidence(channel: EvidenceChannel): void {
    if (channel === "diff") this.directDiffReads++;
  }

  /** 采集失败后冻结证据通道的 unavailable 原因，finalize 会为对应 Spec 产出 unavailable。 */
  markEvidenceUnavailable(channel: EvidenceChannel, reason: string): void {
    this.unavailableEvidence.set(channel, reason);
  }

  evidenceRequirementSnapshot(): EvidenceRequirementSnapshot {
    let requiredConsumers = 0;
    let optionalConsumers = 0;
    for (const spec of this.specs) {
      if (spec.evidence !== "diff") continue;
      if (spec.optional === true) optionalConsumers++;
      else requiredConsumers++;
    }
    return {
      diff: {
        required: this.directDiffReads > 0 || requiredConsumers > 0,
        optionalConsumers,
        requiredConsumers,
        directReads: this.directDiffReads,
      },
    };
  }

  /** 别名供 Runner/测试按“需求快照”语义读取，避免消费方依赖内部字段。 */
  evidenceRequirements(): EvidenceRequirementSnapshot {
    return this.evidenceRequirementSnapshot();
  }

  /** `t.score(label, n)` 的直接给分:立即记录(不像断言那样要等 finalize 求值),n 必须非负有限数。 */
  score(label: string, points: number): void {
    if (!Number.isFinite(points) || points < 0) {
      throw new Error(t("assertions.scoreInvalid", { label, n: points }));
    }
    this.entries.push({
      label,
      points,
      sourceOrder: this.nextSourceOrder(),
      ...(this.groupStack.length > 0 ? { groupPath: this.groupStack.slice() } : {}),
      loc: captureLoc(),
    });
  }

  /** `t.score(...)` 记录的快照,供 finalize 时随 EvalResult 落盘;数组顺序 = 调用顺序。 */
  get scoreEntries(): ScoreEntry[] {
    return this.entries.slice();
  }

  /** t.group(title, fn) 期间入栈;栈内 record 的断言都打上当前分组路径(嵌套时外层在前)。 */
  async withGroup<T>(title: string, fn: () => Promise<T> | T): Promise<T> {
    this.groupStack.push(title);
    try {
      return await fn();
    } finally {
      this.groupStack.pop();
    }
  }

  record(spec: Spec): RecordHandle {
    if (spec.groupPath === undefined && this.groupStack.length > 0) {
      spec.groupPath = this.groupStack.slice();
    }
    if (spec.loc === undefined) spec.loc = captureLoc();
    if (spec.sourceOrder === undefined) spec.sourceOrder = this.nextSourceOrder();
    // 计分制的未链句柄角色是观测：matcher 自带的 gate 只贡献通过线。作者随后在句柄上
    // 显式 `.gate()` 时会再把 severity 改回 gate；`.stopOnFailure()` 与这里完全正交。
    if (this.evaluationKind === "score" && spec.severity === "gate") {
      spec.severity = "soft";
      spec.threshold = spec.threshold ?? 1;
    }
    this.specs.push(spec);
    // 该断言之前的记录量:这条一旦成为未过的前置,就截断回这里(它自己保留)。
    const before = { specCount: this.specs.length, entryCount: this.entries.length };
    const collector = this;
    const handle: RecordHandle = {
      atLeast(threshold) {
        spec.severity = "soft";
        spec.threshold = threshold;
        return handle;
      },
      gate(threshold) {
        spec.severity = "gate";
        spec.threshold = threshold;
        return handle;
      },
      stopOnFailure() {
        if (spec.severity !== "gate" && spec.threshold === undefined) {
          throw new Error(
            ".stopOnFailure() requires a passing line; chain .gate() or .atLeast(threshold), or use an assertion with a default threshold",
          );
        }
        if (spec.stopOnFailure !== true) {
          spec.stopOnFailure = true;
          collector.armStopOnFailure(spec, before);
        }
        const settling = collector.settleStopOnFailure(handle);
        // 作者可以故意不 await，让 Runner 在下一个异步边界或 test() 收尾统一结算。
        // 先挂一个观察者避免这条受支持路径被宿主报告成 unhandled rejection；返回的原
        // Promise 仍保持 reject 语义，显式 await 时照常就地抛 EvalRequirementFailed。
        void settling.catch(() => {});
        return settling;
      },
      soft() {
        spec.severity = "soft";
        spec.threshold = undefined;
        return handle;
      },
      optional() {
        spec.optional = true;
        return handle;
      },
      points(n) {
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(t("assertions.pointsInvalid", { n }));
        }
        spec.points = n;
        return handle;
      },
    };
    return handle;
  }

  /**
   * stopOnFailure 断言在调用位置开始求值，结论冻结在这里；后续事件或文件变化不改判。
   * pending 既让显式 await 当场收到控制流信号，也让下一个异步 t.* 与 runner 收尾兜底结算。
   */
  private armStopOnFailure(spec: Spec, before: { specCount: number; entryCount: number }): void {
    const live = this.liveContext;
    if (live === undefined) {
      throw new Error(".stopOnFailure() requires an AssertionCollector liveContext");
    }
    const severity = spec.severity;
    const threshold = spec.threshold;
    this.pending.push(
      (async (): Promise<AbortPoint | undefined> => {
        try {
          const raw = await spec.evaluate(await live());
          spec.settled = { kind: "value", value: raw };
          // unavailable 不是 failed；非 optional 会在 Verdict 阶段把 Attempt 判为 errored。
          if (isUnavailable(raw)) return undefined;
          const score = typeof raw === "number" ? raw : raw.score;
          return computePassed(severity, threshold, score) ? undefined : { ...before, name: spec.name };
        } catch (error) {
          // 与 finalize 同口径：求值异常落为 score 0 的 failed AssertionResult，并触发停止。
          spec.settled = { kind: "error", cause: normalizeExternalCause(error) };
          return { ...before, name: spec.name };
        }
      })(),
    );
  }

  /** 显式 await `.stopOnFailure()` 的路径：通过返回原句柄，失败抛既有非错误控制流信号。 */
  private async settleStopOnFailure(handle: RecordHandle): Promise<RecordHandle> {
    const aborted = await this.settlePrerequisites();
    if (aborted !== undefined) throw new EvalRequirementFailed(aborted);
    return handle;
  }

  /**
   * 结算待决 stopOnFailure。返回首条 failed 断言名(调用方据此抛中止信号),没有则 undefined。
   * 一旦中止过就一直返回同一个名字——后续每个 `t.*` 入口都会再抛一次,直到 test() 退出。
   */
  async settlePrerequisites(): Promise<string | undefined> {
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      for (const task of batch) {
        const failure = await task;
        if (failure !== undefined && this.aborted === undefined) this.aborted = failure;
      }
    }
    if (this.aborted === undefined) return undefined;
    // 中止后写下的断言与给分记录一律丢弃:作者写不写 await 都得到同一份结果
    // (不 await 时后续同步调用仍会记录,这里统一截断回中止点)。
    this.specs.length = Math.min(this.specs.length, this.aborted.specCount);
    this.entries.length = Math.min(this.entries.length, this.aborted.entryCount);
    return this.aborted.name;
  }

  async finalize(ctx: AssertionEvaluationContext, options: FinalizeOptions = {}): Promise<AssertionResult[]> {
    const out: AssertionResult[] = [];
    const judgeTotal = this.specs.filter((s) => s.judge === true).length;
    let judgeIndex = 0;
    for (const spec of this.specs) {
      // 判分推进只是给运行反馈看的短命信号:求值开始前报一次,不进 AssertionResult、不落盘。
      if (spec.judge === true) {
        judgeIndex++;
        options.onJudgeProgress?.({ index: judgeIndex, total: judgeTotal, check: spec.detail ?? spec.name });
      }
      const base = {
        name: spec.name,
        severity: spec.severity,
        ...(spec.stopOnFailure ? { stopOnFailure: true as const } : {}),
        ...(spec.optional ? { optional: true as const } : {}),
        ...(spec.detail !== undefined ? { detail: spec.detail } : {}),
        ...(spec.groupPath !== undefined ? { groupPath: spec.groupPath } : {}),
        ...(spec.loc !== undefined ? { loc: spec.loc } : {}),
        ...(spec.sourceOrder !== undefined ? { sourceOrder: spec.sourceOrder } : {}),
        ...(options.includePoints !== false && spec.points !== undefined
          ? { pointsAvailable: spec.points }
          : {}),
      };
      let score = 0;
      let detail = spec.detail;
      let expected: string | undefined;
      let received: string | undefined;
      let evidence: string | undefined;
      try {
        const unavailableReason = spec.evidence === undefined ? undefined : this.unavailableEvidence.get(spec.evidence);
        if (unavailableReason !== undefined) {
          out.push({
            ...base,
            outcome: "unavailable",
            reason: unavailableReason,
          });
          continue;
        }
        // stopOnFailure 已在链的位置就地求值过，直接用快照；之后发生的事不改变结论。
        if (spec.settled?.kind === "error") {
          detail = evaluationErrorDetail(detail, spec.settled.cause);
        } else {
          const raw = spec.settled?.kind === "value" ? spec.settled.value : await spec.evaluate(ctx);
          if (isUnavailable(raw)) {
            out.push({
              ...base,
              outcome: "unavailable",
              reason: raw.reason,
              ...(raw.evidence !== undefined ? { evidence: raw.evidence } : {}),
            });
            continue;
          }
          if (typeof raw === "number") {
            score = raw;
          } else {
            score = raw.score;
            if (raw.detail) detail = detail ? `${detail}; ${raw.detail}` : raw.detail;
            expected = raw.expected;
            received = raw.received;
            evidence = raw.evidence;
          }
        }
      } catch (e) {
        score = 0;
        detail = evaluationErrorDetail(detail, normalizeExternalCause(e));
      }
      const passed = computePassed(spec.severity, spec.threshold, score);
      out.push({
        ...base,
        ...(detail !== undefined ? { detail } : {}),
        outcome: passed ? "passed" : "failed",
        score,
        ...(spec.threshold !== undefined ? { threshold: spec.threshold } : {}),
        ...(expected !== undefined ? { expected } : {}),
        ...(received !== undefined ? { received } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
        // .points(n) 挂了才有:0/1 断言通过挣 n、不过挣 0;打分断言按连续分比例挣 n × score。
        // 求值抛错时 score 已经归零(见上面的 catch),points 自然也归零,不需要再判一次。
        ...(options.includePoints !== false && spec.points !== undefined ? { points: spec.points * score } : {}),
      });
    }
    return out;
  }
}

function evaluationErrorDetail(detail: string | undefined, cause: ExternalCause): string {
  return `${detail ? detail + "; " : ""}${t("assertions.evaluationError", {
    error: externalCauseText(cause),
  })}`;
}

export function computePassed(severity: Severity, threshold: number | undefined, score: number): boolean {
  if (severity === "gate") return threshold === undefined ? score >= 1 : score >= threshold;
  return threshold === undefined ? true : score >= threshold;
}

// ── Fact/use collector ────────────────────────────────────────────────────
//
// The legacy collector types above remain private scaffolding for historic
// Judge handles while the public `t` surface moves to Facts. Keeping the
// adapter isolated here lets assertions/judge.ts retain its public handle and
// network behaviour without turning Judge into a general-purpose Fact
// producer.

import type {
  AttemptFactIssue,
  ErrorAttemptIssue,
  AttemptFactTrace,
  BooleanFact,
  EvaluationFactError,
  EvaluationFactResult,
  FactPhase,
  FactUseOptions,
  LegacyJudgeAssertionResult,
  LegacyJudgePolicy,
  ScoreCompletion,
  ScoreFact,
  ScoreFactAttemptOutcome,
  ScoreFactUseResult,
  ScoreThresholdOptions,
  UsageEvidenceFact,
  VerdictFactUseResult,
} from "./types.ts";

type FactRuntimeOutcome =
  | {
      readonly outcome: "passed" | "failed";
      /** Boolean Fact witness returned by `require()` after a successful evaluation. */
      readonly value?: unknown;
      readonly expected?: string;
      readonly received?: string;
      readonly evidence?: string;
    }
  | {
      readonly outcome: "scored";
      readonly normalizedScore: number;
      readonly expected?: string;
      readonly received?: string;
      readonly evidence?: string;
      readonly rationale?: string;
    }
  | {
      readonly outcome: "unavailable";
      readonly reason: string;
      readonly evidence?: string;
      /**
       * Core-only provenance: this absence was declared by the Agent at
       * creation time, rather than caused by a later truncation or transport
       * downgrade. `assertIfCovered()` is the sole consumer allowed to turn
       * precisely this case into notApplicable.
       */
      readonly usageUnavailableAtCreation?: true;
    }
  | { readonly outcome: "errored"; readonly error: EvaluationFactError };

export type BooleanFactEvaluation = Extract<FactRuntimeOutcome, { readonly outcome: "passed" | "failed" | "unavailable" | "errored" }>;
export type ScoreFactEvaluation = Extract<FactRuntimeOutcome, { readonly outcome: "scored" | "unavailable" | "errored" }>;

export interface FactDefinition<R, P extends FactPhase> {
  readonly name: string;
  readonly phase: P;
  readonly value: R;
  readonly evaluate: (context: AssertionEvaluationContext) => Promise<BooleanFactEvaluation> | BooleanFactEvaluation;
  readonly dependencyFacts?: readonly (BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>)[];
  readonly usageEvidence?: boolean;
  readonly evidence?: EvidenceChannel;
}

export interface ScoreFactDefinition<P extends FactPhase> {
  readonly name: string;
  readonly phase: P;
  readonly evaluate: (context: AssertionEvaluationContext) => Promise<ScoreFactEvaluation> | ScoreFactEvaluation;
  readonly dependencyFacts?: readonly (BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>)[];
  readonly evidence?: EvidenceChannel;
}

interface FactNode {
  readonly fact: object;
  readonly id: string;
  readonly name: string;
  readonly kind: "boolean" | "score";
  readonly phase: FactPhase;
  value: unknown;
  readonly producerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
  readonly groupPath?: readonly string[];
  readonly dependencies: readonly FactNode[];
  readonly usageEvidence: boolean;
  /** Set only from the structured evaluator provenance above, never a reason string. */
  usageUnavailableAtCreation: boolean;
  readonly evidence?: EvidenceChannel;
  readonly evaluate: (context: AssertionEvaluationContext) => Promise<FactRuntimeOutcome>;
  result: EvaluationFactResult | undefined;
  evaluating: Promise<EvaluationFactResult> | undefined;
}

interface VerdictUseNode {
  readonly kind: "verdict";
  readonly node: FactNode;
  readonly method: "assert" | "require" | "assertIfCovered";
  readonly label?: string;
  readonly key: string | undefined;
  readonly atLeast?: number;
  readonly consumerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
}

interface FactScoreUseNode {
  readonly kind: "score";
  readonly input: "fact";
  readonly node: FactNode;
  readonly label: string;
  readonly key: string | undefined;
  readonly max: number;
  readonly consumerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
}

interface DirectScoreUseNode {
  readonly kind: "score";
  readonly input: "direct";
  readonly label: string;
  readonly key: string | undefined;
  readonly earned: number;
  readonly consumerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
}

type FactUseNode = VerdictUseNode | FactScoreUseNode | DirectScoreUseNode;

interface Requirement<R> {
  readonly use: VerdictUseNode;
  readonly node: FactNode;
  state: "created" | "observed-pending" | "settled";
  /** The Fact's own settlement; `.then()` chains are tracked independently. */
  promise: Promise<R> | undefined;
  baseSettled: boolean;
  pendingContinuations: number;
}

interface FactCollectorOptions {
  readonly evaluationKind?: "pass" | "score";
  readonly liveContext: () => Promise<AssertionEvaluationContext>;
  readonly nextSourceOrder?: () => number;
}

export interface FactFinalizeResult {
  readonly trace: AttemptFactTrace;
  readonly pass: import("./types.ts").PassFactAttemptOutcome;
  readonly score: ScoreFactAttemptOutcome;
}

interface FactFinalizeOptions {
  readonly onJudgeProgress?: (progress: JudgeProgress) => void;
  /** Runner-originated errors that occurred after the graph was registered. */
  readonly externalErrors?: readonly ErrorAttemptIssue[];
}

/**
 * The one-owner Attempt graph for ordinary Facts.  Facts are memoized at the
 * node, not at each use; the same Fact can therefore back one verdict and one
 * score use without a second evaluator invocation.
 */
export class FactCollector {
  private readonly nodes: FactNode[] = [];
  private readonly nodeByFact = new WeakMap<object, FactNode>();
  private readonly uses: FactUseNode[] = [];
  private readonly verdictUseByFact = new WeakMap<object, VerdictUseNode>();
  private readonly scoreUseByFact = new WeakMap<object, FactScoreUseNode>();
  private readonly requirementList: Requirement<unknown>[] = [];
  private readonly groupStack: string[] = [];
  private readonly keys = new Set<string>();
  private readonly legacySpecs: Spec[] = [];
  private readonly legacySettled = new WeakMap<Spec, FactRuntimeOutcome>();
  private readonly legacyEvaluating = new WeakMap<Spec, Promise<FactRuntimeOutcome>>();
  private readonly legacyStopSettling = new WeakMap<Spec, Promise<void>>();
  private legacyPending: Promise<void>[] = [];
  private readonly unavailableEvidence = new Map<EvidenceChannel, string>();
  private readonly liveContext: () => Promise<AssertionEvaluationContext>;
  private readonly evaluationKind: "pass" | "score";
  private readonly nextSourceOrder: () => number;
  private localSourceOrder = 0;
  private terminal:
    | { readonly kind: "control"; readonly signal: EvalRequirementFailed }
    | { readonly kind: "error"; readonly reason: string }
    | { readonly kind: "skipped"; readonly reason: string }
    | { readonly kind: "finished" }
    | undefined;
  /**
   * Runner errors seal the complete graph synchronously.  An evaluator may
   * still resolve after that point, but it must never rewrite the Attempt
   * trace that was exposed to the Runner.
   */
  private runnerErrorFinalization: FactFinalizeResult | undefined;
  private diffConsumers = 0;
  private scoreCompletion: ScoreCompletion | undefined;

  constructor(options: FactCollectorOptions) {
    this.liveContext = options.liveContext;
    this.evaluationKind = options.evaluationKind ?? "pass";
    this.nextSourceOrder = options.nextSourceOrder ?? (() => ++this.localSourceOrder);
  }

  /** Compatibility shape consumed by the current Runner's diff export phase. */
  evidenceRequirementSnapshot(): EvidenceRequirementSnapshot {
    return {
      diff: {
        required: this.diffConsumers > 0,
        optionalConsumers: 0,
        requiredConsumers: this.diffConsumers,
        directReads: 0,
      },
    };
  }

  evidenceRequirements(): EvidenceRequirementSnapshot {
    return this.evidenceRequirementSnapshot();
  }

  markEvidenceUnavailable(channel: EvidenceChannel, reason: string): void {
    this.unavailableEvidence.set(channel, reason);
  }

  requireDiffEvidence(): void {
    this.diffConsumers += 1;
  }

  createBooleanFact<R, P extends FactPhase>(definition: FactDefinition<R, P>): BooleanFact<R, P> {
    this.assertCanRegister();
    const dependencies = (definition.dependencyFacts ?? []).map((fact) => this.nodeFor(fact));
    const fact = Object.freeze({ kind: "boolean" as const, phase: definition.phase }) as BooleanFact<R, P>;
    const node: FactNode = {
      fact,
      id: `fact-${this.nodes.length + 1}`,
      name: definition.name,
      kind: "boolean",
      phase: definition.phase,
      value: definition.value,
      producerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
      ...(this.groupStack.length > 0 ? { groupPath: this.groupStack.slice() } : {}),
      dependencies,
      usageEvidence: definition.usageEvidence === true,
      usageUnavailableAtCreation: false,
      ...(definition.evidence === undefined ? {} : { evidence: definition.evidence }),
      evaluate: async (context) => definition.evaluate(context),
      result: undefined,
      evaluating: undefined,
    };
    this.nodes.push(node);
    this.nodeByFact.set(fact, node);
    return fact;
  }

  createScoreFact<P extends FactPhase>(definition: ScoreFactDefinition<P>): ScoreFact<P> {
    this.assertCanRegister();
    const dependencies = (definition.dependencyFacts ?? []).map((fact) => this.nodeFor(fact));
    const fact = Object.freeze({ kind: "score" as const, phase: definition.phase }) as ScoreFact<P>;
    const node: FactNode = {
      fact,
      id: `fact-${this.nodes.length + 1}`,
      name: definition.name,
      kind: "score",
      phase: definition.phase,
      value: undefined,
      producerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
      ...(this.groupStack.length > 0 ? { groupPath: this.groupStack.slice() } : {}),
      dependencies,
      usageEvidence: false,
      usageUnavailableAtCreation: false,
      ...(definition.evidence === undefined ? {} : { evidence: definition.evidence }),
      evaluate: async (context) => definition.evaluate(context),
      result: undefined,
      evaluating: undefined,
    };
    this.nodes.push(node);
    this.nodeByFact.set(fact, node);
    return fact;
  }

  assert<R, P extends FactPhase>(fact: BooleanFact<R, P>, options?: FactUseOptions): void;
  assert<P extends FactPhase>(fact: ScoreFact<P>, options: ScoreThresholdOptions): void;
  assert(fact: BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>, options?: FactUseOptions | ScoreThresholdOptions): void {
    this.assertCanRegister();
    const node = this.nodeFor(fact);
    const atLeast = node.kind === "score" ? this.thresholdOptions(options, "assert") : undefined;
    this.addVerdictUse(node, "assert", options, atLeast);
  }

  assertIfCovered<P extends FactPhase>(fact: UsageEvidenceFact<P>, options?: FactUseOptions): void {
    this.assertCanRegister();
    const node = this.nodeFor(fact);
    if (!node.usageEvidence) throw new TypeError("assertIfCovered() accepts only a core usage evidence Fact");
    this.addVerdictUse(node, "assertIfCovered", options, undefined);
  }

  require<R>(fact: BooleanFact<R, "now">, options?: FactUseOptions): Promise<R>;
  require(fact: ScoreFact<"now">, options: ScoreThresholdOptions): Promise<number>;
  require<R>(fact: BooleanFact<R, "now"> | ScoreFact<"now">, options?: FactUseOptions | ScoreThresholdOptions): Promise<R | number> {
    // `require(value, match)` creates a Fact immediately before it gets here.
    // Register this use first, then check graph reachability atomically.
    this.beforeManagedBoundary("require", { checkDangling: false });
    const node = this.nodeFor(fact);
    if (node.phase !== "now") throw new TypeError("require() accepts only phase: now Facts");
    const atLeast = node.kind === "score" ? this.thresholdOptions(options, "require") : undefined;
    const use = this.addVerdictUse(node, "require", options, atLeast);
    this.assertNoDanglingFacts();
    const requirement: Requirement<R | number> = {
      use,
      node,
      state: "created",
      promise: undefined,
      baseSettled: false,
      pendingContinuations: 0,
    };
    this.requirementList.push(requirement);
    return this.managedRequirement(requirement);
  }

  score<P extends FactPhase>(
    label: string,
    fact: BooleanFact<unknown, P> | ScoreFact<P>,
    options: { readonly key?: string; readonly max: number },
  ): void;
  score(label: string, direct: { readonly key?: string; readonly earned: number }): void;
  score(
    label: string,
    factOrDirect: BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase> | { readonly key?: string; readonly earned: number },
    options?: { readonly key?: string; readonly max: number },
  ): void {
    this.assertCanRegister();
    if (this.evaluationKind !== "score") throw new Error("score() is available only in defineScoreEval");
    this.assertLabel(label, "score()");
    if (this.isFact(factOrDirect)) {
      if (options === undefined) throw new TypeError("score(label, fact, { max }) requires max");
      if (!Number.isFinite(options.max) || options.max <= 0) {
        throw new TypeError("score() max must be a positive finite number");
      }
      const node = this.nodeFor(factOrDirect);
      if (this.scoreUseByFact.has(node.fact)) throw new Error(`Fact ${node.name} already has a score use`);
      const key = this.validateKey(options.key);
      const use: FactScoreUseNode = {
        kind: "score",
        input: "fact",
        node,
        label,
        key,
        max: options.max,
        consumerLoc: captureLoc(),
        sourceOrder: this.nextSourceOrder(),
      };
      this.scoreUseByFact.set(node.fact, use);
      this.uses.push(use);
      return;
    }
    if (options !== undefined || !("earned" in factOrDirect)) {
      throw new TypeError("score(label, direct) accepts only { earned, key? }");
    }
    if (!Number.isFinite(factOrDirect.earned) || factOrDirect.earned < 0) {
      throw new TypeError("score() earned must be a non-negative finite number");
    }
    this.uses.push({
      kind: "score",
      input: "direct",
      label,
      key: this.validateKey(factOrDirect.key),
      earned: factOrDirect.earned,
      consumerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
    });
  }

  finishScore(): ScoreCompletion {
    this.beforeManagedBoundary("finishScore");
    if (this.evaluationKind !== "score") throw new Error("finishScore() is available only in defineScoreEval");
    if (!this.uses.some((use) => use.kind === "score") && this.legacySpecs.length === 0) {
      throw new Error("finishScore() requires at least one Fact score use or legacy Judge assertion");
    }
    this.terminal = { kind: "finished" };
    const completion = Object.freeze({}) as ScoreCompletion;
    this.scoreCompletion = completion;
    return completion;
  }

  async withGroup<T>(title: string, fn: () => Promise<T> | T): Promise<T> {
    this.assertCanRegister();
    this.assertLabel(title, "group()");
    this.groupStack.push(title);
    try {
      return await fn();
    } finally {
      this.groupStack.pop();
    }
  }

  /** Called by t.send/sandbox/normal return before entering another managed edge. */
  beforeManagedBoundary(boundary: string, options: { readonly checkDangling?: boolean } = {}): void {
    if (this.terminal?.kind === "control") throw this.terminal.signal;
    if (this.terminal?.kind === "error" || this.terminal?.kind === "skipped") {
      throw new Error(`Cannot enter ${boundary}; the Fact collector is closed`);
    }
    if (this.terminal?.kind === "finished") {
      throw new Error(`Cannot enter ${boundary}; finishScore() already closed the collector`);
    }
    for (const requirement of this.requirementList) {
      if (requirement.state === "created") {
        throw new Error("requirement was created but never observed before the next managed boundary");
      }
      if (requirement.state === "observed-pending") {
        throw new Error("requirement is still pending before the next managed boundary");
      }
    }
    if (options.checkDangling !== false) this.assertNoDanglingFacts();
  }

  completePass(): void {
    this.beforeManagedBoundary("test return");
    if (!this.uses.some((use) => use.kind === "verdict") && this.legacySpecs.length === 0) {
      throw new Error("A defineEval normal path requires at least one Fact verdict use or legacy Judge assertion");
    }
  }

  /** Runner-only normal-return boundary for a score Eval. */
  completeScore(completion: unknown): void {
    if (this.terminal?.kind === "control" || this.terminal?.kind === "error" || this.terminal?.kind === "skipped") return;
    if (this.terminal?.kind !== "finished" || completion !== this.scoreCompletion) {
      throw new Error("A defineScoreEval normal path must return t.finishScore()");
    }
  }

  /**
   * Runner-only external-error boundary. This is deliberately not an author
   * assertion API: it seals already registered nodes without starting any new
   * evaluator, so timeout / infrastructure failure cannot race a late result.
   */
  finalizeForRunnerError(issue: ErrorAttemptIssue): FactFinalizeResult {
    if (this.runnerErrorFinalization !== undefined) return this.runnerErrorFinalization;

    const reason = issue.error.message;
    this.terminal = { kind: "error", reason };
    const facts = this.nodes.map((node) => {
      if (node.result !== undefined) return node.result;
      const result = node.evaluating === undefined
        ? this.notReached(node, "notReachedByError", reason)
        : this.baseResult(node, {
            outcome: "errored",
            error: this.interruptedEvaluatorError(node.name, reason),
          });
      node.result = result;
      return result;
    });
    const uses = this.buildUses();
    const legacyJudgeAssertions = this.freezeLegacyForRunnerError(reason);
    const trace: AttemptFactTrace = {
      facts: Object.freeze(facts),
      uses: Object.freeze(uses),
      legacyJudgeAssertions: Object.freeze(legacyJudgeAssertions),
    };
    const finalized: FactFinalizeResult = {
      trace: Object.freeze(trace),
      pass: this.foldPass(trace, [issue]),
      score: this.foldScore(trace, [issue]),
    };
    this.runnerErrorFinalization = Object.freeze(finalized);
    return this.runnerErrorFinalization;
  }

  closeForSkip(reason: string): void {
    if (this.terminal === undefined || this.terminal.kind === "finished") this.terminal = { kind: "skipped", reason };
  }

  /** Private Judge bridge. assertions/judge.ts still receives the old handle shape. */
  recordLegacyJudge(spec: Spec): RecordHandle {
    this.assertCanRegister();
    if (spec.groupPath === undefined && this.groupStack.length > 0) spec.groupPath = this.groupStack.slice();
    if (spec.loc === undefined) spec.loc = captureLoc();
    if (spec.sourceOrder === undefined) spec.sourceOrder = this.nextSourceOrder();
    this.legacySpecs.push(spec);
    const collector = this;
    const handle: RecordHandle = {
      atLeast(threshold) {
        spec.severity = "soft";
        spec.threshold = threshold;
        return handle;
      },
      gate(threshold) {
        spec.severity = "gate";
        spec.threshold = threshold;
        return handle;
      },
      stopOnFailure() {
        collector.beforeManagedBoundary("legacy Judge stopOnFailure");
        if (spec.severity !== "gate" && spec.threshold === undefined) {
          throw new Error(
            ".stopOnFailure() requires a passing line; chain .gate() or .atLeast(threshold), or use an assertion with a default threshold",
          );
        }
        if (spec.stopOnFailure !== true) {
          spec.stopOnFailure = true;
          const settling = (async (): Promise<void> => {
            const raw = await collector.evaluateLegacyNow(spec);
            if (collector.legacyFailed(spec, raw)) collector.terminateByName(spec.name);
          })();
          collector.legacyStopSettling.set(spec, settling);
          collector.legacyPending.push(settling);
        }
        const result = (async (): Promise<RecordHandle> => {
          await collector.legacyStopSettling.get(spec);
          await collector.settleLegacyPrerequisites();
          return handle;
        })();
        // An unawaited legacy stop is supported: the next managed async
        // boundary observes the same control signal, while this observer keeps
        // the host from reporting a duplicate unhandled rejection.
        void result.catch(() => {});
        return result;
      },
      soft() {
        spec.severity = "soft";
        spec.threshold = undefined;
        return handle;
      },
      optional() {
        spec.optional = true;
        return handle;
      },
      points(points) {
        if (!Number.isFinite(points) || points <= 0) {
          throw new Error(t("assertions.pointsInvalid", { n: points }));
        }
        spec.points = points;
        return handle;
      },
    };
    return handle;
  }

  /**
   * Old Judge handles may deliberately leave `.stopOnFailure()` unawaited.
   * Preserve their existing next-async-boundary behavior without letting the
   * legacy bridge become a second public control-flow API.
   */
  async settleLegacyPrerequisites(): Promise<void> {
    while (this.legacyPending.length > 0) {
      const batch = this.legacyPending;
      this.legacyPending = [];
      await Promise.all(batch);
    }
    if (this.terminal?.kind === "control") throw this.terminal.signal;
  }

  async finalize(context: AssertionEvaluationContext, options: FactFinalizeOptions = {}): Promise<FactFinalizeResult> {
    if (this.runnerErrorFinalization !== undefined) return this.runnerErrorFinalization;
    const control = this.terminal?.kind === "control" ? this.terminal : undefined;
    const stoppedByError = this.terminal?.kind === "error" || this.terminal?.kind === "skipped";
    const reachable = this.reachableNodes();
    const facts: EvaluationFactResult[] = [];
    for (const node of this.nodes) {
      if (node.result !== undefined) {
        facts.push(node.result);
        continue;
      }
      if (!reachable.has(node) || control !== undefined || stoppedByError) {
        const reason = control?.signal.message ?? this.terminalReason("not reached");
        const outcome = control === undefined && this.terminal?.kind === "error" ? "notReachedByError" : "notReachedByControl";
        const result = this.notReached(node, outcome, reason);
        node.result = result;
        facts.push(result);
        continue;
      }
      facts.push(await this.evaluateNode(node, context));
    }

    const uses = this.buildUses();
    const legacyJudgeAssertions = await this.finalizeLegacy(options.onJudgeProgress);
    const trace: AttemptFactTrace = { facts, uses, legacyJudgeAssertions };
    const externalErrors = options.externalErrors ?? [];
    return { trace, pass: this.foldPass(trace, externalErrors), score: this.foldScore(trace, externalErrors) };
  }

  private isFact(value: unknown): value is BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase> {
    return typeof value === "object" && value !== null && this.nodeByFact.has(value);
  }

  private nodeFor(fact: BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>): FactNode {
    const node = typeof fact === "object" && fact !== null ? this.nodeByFact.get(fact) : undefined;
    if (node === undefined) throw new TypeError("Fact belongs to a different Attempt or was not created by this context");
    return node;
  }

  private assertCanRegister(): void {
    if (this.terminal?.kind === "control") throw this.terminal.signal;
    if (this.terminal !== undefined) throw new Error("The Fact collector is closed");
  }

  private addVerdictUse(
    node: FactNode,
    method: VerdictUseNode["method"],
    options: FactUseOptions | ScoreThresholdOptions | undefined,
    atLeast: number | undefined,
  ): VerdictUseNode {
    if (this.verdictUseByFact.has(node.fact)) throw new Error(`Fact ${node.name} already has a verdict use`);
    const use: VerdictUseNode = {
      kind: "verdict",
      node,
      method,
      ...(options?.label === undefined ? {} : { label: this.nonEmpty(options.label, `${method}() label`) }),
      key: this.validateKey(options?.key),
      ...(atLeast === undefined ? {} : { atLeast }),
      consumerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
    };
    this.verdictUseByFact.set(node.fact, use);
    this.uses.push(use);
    return use;
  }

  private thresholdOptions(options: FactUseOptions | ScoreThresholdOptions | undefined, method: string): number {
    if (options === undefined || !("atLeast" in options)) {
      throw new TypeError(`${method}() needs { atLeast } for a Score Fact`);
    }
    this.assertThreshold(options.atLeast, `${method}() atLeast`);
    return options.atLeast;
  }

  private assertThreshold(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(`${label} must be a finite number in [0, 1]`);
    }
  }

  private assertLabel(value: string, owner: string): void {
    this.nonEmpty(value, `${owner} label`);
  }

  private nonEmpty(value: string, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
    return value;
  }

  private validateKey(key: string | undefined): string | undefined {
    if (key === undefined) return undefined;
    if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(key)) {
      throw new TypeError("Fact use key must match [a-z0-9][a-z0-9._/-]{0,127}");
    }
    if (this.keys.has(key)) throw new Error(`Fact use key ${JSON.stringify(key)} is already used`);
    this.keys.add(key);
    return key;
  }

  private assertNoDanglingFacts(): void {
    const reachable = this.reachableNodes();
    const dangling = this.nodes.find((node) => !reachable.has(node));
    if (dangling !== undefined) {
      throw new Error(`Evaluation Fact ${JSON.stringify(dangling.name)} has no assert, require, or score use`);
    }
  }

  private reachableNodes(): Set<FactNode> {
    const roots = this.uses.flatMap((use) => (use.kind === "score" && use.input === "direct" ? [] : [use.node]));
    const reachable = new Set<FactNode>();
    const visit = (node: FactNode): void => {
      if (reachable.has(node)) return;
      reachable.add(node);
      for (const dependency of node.dependencies) visit(dependency);
    };
    for (const root of roots) visit(root);
    return reachable;
  }

  private managedRequirement<R>(requirement: Requirement<R>): Promise<R> {
    const observe = (): Promise<R> => {
      if (requirement.state === "created") requirement.state = "observed-pending";
      if (requirement.promise === undefined) {
        requirement.promise = this.settleRequirement(requirement);
      }
      return requirement.promise;
    };
    const finishContinuation = (): void => {
      requirement.pendingContinuations -= 1;
      this.maybeSettleRequirement(requirement);
    };
    const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
      typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
    const observeThen = <TResult1 = R, TResult2 = never>(
      onfulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> => {
      const base = observe();
      requirement.pendingContinuations += 1;
      const invoke = (callback: ((value: unknown) => unknown) | null | undefined, value: unknown, rejected: boolean): unknown => {
        try {
          const output = callback === undefined || callback === null
            ? (rejected ? Promise.reject(value) : value)
            : callback(value);
          if (isPromiseLike(output)) {
            return Promise.resolve(output).then(
              (resolved) => {
                finishContinuation();
                return resolved;
              },
              (error) => {
                finishContinuation();
                throw error;
              },
            );
          }
          // Native `await` supplies a resolving callback that returns void.
          // Marking it settled synchronously here happens before the awaiting
          // function resumes at its next managed boundary.
          finishContinuation();
          return output;
        } catch (error) {
          finishContinuation();
          throw error;
        }
      };
      return base.then(
        (value) => invoke(onfulfilled as ((value: unknown) => unknown) | null | undefined, value, false) as TResult1,
        (error) => invoke(onrejected as ((value: unknown) => unknown) | null | undefined, error, true) as TResult2,
      );
    };
    const thenable = {
      then: <TResult1 = R, TResult2 = never>(
        onfulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> => observeThen(onfulfilled, onrejected),
      catch: <TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<R | TResult> =>
        observeThen(undefined, onrejected),
      finally: (onfinally?: (() => void) | null): Promise<R> =>
        observeThen(
          async (value) => {
            onfinally?.();
            return value;
          },
          async (error) => {
            onfinally?.();
            throw error;
          },
        ) as Promise<R>,
      [Symbol.toStringTag]: "Promise",
    };
    return thenable as Promise<R>;
  }

  private async settleRequirement<R>(requirement: Requirement<R>): Promise<R> {
    try {
      // Legacy Judge stopOnFailure() retains its old "next async boundary"
      // behavior. A new managed require must not start another dependency
      // evaluation before that pending Judge prerequisite settles.
      await this.settleLegacyPrerequisites();
      const context = await this.liveContext();
      const result = await this.evaluateNode(requirement.node, context);
      const passed = this.usePassed(requirement.use, result);
      if (passed) return requirement.node.value as R;
      throw this.terminateByName(requirement.use.label ?? requirement.node.name);
    } finally {
      requirement.baseSettled = true;
      this.maybeSettleRequirement(requirement);
    }
  }

  private maybeSettleRequirement(requirement: Requirement<unknown>): void {
    if (requirement.baseSettled && requirement.pendingContinuations === 0) requirement.state = "settled";
  }

  private usePassed(use: VerdictUseNode, result: EvaluationFactResult): boolean {
    if (result.outcome === "passed") return true;
    if (result.outcome === "scored") return result.normalizedScore >= (use.atLeast ?? 1);
    return false;
  }

  private terminateByName(name: string): EvalRequirementFailed {
    if (this.terminal?.kind === "control") return this.terminal.signal;
    const signal = new EvalRequirementFailed(name);
    if (this.terminal === undefined) this.terminal = { kind: "control", signal };
    return signal;
  }

  private async evaluateNode(node: FactNode, context: AssertionEvaluationContext): Promise<EvaluationFactResult> {
    if (node.result !== undefined) return node.result;
    if (node.evaluating !== undefined) return node.evaluating;
    node.evaluating = (async () => {
      const unavailableReason = node.evidence === undefined ? undefined : this.unavailableEvidence.get(node.evidence);
      if (unavailableReason !== undefined) {
        const result = this.baseResult(node, { outcome: "unavailable", reason: unavailableReason });
        node.result = result;
        return result;
      }
      try {
        for (const dependency of node.dependencies) await this.evaluateNode(dependency, context);
        if (this.runnerErrorFinalization !== undefined && node.result !== undefined) return node.result;
        const raw = await node.evaluate(context);
        if (this.runnerErrorFinalization !== undefined && node.result !== undefined) return node.result;
        if (raw.outcome === "unavailable") {
          node.usageUnavailableAtCreation = node.usageEvidence && raw.usageUnavailableAtCreation === true;
        }
        if (raw.outcome === "passed" && raw.value !== undefined) node.value = raw.value;
        if (raw.outcome === "scored") node.value = raw.normalizedScore;
        const result = this.baseResult(node, raw);
        node.result = result;
        return result;
      } catch (error) {
        if (this.runnerErrorFinalization !== undefined && node.result !== undefined) return node.result;
        const result = this.baseResult(node, { outcome: "errored", error: evaluatorError(error) });
        node.result = result;
        return result;
      }
    })();
    return node.evaluating;
  }

  private baseResult(node: FactNode, outcome: FactRuntimeOutcome): EvaluationFactResult {
    const base = {
      factId: node.id,
      name: node.name,
      ...(node.groupPath === undefined ? {} : { groupPath: node.groupPath }),
      ...(node.producerLoc === undefined ? {} : { producerLoc: node.producerLoc }),
      sourceOrder: node.sourceOrder,
      dependencyFactIds: node.dependencies.map((dependency) => dependency.id),
    };
    if (outcome.outcome === "passed" || outcome.outcome === "failed") {
      return {
        ...base,
        factKind: "boolean",
        outcome: outcome.outcome,
        ...(outcome.expected === undefined ? {} : { expected: outcome.expected }),
        ...(outcome.received === undefined ? {} : { received: outcome.received }),
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
      };
    }
    if (outcome.outcome === "scored") {
      return {
        ...base,
        factKind: "score",
        outcome: "scored",
        normalizedScore: outcome.normalizedScore,
        ...(outcome.expected === undefined ? {} : { expected: outcome.expected }),
        ...(outcome.received === undefined ? {} : { received: outcome.received }),
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
      };
    }
    if (outcome.outcome === "unavailable") {
      return {
        ...base,
        factKind: node.kind,
        outcome: "unavailable",
        reason: outcome.reason,
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
      };
    }
    if (outcome.outcome === "errored") {
      return { ...base, factKind: node.kind, outcome: "errored", error: outcome.error };
    }
    throw new TypeError(`Fact ${node.name} returned an unsupported evaluator outcome`);
  }

  private notReached(
    node: FactNode,
    outcome: "notReachedByControl" | "notReachedByError",
    reason: string,
  ): EvaluationFactResult {
    return {
      factId: node.id,
      name: node.name,
      ...(node.groupPath === undefined ? {} : { groupPath: node.groupPath }),
      ...(node.producerLoc === undefined ? {} : { producerLoc: node.producerLoc }),
      sourceOrder: node.sourceOrder,
      dependencyFactIds: node.dependencies.map((dependency) => dependency.id),
      factKind: node.kind,
      outcome,
      reason,
    };
  }

  private terminalReason(fallback: string): string {
    if (this.terminal?.kind === "error" || this.terminal?.kind === "skipped") return this.terminal.reason;
    if (this.terminal?.kind === "control") return this.terminal.signal.message;
    return fallback;
  }

  private buildUses(): Array<VerdictFactUseResult | ScoreFactUseResult> {
    return this.uses.map((use) => {
      if (use.kind === "score" && use.input === "direct") {
        // Direct scores are complete at the declaration point. A later
        // controlled stop cannot retroactively make a declared number
        // unreachable.
        return {
          useKind: "score",
          label: use.label,
          ...(use.key === undefined ? {} : { key: use.key }),
          ...(use.consumerLoc === undefined ? {} : { consumerLoc: use.consumerLoc }),
          sourceOrder: use.sourceOrder,
          input: { kind: "direct", earned: use.earned },
          outcome: "scored",
          earned: use.earned,
        };
      }
      const result = use.node.result;
      const common = {
        ...(use.key === undefined ? {} : { key: use.key }),
        ...(use.consumerLoc === undefined ? {} : { consumerLoc: use.consumerLoc }),
        sourceOrder: use.sourceOrder,
      };
      if (use.kind === "verdict") {
        const target = use.node.kind === "boolean"
          ? { kind: "boolean" as const, factId: use.node.id }
          : { kind: "score" as const, factId: use.node.id, atLeast: use.atLeast! };
        const base = {
          ...common,
          useKind: "verdict" as const,
          method: use.method,
          ...(use.label === undefined ? {} : { label: use.label }),
          target,
        };
        if (result === undefined || result.outcome === "notReachedByControl" || result.outcome === "notReachedByError") {
          return {
            ...base,
            outcome: result?.outcome ?? "notReachedByControl",
            reason: result?.outcome === "notReachedByError" || result?.outcome === "notReachedByControl" ? result.reason : this.terminalReason("not reached"),
          } as VerdictFactUseResult;
        }
        if (result.outcome === "unavailable") {
          return {
            ...base,
            outcome: use.method === "assertIfCovered" && use.node.usageUnavailableAtCreation
              ? "notApplicable"
              : "unavailable",
            reason: result.reason,
          } as VerdictFactUseResult;
        }
        if (result.outcome === "errored") return { ...base, outcome: "errored", error: result.error } as VerdictFactUseResult;
        return { ...base, outcome: this.usePassed(use, result) ? "passed" : "failed" } as VerdictFactUseResult;
      }
      const base = {
        ...common,
        useKind: "score" as const,
        label: use.label,
        input: { kind: "fact" as const, factId: use.node.id, max: use.max },
      };
      if (result === undefined || result.outcome === "notReachedByControl" || result.outcome === "notReachedByError") {
        return {
          ...base,
          outcome: result?.outcome ?? "notReachedByControl",
          reason: result?.outcome === "notReachedByError" || result?.outcome === "notReachedByControl" ? result.reason : this.terminalReason("not reached"),
        } as ScoreFactUseResult;
      }
      if (result.outcome === "unavailable") return { ...base, outcome: "unavailable", reason: result.reason } as ScoreFactUseResult;
      if (result.outcome === "errored") return { ...base, outcome: "errored", error: result.error } as ScoreFactUseResult;
      const normalized = result.outcome === "passed"
        ? 1
        : result.outcome === "failed"
          ? 0
          : result.outcome === "scored"
            ? result.normalizedScore
            : (() => {
                throw new TypeError(`Fact ${use.node.name} returned an unsupported score outcome`);
              })();
      return { ...base, outcome: "scored", earned: use.max * normalized } as ScoreFactUseResult;
    });
  }

  private async evaluateLegacyNow(spec: Spec): Promise<FactRuntimeOutcome> {
    const existing = this.legacySettled.get(spec);
    if (existing !== undefined) return existing;
    if (this.runnerErrorFinalization !== undefined) {
      return { outcome: "errored", error: this.interruptedEvaluatorError(spec.name, this.terminalReason("attempt ended")) };
    }
    const inFlight = this.legacyEvaluating.get(spec);
    if (inFlight !== undefined) return inFlight;
    const evaluating = (async (): Promise<FactRuntimeOutcome> => {
      try {
        const raw = await spec.evaluate(await this.liveContext());
        const result = legacyRuntimeOutcome(raw);
        if (this.runnerErrorFinalization !== undefined) return this.legacySettled.get(spec) ?? result;
        this.legacySettled.set(spec, result);
        return result;
      } catch (error) {
        const result: FactRuntimeOutcome = { outcome: "errored", error: evaluatorError(error) };
        if (this.runnerErrorFinalization !== undefined) return this.legacySettled.get(spec) ?? result;
        this.legacySettled.set(spec, result);
        return result;
      } finally {
        this.legacyEvaluating.delete(spec);
      }
    })();
    this.legacyEvaluating.set(spec, evaluating);
    return evaluating;
  }

  private legacyFailed(spec: Spec, result: FactRuntimeOutcome): boolean {
    if (result.outcome === "unavailable") return false;
    if (result.outcome === "errored") return true;
    const score = result.outcome === "scored" ? result.normalizedScore : result.outcome === "passed" ? 1 : 0;
    return !computePassed(spec.severity, spec.threshold, score);
  }

  private interruptedEvaluatorError(name: string, reason: string): EvaluationFactError {
    return {
      class: "evaluator",
      code: "evaluator-interrupted",
      message: `Evaluator ${JSON.stringify(name)} did not settle before the Attempt ended: ${reason}`,
    };
  }

  private freezeLegacyForRunnerError(reason: string): LegacyJudgeAssertionResult[] {
    return this.legacySpecs.map((spec) => {
      const verdict: LegacyJudgePolicy["verdict"] = spec.severity === "gate"
        ? { kind: "gate", atLeast: spec.threshold ?? 1 }
        : spec.threshold === undefined
          ? { kind: "soft" }
          : { kind: "soft", atLeast: spec.threshold };
      const policyBase = {
        verdict,
        optional: spec.optional === true,
        stopOnFailure: spec.stopOnFailure === true,
      };
      const policy: LegacyJudgePolicy = spec.points === undefined
        ? { ...policyBase, scoring: { kind: "quality" } }
        : { ...policyBase, scoring: { kind: "points", max: spec.points } };
      const base = {
        name: (spec.name.startsWith("judge:") ? spec.name : `judge:${spec.name}`) as `judge:${string}`,
        detail: spec.detail ?? spec.name,
        ...(spec.groupPath === undefined ? {} : { groupPath: spec.groupPath }),
        ...(spec.loc === undefined ? {} : { loc: spec.loc }),
        sourceOrder: spec.sourceOrder ?? 0,
      };
      const raw = this.legacySettled.get(spec);
      if (raw === undefined && this.legacyEvaluating.has(spec)) {
        const error = this.interruptedEvaluatorError(spec.name, reason);
        this.legacySettled.set(spec, { outcome: "errored", error });
        return { ...base, policy, outcome: "errored", error };
      }
      if (raw === undefined) return { ...base, policy, outcome: "notReachedByError", reason };
      if (raw.outcome === "unavailable") {
        return { ...base, policy, outcome: "unavailable", reason: raw.reason, ...(raw.evidence === undefined ? {} : { evidence: raw.evidence }) };
      }
      if (raw.outcome === "errored") return { ...base, policy, outcome: "errored", error: raw.error };
      const normalizedScore = raw.outcome === "scored" ? raw.normalizedScore : raw.outcome === "passed" ? 1 : 0;
      const rationale = raw.outcome === "scored" ? raw.rationale : undefined;
      const passed = computePassed(spec.severity, spec.threshold, normalizedScore);
      if (policy.scoring.kind === "points") {
        const pointPolicy = {
          ...policyBase,
          scoring: { kind: "points" as const, max: policy.scoring.max },
        } satisfies Extract<LegacyJudgePolicy, { readonly scoring: { readonly kind: "points"; readonly max: number } }>;
        return {
          ...base,
          policy: pointPolicy,
          outcome: passed ? "passed" : "failed",
          normalizedScore,
          earnedPoints: pointPolicy.scoring.max * normalizedScore,
          ...(raw.evidence === undefined ? {} : { evidence: raw.evidence }),
          ...(rationale === undefined ? {} : { rationale }),
        };
      }
      const qualityPolicy = {
        ...policyBase,
        scoring: { kind: "quality" as const },
      } satisfies Extract<LegacyJudgePolicy, { readonly scoring: { readonly kind: "quality" } }>;
      return {
        ...base,
        policy: qualityPolicy,
        outcome: passed ? "passed" : "failed",
        normalizedScore,
        ...(raw.evidence === undefined ? {} : { evidence: raw.evidence }),
        ...(rationale === undefined ? {} : { rationale }),
      };
    });
  }

  private async finalizeLegacy(onJudgeProgress?: (progress: JudgeProgress) => void): Promise<LegacyJudgeAssertionResult[]> {
    const out: LegacyJudgeAssertionResult[] = [];
    const judgeTotal = this.legacySpecs.filter((spec) => spec.judge === true).length;
    let judgeIndex = 0;
    for (const spec of this.legacySpecs) {
      const verdict: LegacyJudgePolicy["verdict"] = spec.severity === "gate"
          ? { kind: "gate" as const, atLeast: spec.threshold ?? 1 }
          : spec.threshold === undefined
            ? { kind: "soft" as const }
            : { kind: "soft" as const, atLeast: spec.threshold };
      const policyBase = {
        verdict,
        optional: spec.optional === true,
        stopOnFailure: spec.stopOnFailure === true,
      };
      const policy: LegacyJudgePolicy = spec.points === undefined
        ? { ...policyBase, scoring: { kind: "quality" } }
        : { ...policyBase, scoring: { kind: "points", max: spec.points } };
      const base = {
        name: (spec.name.startsWith("judge:") ? spec.name : `judge:${spec.name}`) as `judge:${string}`,
        detail: spec.detail ?? spec.name,
        ...(spec.groupPath === undefined ? {} : { groupPath: spec.groupPath }),
        ...(spec.loc === undefined ? {} : { loc: spec.loc }),
        sourceOrder: spec.sourceOrder ?? 0,
      };
      if ((this.terminal?.kind === "control" || this.terminal?.kind === "skipped") && !this.legacySettled.has(spec)) {
        const reason = this.terminal.kind === "control" ? this.terminal.signal.message : this.terminal.reason;
        out.push({ ...base, policy, outcome: "notReachedByControl", reason });
        continue;
      }
      if (this.terminal?.kind === "error" && !this.legacySettled.has(spec)) {
        out.push({ ...base, policy, outcome: "notReachedByError", reason: this.terminal.reason });
        continue;
      }
      if (spec.judge === true) {
        judgeIndex++;
        onJudgeProgress?.({ index: judgeIndex, total: judgeTotal, check: spec.detail ?? spec.name });
      }
      let raw = this.legacySettled.get(spec);
      if (raw === undefined) {
        // The in-flight memoizer is also used when stopOnFailure() began the
        // Judge call before normal finalization reached this bridge.
        raw = await this.evaluateLegacyNow(spec);
      }
      if (raw.outcome === "unavailable") {
        out.push({ ...base, policy, outcome: "unavailable", reason: raw.reason, ...(raw.evidence === undefined ? {} : { evidence: raw.evidence }) });
      } else if (raw.outcome === "errored") {
        out.push({ ...base, policy, outcome: "errored", error: raw.error });
      } else {
        const normalizedScore = raw.outcome === "scored" ? raw.normalizedScore : raw.outcome === "passed" ? 1 : 0;
        const rationale = raw.outcome === "scored" ? raw.rationale : undefined;
        const passed = computePassed(spec.severity, spec.threshold, normalizedScore);
        if (policy.scoring.kind === "points") {
          const pointPolicy = policy as Extract<LegacyJudgePolicy, { readonly scoring: { readonly kind: "points"; readonly max: number } }>;
          out.push({
            ...base,
            policy: pointPolicy,
            outcome: passed ? "passed" : "failed",
            normalizedScore,
            earnedPoints: pointPolicy.scoring.max * normalizedScore,
            ...(raw.evidence === undefined ? {} : { evidence: raw.evidence }),
            ...(rationale === undefined ? {} : { rationale }),
          });
        } else {
          const qualityPolicy = policy as Extract<LegacyJudgePolicy, { readonly scoring: { readonly kind: "quality" } }>;
          out.push({
            ...base,
            policy: qualityPolicy,
            outcome: passed ? "passed" : "failed",
            normalizedScore,
            ...(raw.evidence === undefined ? {} : { evidence: raw.evidence }),
            ...(rationale === undefined ? {} : { rationale }),
          });
        }
      }
    }
    return out;
  }

  private foldPass(
    trace: AttemptFactTrace,
    externalErrors: readonly ErrorAttemptIssue[],
  ): import("./types.ts").PassFactAttemptOutcome {
    const issues = this.issues(trace, externalErrors);
    if (issues.errors.length > 0 || issues.unavailable.length > 0) {
      return { verdict: "errored", issues: [...issues.errors, ...issues.unavailable] as [AttemptFactIssue, ...AttemptFactIssue[]] };
    }
    if (trace.uses.some((use): use is VerdictFactUseResult => use.useKind === "verdict" && use.outcome === "failed")) {
      return { verdict: "failed" };
    }
    if (trace.legacyJudgeAssertions.some((legacy) => legacy.policy.verdict.kind === "gate" && legacy.outcome === "failed")) {
      return { verdict: "failed" };
    }
    if (this.terminal?.kind === "skipped") return { verdict: "skipped", reason: this.terminal.reason };
    const verdictUses = trace.uses.filter((use): use is VerdictFactUseResult => use.useKind === "verdict");
    if (verdictUses.length > 0 && verdictUses.every((use) => use.outcome === "notApplicable")) {
      return { verdict: "skipped", reason: "all verdict uses were not applicable" };
    }
    return { verdict: "passed" };
  }

  private foldScore(trace: AttemptFactTrace, externalErrors: readonly ErrorAttemptIssue[]): ScoreFactAttemptOutcome {
    const uses = trace.uses.filter((use): use is ScoreFactUseResult => use.useKind === "score");
    const earnedScore = uses.reduce((total, use) => total + (use.outcome === "scored" ? use.earned : 0), 0) +
      trace.legacyJudgeAssertions.reduce((total, legacy) => total + ("earnedPoints" in legacy ? legacy.earnedPoints : 0), 0);
    const issues = this.issues(trace, externalErrors);
    const hardFailure = trace.uses.some((use): use is VerdictFactUseResult => use.useKind === "verdict" && use.outcome === "failed") ||
      trace.legacyJudgeAssertions.some((legacy) => legacy.policy.verdict.kind === "gate" && legacy.outcome === "failed");
    if (hardFailure) return { status: "invalid", earnedScore, creditedScore: 0, issues: [...issues.errors, ...issues.unavailable] };
    if (issues.errors.length > 0) {
      return {
        status: "errored",
        earnedScore,
        creditedScore: null,
        errors: issues.errors as [import("./types.ts").ErrorAttemptIssue, ...import("./types.ts").ErrorAttemptIssue[]],
        issues: issues.unavailable,
      };
    }
    if (issues.unavailable.length > 0) {
      return {
        status: "unavailable",
        earnedScore,
        creditedScore: null,
        issues: issues.unavailable as [import("./types.ts").UnavailableAttemptIssue, ...import("./types.ts").UnavailableAttemptIssue[]],
      };
    }
    if (this.terminal?.kind === "skipped") return { status: "skipped", earnedScore, creditedScore: null, reason: this.terminal.reason };
    return { status: "scored", earnedScore, creditedScore: earnedScore };
  }

  private issues(trace: AttemptFactTrace, externalErrors: readonly ErrorAttemptIssue[] = []): {
    errors: import("./types.ts").ErrorAttemptIssue[];
    unavailable: import("./types.ts").UnavailableAttemptIssue[];
  } {
    const errors: import("./types.ts").ErrorAttemptIssue[] = [...externalErrors];
    const unavailable: import("./types.ts").UnavailableAttemptIssue[] = [];
    for (const fact of trace.facts) {
      if (fact.outcome === "errored") errors.push({ kind: "error", error: fact.error, factId: fact.factId });
      if (fact.outcome === "unavailable") {
        const consumers = trace.uses.filter((use) =>
          use.useKind === "verdict"
            ? use.target.factId === fact.factId
            : use.input.kind === "fact" && use.input.factId === fact.factId,
        );
        // A core usage Fact whose *only* consumers became notApplicable is
        // deliberately not an Attempt issue. It still keeps its unavailable
        // Fact row and its explicit notApplicable use in the trace; a score
        // consumer, ordinary assert, or dependency-only node remains honest
        // evidence insufficiency.
        const allNotApplicable = consumers.length > 0 && consumers.every(
          (use) => use.useKind === "verdict" && use.outcome === "notApplicable",
        );
        if (!allNotApplicable) unavailable.push({ kind: "unavailable", reason: fact.reason, factId: fact.factId });
      }
    }
    // Fact-backed use errors/unavailability are the same evaluator result
    // already represented by the Fact row.  Keeping one issue per Fact avoids
    // presenting a single evaluator defect twice merely because it has both a
    // verdict and a score consumer; the trace still preserves every consumer
    // location.
    for (const legacy of trace.legacyJudgeAssertions) {
      if (legacy.outcome === "errored" && legacy.error !== undefined) {
        errors.push({ kind: "error", error: legacy.error, legacyJudgeSourceOrder: legacy.sourceOrder });
      }
      if (legacy.outcome === "unavailable" && legacy.reason !== undefined && !legacy.policy.optional) {
        unavailable.push({ kind: "unavailable", reason: legacy.reason, legacyJudgeSourceOrder: legacy.sourceOrder });
      }
    }
    return { errors, unavailable };
  }
}

function legacyRuntimeOutcome(value: number | EvalScore | EvalUnavailable): FactRuntimeOutcome {
  if (isUnavailable(value)) return { outcome: "unavailable", reason: value.reason, ...(value.evidence === undefined ? {} : { evidence: value.evidence }) };
  const score = typeof value === "number" ? value : value.score;
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    return { outcome: "errored", error: { class: "evaluator", code: "invalid-score", message: "Judge returned a score outside finite [0, 1]" } };
  }
  return {
    outcome: "scored",
    normalizedScore: score,
    ...(typeof value === "number" || value.evidence === undefined ? {} : { evidence: value.evidence }),
    ...(typeof value === "number" || value.rationale === undefined ? {} : { rationale: value.rationale }),
  };
}

function evaluatorError(error: unknown): EvaluationFactError {
  return {
    class: "evaluator",
    code: "evaluator-defect",
    message: error instanceof Error ? error.message : String(error),
  };
}
