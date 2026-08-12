// assertions 域类型:值断言(expect 匹配器)、断言记录与结果、断言求值上下文、judge 配置。

import type { SourceLoc } from "../shared/types.ts";

// Historical fact-use result types remain only for the current Record reader
// bridge. Active authoring and evaluation use the Assert-first entry runtime.

export interface FactResultBase {
  readonly factId: string;
  readonly name: string;
  readonly groupPath?: readonly string[];
  readonly producerLoc?: SourceLoc;
  readonly sourceOrder: number;
  readonly dependencyFactIds: readonly string[];
  readonly expected?: string;
  readonly received?: string;
  /** Evaluator-supplied explanation, distinct from the scored material. */
  readonly explanation?: string;
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
  readonly method: "check" | "require" | "checkIfCovered";
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

export interface UnavailableAttemptIssue {
  readonly kind: "unavailable";
  readonly reason: string;
  readonly factId?: string;
  readonly useSourceOrder?: number;
}

export interface ErrorAttemptIssue {
  readonly kind: "error";
  readonly error: AttemptFactError;
  readonly factId?: string;
  readonly useSourceOrder?: number;
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


/** A structured one-line projection of the primary causal Fact/use. */
export interface PrimaryFactSummary {
  /** Fact use label, falling back to its Fact name or stable id. */
  title: string;
  /** Distinct producer name, when the use label names a different check. */
  matcher?: string;
  expected?: string;
  received?: string;
  /** Structured unavailable/evaluator reason. */
  reason?: string;
  /** Further causal Fact/use rows after this primary entry. */
  additionalFailures: number;
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

/** Eval-level declaration: `true` enables inherited configuration; an object also overrides it. */
export type JudgeDeclaration = true | JudgeConfig;

/** Frozen configuration consumed identically by fingerprinting, precheck, and evaluation. */
export interface ResolvedJudgeConfig {
  readonly model?: string;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly timeoutMs: number;
}

/** Explicit text material for a root-level Judge Fact. */
export interface JudgeMaterial {
  readonly input: string;
  readonly output: string;
}
