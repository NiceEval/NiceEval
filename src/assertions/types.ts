// assertions 域类型:值断言(expect 匹配器)、断言记录与结果、断言求值上下文、judge 配置。

import type { Severity, SourceLoc } from "../shared/types.ts";
import type { DerivedFacts, StreamEvent, Usage } from "../o11y/types.ts";
import type { ResolvedEvidenceCoverage } from "./coverage.ts";

// ── Evaluation facts ──────────────────────────────────────────────────────
//
// A Fact is deliberately not an assertion handle.  Producers only describe a
// piece of evidence; verdict and score consumers live in context/collector.
// The brands stay module-private so callers cannot manufacture a Fact that is
// not owned by the current Attempt collector.

export type FactPhase = "now" | "final";

declare const evaluationFactBrand: unique symbol;
declare const evidenceSourceBrand: unique symbol;
declare const usageEvidenceFactBrand: unique symbol;
declare const scoreCompletionBrand: unique symbol;

export interface BooleanFact<out R = unknown, P extends FactPhase = FactPhase> {
  readonly kind: "boolean";
  readonly phase: P;
  readonly [evaluationFactBrand]: () => R;
}

export interface ScoreFact<P extends FactPhase = FactPhase> {
  readonly kind: "score";
  readonly phase: P;
  readonly [evaluationFactBrand]: () => number;
}

/** A source whose material is intentionally resolved only when its Fact runs. */
export interface EvidenceSource<out T, P extends FactPhase = "final"> {
  readonly phase: P;
  /** Module-private provenance prevents callers from manufacturing a deferred source. */
  readonly [evidenceSourceBrand]: () => T;
}

/** Narrow core-only capability for usage coverage; ordinary Facts cannot opt out. */
export interface UsageEvidenceFact<P extends FactPhase = FactPhase> extends BooleanFact<unknown, P> {
  readonly [usageEvidenceFactBrand]: true;
}

export interface FactUseOptions {
  readonly key?: string;
  readonly label?: string;
}

export interface ScoreThresholdOptions extends FactUseOptions {
  readonly atLeast: number;
}

/** Private completion token returned by `finishScore()` on the normal path. */
export interface ScoreCompletion {
  readonly [scoreCompletionBrand]: true;
}

export interface FactResultBase {
  readonly factId: string;
  readonly name: string;
  readonly groupPath?: readonly string[];
  readonly producerLoc?: SourceLoc;
  readonly sourceOrder: number;
  readonly dependencyFactIds: readonly string[];
  readonly expected?: string;
  readonly received?: string;
  readonly evidence?: string;
}

/** A terminal Attempt issue as seen by Fact folding; Fact evaluator errors narrow this further. */
export interface AttemptFactError {
  readonly class: "agent" | "execution" | "author" | "evaluator";
  readonly code: string;
  readonly message: string;
}

export interface EvaluationFactError extends AttemptFactError {
  readonly class: "evaluator";
}

export type EvaluationFactResult =
  | (FactResultBase & {
      readonly factKind: "boolean";
      readonly outcome: "passed" | "failed";
    })
  | (FactResultBase & {
      readonly factKind: "score";
      readonly outcome: "scored";
      readonly normalizedScore: number;
    })
  | (FactResultBase & {
      readonly factKind: "boolean" | "score";
      readonly outcome: "unavailable";
      readonly reason: string;
    })
  | (FactResultBase & {
      readonly factKind: "boolean" | "score";
      readonly outcome: "errored";
      readonly error: EvaluationFactError;
    })
  | (FactResultBase & {
      readonly factKind: "boolean" | "score";
      readonly outcome: "notReachedByControl" | "notReachedByError";
      readonly reason: string;
    });

export interface FactUseBase {
  readonly key?: string;
  readonly consumerLoc?: SourceLoc;
  readonly sourceOrder: number;
}

export type VerdictFactUseResult = FactUseBase & {
  readonly useKind: "verdict";
  readonly method: "assert" | "require" | "assertIfCovered";
  readonly label?: string;
  readonly target:
    | { readonly kind: "boolean"; readonly factId: string }
    | { readonly kind: "score"; readonly factId: string; readonly atLeast: number };
} & (
    | { readonly outcome: "passed" | "failed" }
    | { readonly outcome: "unavailable" | "notApplicable"; readonly reason: string }
    | { readonly outcome: "errored"; readonly error: EvaluationFactError }
    | { readonly outcome: "notReachedByControl" | "notReachedByError"; readonly reason: string }
  );

export type ScoreFactUseResult = FactUseBase & {
  readonly useKind: "score";
  readonly label: string;
} & (
    | {
        readonly input: { readonly kind: "direct"; readonly earned: number };
        readonly outcome: "scored";
        readonly earned: number;
      }
    | ({
        readonly input: { readonly kind: "fact"; readonly factId: string; readonly max: number };
      } &
        (
          | { readonly outcome: "scored"; readonly earned: number }
          | { readonly outcome: "unavailable"; readonly reason: string }
          | { readonly outcome: "errored"; readonly error: EvaluationFactError }
          | { readonly outcome: "notReachedByControl" | "notReachedByError"; readonly reason: string }
        ))
  );

interface LegacyJudgeResultBase {
  readonly name: `judge:${string}`;
  readonly detail: string;
  /**
   * 有界的 Autoevals 自述理由。它只属于旧 Judge → Fact trace 的私有桥接字段：不是作者传给
   * Judge 的输入，也不能拿 Judge 的 evidence（可能是一整个 Turn）冒充这个理由。
   */
  readonly rationale?: string;
  readonly groupPath?: readonly string[];
  readonly loc?: SourceLoc;
  readonly sourceOrder: number;
}

interface LegacyJudgePolicyBase {
  readonly verdict:
    | { readonly kind: "gate"; readonly atLeast: number }
    | { readonly kind: "soft"; readonly atLeast?: number };
  readonly optional: boolean;
  readonly stopOnFailure: boolean;
}

export type LegacyJudgePolicy = LegacyJudgePolicyBase & (
  | { readonly scoring: { readonly kind: "quality" } }
  | { readonly scoring: { readonly kind: "points"; readonly max: number } }
);

/** The closed, private-bridge result envelope for one registered Judge spec. */
export type LegacyJudgeAssertionResult =
  | (LegacyJudgeResultBase & {
      readonly policy: LegacyJudgePolicyBase & { readonly scoring: { readonly kind: "quality" } };
      readonly outcome: "passed" | "failed";
      readonly normalizedScore: number;
      readonly evidence?: string;
    })
  | (LegacyJudgeResultBase & {
      readonly policy: LegacyJudgePolicyBase & { readonly scoring: { readonly kind: "points"; readonly max: number } };
      readonly outcome: "passed" | "failed";
      readonly normalizedScore: number;
      readonly earnedPoints: number;
      readonly evidence?: string;
    })
  | (LegacyJudgeResultBase & {
      readonly policy: LegacyJudgePolicy;
      readonly outcome: "unavailable";
      readonly reason: string;
      readonly evidence?: string;
    })
  | (LegacyJudgeResultBase & {
      readonly policy: LegacyJudgePolicy;
      readonly outcome: "errored";
      readonly error: EvaluationFactError;
    })
  | (LegacyJudgeResultBase & {
      readonly policy: LegacyJudgePolicy;
      readonly outcome: "notReachedByControl" | "notReachedByError";
      readonly reason: string;
    });

export interface AttemptFactTrace {
  readonly facts: readonly EvaluationFactResult[];
  readonly uses: readonly (VerdictFactUseResult | ScoreFactUseResult)[];
  readonly legacyJudgeAssertions: readonly LegacyJudgeAssertionResult[];
}

export interface UnavailableAttemptIssue {
  readonly kind: "unavailable";
  readonly reason: string;
  readonly factId?: string;
  readonly useSourceOrder?: number;
  readonly legacyJudgeSourceOrder?: number;
}

export interface ErrorAttemptIssue {
  readonly kind: "error";
  readonly error: AttemptFactError;
  readonly factId?: string;
  readonly useSourceOrder?: number;
  readonly legacyJudgeSourceOrder?: number;
}

export type AttemptFactIssue = UnavailableAttemptIssue | ErrorAttemptIssue;

export type PassFactAttemptOutcome =
  | { readonly verdict: "passed" | "failed" }
  | { readonly verdict: "errored"; readonly issues: readonly [AttemptFactIssue, ...AttemptFactIssue[]] }
  | { readonly verdict: "skipped"; readonly reason: string };

export type ScoreFactAttemptOutcome =
  | { readonly status: "scored"; readonly earnedScore: number; readonly creditedScore: number }
  | {
      readonly status: "invalid";
      readonly earnedScore: number;
      readonly creditedScore: 0;
      readonly issues: readonly AttemptFactIssue[];
    }
  | {
      readonly status: "unavailable";
      readonly earnedScore: number;
      readonly creditedScore: null;
      readonly issues: readonly [UnavailableAttemptIssue, ...UnavailableAttemptIssue[]];
    }
  | {
      readonly status: "errored";
      readonly earnedScore: number;
      readonly creditedScore: null;
      readonly errors: readonly [ErrorAttemptIssue, ...ErrorAttemptIssue[]];
      readonly issues: readonly UnavailableAttemptIssue[];
    }
  | { readonly status: "skipped"; readonly earnedScore: number; readonly creditedScore: null; readonly reason: string };

// 覆盖代数(解析 / 降级 / 聚合)住在 coverage.ts;类型经这里进聚合 facade(src/types.ts)。
export type {
  EvidenceCoverageChannel,
  ResolvedEvidenceCoverage,
  ResolvedEvidenceCoverageEntry,
  ResolvedEvidenceCoverageStatus,
} from "./coverage.ts";

/**
 * 断言记录的公共字段(见 docs/feature/assertions/architecture.md「断言记录」——字段契约的单点定义)。
 */
export interface AssertionBase {
  /** 断言标题:t.group 内是该断言自己的摘要,组外是 matcher 摘要或 judge 问题;show/view 失败行的标题。 */
  name: string;
  /** 所属分组路径:外层在前的 t.group 标题数组;无分组省略。纯报告用,不影响判定。 */
  groupPath?: string[];
  severity: Severity;
  /** 作者链过 `.stopOnFailure()`；仅在本条 failed 时停止后续 test 代码，与 severity 正交。 */
  stopOnFailure?: true;
  /** 作者用 .optional() 显式允许该断言缺席;只改变 unavailable 的折叠方式(见 Severity 与 Verdict),不改变 severity 语义。 */
  optional?: true;
  /** matcher / judge 摘要,如 `equals(4)`、`closedQA("…")`;与 name 分开,供 show/view 同时展示分组标题与检查方式。 */
  detail?: string;
  /** 断言在 eval 源码中的调用点,`--source` 把结果标回源码行的锚。 */
  loc?: SourceLoc;
  /**
   * 这条源码事实在当前 attempt 内的发生顺序。历史记录可省略；当前 collector 对每条新结果必写，
   * 与 `ScoreEntry.sourceOrder`、用户 message 的 `sourceOrder` 共用同一条单调序列。
   */
  sourceOrder?: number;
  /**
   * `.points(n)` 声明的可得分值。计分制里链过 `.points()` 的结果必写，包括 failed 与
   * unavailable；通过制和未链 `.points()` 的断言省略。它与实得分 `points` 是两项独立事实。
   */
  pointsAvailable?: number;
}

/**
 * 断言评估完的结果(进判定 / 报告)。判别键是 `outcome`——`unavailable` 是没有分数的独立态,
 * 普通聚合代码按 `outcome` 分支就不可能把证据缺口算成零分。判定只消费
 * `severity` / `outcome` / `optional` / `score` / `threshold`。
 */
export type AssertionResult =
  | (AssertionBase & {
      outcome: "passed" | "failed";
      /** 归一化得分:值断言 0/1,judge 等打分断言 0..1。 */
      score: number;
      /** soft 断言的 .atLeast(x) 阈值;没有设阈值则省略。 */
      threshold?: number;
      /** 失败证据摘要:期望值的有界文本预览,供 show/view 直接展示。 */
      expected?: string;
      /** 失败证据摘要:实际值的有界文本预览。 */
      received?: string;
      /** 这条分数看着什么材料算出(judge 输入或被检查值预览);view 展开排查用,默认不展示。 */
      evidence?: string;
      /**
       * `.points(n)` 挂在这条断言上的挣分:`n × score`。只在计分制 eval 里链过 `.points()` 时出现
       * (见 docs/feature/experiments/score-points.md「计分制:叠加给分,没有上限声明」)。
       */
      points?: number;
    })
  | (AssertionBase & {
      outcome: "unavailable";
      /** 机器可读原因,如 "judge-model-unresolved"、"evidence-coverage:actions=partial"。 */
      reason: string;
      /** 证据通道的状态或异常摘要；judge 调用失败时用于说明 HTTP 状态或异常。 */
      evidence?: string;
    });

/**
 * `t.score(label, n)` 的直接给分记录(见 docs/feature/assertions/architecture.md「断言记录」)。
 * 与 `AssertionResult` 分属两个数组——它不是一条被评估的断言,没有 severity、没有 outcome,
 * 不参与判定或质量分,只贡献分数面。
 */
export interface ScoreEntry {
  /** 作者传入的 label,原样进报告。 */
  label: string;
  /** 直接给分,n >= 0。 */
  points: number;
  /** 所属分组路径,同 AssertionBase.groupPath;规则一致(外层在前的 t.group 标题数组)。 */
  groupPath?: string[];
  /** 调用点,同 AssertionBase.loc。 */
  loc?: SourceLoc;
  /** 与断言、用户 send 共用的 attempt 级发生顺序；历史记录可省略，当前 collector 必写。 */
  sourceOrder?: number;
}

/**
 * 摘要面从完整 `AssertionResult[]` 选出的一条主失败断言。它只负责展示，不参与 verdict；
 * `show @locator` / view Attempt 详情仍读取完整断言数组。字段保持结构化，使 CI 不必解析
 * Human 的 `gate: …` 文案。
 */
export interface PrimaryAssertionSummary {
  severity: Severity;
  /** `groupPath.join(" > ")`，无 group 时回退到断言 name。 */
  assertion: string;
  /** `detail ?? name`；与 assertion 相同时省略，避免重复。 */
  matcher?: string;
  expected?: string;
  received?: string;
  score?: number;
  threshold?: number;
  /** unavailable 断言的结构化原因。 */
  reason?: string;
  /** 计分制 `.points(n)` 挣到的分（`n × score`）；单行摘要的尾缀，见
   *  docs/feature/assertions/library/display.md「计分制」。 */
  points?: number;
  /** 同类因果失败（或计分制 passed 分支下：其余丢分得分点）中除主失败外的条数。 */
  additionalFailures: number;
}

/**
 * 两种题型的断言句柄共有的部分。泛型上下文(`TestContext<H>` 等)按它约束 `H`,
 * 使通过制的 `AssertionHandle` 与计分制的 `ScoreAssertionHandle` 各自增删方法。
 */
export interface BaseAssertionHandle {
  gate(threshold?: number): BaseAssertionHandle;
  /** 在调用位置立即结算；failed 时保留结果并中止 test，通过时返回句柄。 */
  stopOnFailure(): Promise<BaseAssertionHandle>;
  /** 降级为纯记录的软断言:不设线,分数照实落盘、永不使该条 failed。无参数——要设线用 .atLeast(threshold)。 */
  soft(): BaseAssertionHandle;
  /** 允许这条断言证据缺席:unavailable 只保留在记录里,不影响判定(见 Severity 与 Verdict)。 */
  optional(): BaseAssertionHandle;
}

/** eval 作者拿到的可链式句柄(t.judge.autoevals.closedQA(...).atLeast(0.7))。 */
export interface AssertionHandle extends BaseAssertionHandle {
  atLeast(threshold: number): AssertionHandle;
  /** 升级为硬门槛:不过即整条 eval failed；是否中止只由 `.stopOnFailure()` 决定。 */
  gate(threshold?: number): AssertionHandle;
  stopOnFailure(): Promise<AssertionHandle>;
  soft(): AssertionHandle;
  optional(): AssertionHandle;
}

/**
 * 计分制(`defineScoreEval`)才暴露的断言句柄。一条断言只扮演一个角色,由链上的词决定:
 * `.points(n)` 得分点(进分数面)、`.gate(x?)` 前置(挂了就地结束 `test()`)、什么都不链或
 * `.soft()` / `.atLeast(x)` 观测(进质量分)。通过制的 `t` 上则没有 `.points(...)`,两边都是
 * 类型层拒绝,不需要运行时守护(见 docs/feature/experiments/score-points.md)。
 */
export interface ScoreAssertionHandle extends BaseAssertionHandle {
  /**
   * 挂在这条断言上的条件给分:0/1 断言通过挣 `n` 分、不过挣 0;judge 等打分断言按连续分比例
   * 挣 `n × score`。`n` 必须为正数。返回的句柄上只剩 `.gate()` / `.optional()`——得分点已经
   * 用分数表达了分量,再进质量分就是同一条证据被读两遍。
   */
  points(n: number): ScorePointHandle;
  /** 硬要求:未过会使 Attempt failed；是否中止只由 `.stopOnFailure()` 决定。 */
  gate(threshold?: number): ScoreAssertionHandle;
  stopOnFailure(): Promise<ScoreAssertionHandle>;
  /**
   * 给观测设通过线:低于 `x` 如实记 failed,**永不影响判定**(计分制的判定面只认前置中止,
   * 不会被全局模式隐式升级)。judge 这类默认没有线的打分断言靠它把「装好了但质量差」显示成 ✗;
   * 0/1 断言不需要它——matcher 自带的线在计分制照常生效。
   */
  atLeast(threshold: number): ScoreAssertionHandle;
  soft(): ScoreAssertionHandle;
  optional(): ScoreAssertionHandle;
}

/** 链过 `.points(n)` 之后的句柄:只能再声明前置与缺席策略。 */
export interface ScorePointHandle {
  /** 把得分点同时声明为硬要求；未过会使 Attempt failed，但不会隐式中止。 */
  gate(threshold?: number): ScorePointHandle;
  /** 在调用位置立即结算；failed 时保留得分与断言结果并中止 test。 */
  stopOnFailure(): Promise<ScorePointHandle>;
  optional(): ScorePointHandle;
}

/** scoped / judge 断言在 final 评估时拿到的运行结果。 */
export interface AssertionEvaluationContext {
  readonly events: readonly StreamEvent[];
  readonly facts: DerivedFacts;
  readonly diff: DiffData;
  readonly scripts: globalThis.Record<string, ScriptResult>;
  readonly usage: Usage;
  readonly status: "completed" | "failed" | "waiting";
  /** 当前作用域(turn / session / attempt)解析后的证据覆盖;断言按它做三值折叠(见 scoped.ts)。 */
  readonly evidenceCoverage: ResolvedEvidenceCoverage;
  /** 读沙箱里某文件的最终内容(judge / file 断言用)。 */
  readFile(path: string): Promise<string | undefined>;
}

export interface ScriptResult {
  success: boolean;
  output: string;
}

// ── agent 归因增量(见 docs/feature/record/architecture.md「diff.json」与
//    docs/feature/sandbox/architecture.md「变更归因:send 窗口与分类账」)──

/** diff.json 的落盘形状:按时序的窗口数组(逐窗口 delta 序列,不做跨窗口压缩)。 */
export type DiffArtifact = DiffWindow[];

export interface DiffWindow {
  /** send 窗口标签,与时间树 turn 节点、--execution 轮次同源(如 "turn2" 或 "session2/turn1")。 */
  window: string;
  /** 该窗口内 agent 改动的文件;窗口内没有 workspace 变化时窗口仍落一条、changes 为空对象。 */
  changes: globalThis.Record<string, WindowChange>;
}

export interface WindowChange {
  status: "added" | "modified" | "deleted";
  /** 窗口开始时的内容;added 无此字段;内容被省略(elided)时也缺席。 */
  before?: string;
  /** 窗口结束时的内容;deleted 无此字段;内容被省略(elided)时也缺席。 */
  after?: string;
  /**
   * 内容不内联、只记字节数的条目:二进制文件,或超过单文件阈值(1 MiB)的文本。
   * 存在时 before / after 缺席,status 与字节数照常记录。
   */
  elided?: { reason: "binary" | "oversized-text"; beforeBytes?: number; afterBytes?: number };
}

/** 读取面在窗口序列之上派生的文件级视图(派生物可随时重算,不落盘)。 */
export interface DiffFileSummary {
  /** 净效果:首个触及窗口的起点 vs 最后触及窗口的终点;"none" = 动过但净无变化(创建又删除、改回原样)。 */
  net: "added" | "modified" | "deleted" | "none";
  /** 触及该文件的窗口标签,按时序。 */
  windows: string[];
  /** 内容被省略的文件带省略原因;省略语义单源在 WindowChange.elided。 */
  elided?: "binary" | "oversized-text";
}

/** agent 归因 diff 的消费视图:窗口序列(落盘事实)+ 派生的文件级摘要与终态读取。 */
export interface DiffData {
  /** 落盘事实,原样。 */
  windows: DiffWindow[];
  /** 派生:每个被 agent 触及的文件一条。 */
  files: globalThis.Record<string, DiffFileSummary>;
  /** 该文件最后一个触及窗口结束时的内容;净删除或从未触及返回 undefined。t.sandbox.diff.get 同一语义。 */
  get(path: string): string | undefined;
}

export type { Verdict } from "../shared/types.ts";

export interface JudgeConfig {
  /** 可由更低优先级层补齐；四层都未解析到时，实际 assertion 记 judge-model-unresolved。 */
  model?: string;
  /** OpenAI 兼容 base url;省略时使用官方 https://api.openai.com/v1 端点。 */
  baseUrl?: string;
  apiKeyEnv?: string;
  /**
   * 单次判分调用的上限,毫秒;两层都没写即 180_000。到点中断这次调用,该条断言记
   * `outcome: "unavailable"` + `reason: "judge-call-failed"`,`evidence` 写明超时秒数
   * (判分调用不重试)。与 `model` / `baseUrl` / `apiKeyEnv` 同链逐字段解析:Experiment
   * → Eval → 项目 config → 默认值。
   */
  timeoutMs?: number;
}
