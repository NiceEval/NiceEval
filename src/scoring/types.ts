// scoring 域类型:值断言(expect 匹配器)、断言记录与结果、评分上下文、judge 配置。

import type { Severity, SourceLoc } from "../shared/types.ts";
import type { DerivedFacts, StreamEvent, Usage } from "../o11y/types.ts";
import type { ResolvedCoverage } from "./coverage.ts";

// 覆盖代数(解析 / 降级 / 聚合)住在 coverage.ts;类型经这里进聚合 facade(src/types.ts)。
export type {
  CoverageChannel,
  ResolvedCoverage,
  ResolvedCoverageChannel,
  ResolvedCoverageStatus,
} from "./coverage.ts";

/** 值断言(expect 匹配器)。纯函数 score + 可链式改严重度 / 阈值 / optional。 */
export interface ValueAssertion {
  readonly name: string;
  readonly severity: Severity;
  readonly threshold?: number;
  /** `.optional()` 链过的标记:评不了只记 unavailable,不把 attempt 拖成 errored。 */
  readonly isOptional?: boolean;
  /** 期望条件的有界文本描述(如 `contains "Brooklyn"`),失败时进 AssertionResult.expected。 */
  readonly expected?: string;
  score(value: unknown): number | Promise<number>;
  /** 转成硬门槛断言:未达阈值(省略 threshold 则按 score > 0 判定)整条 eval 判为 failed。返回新实例,不改原对象。 */
  gate(threshold?: number): ValueAssertion;
  /**
   * 转成软阈值断言:未达 threshold 时该条记为 failed,但默认不拖累整条 eval 的 verdict;
   * `--strict` 运行下,软阈值失败也会把整条 eval 的 verdict 计为 failed。返回新实例,不改原对象。
   */
  atLeast(threshold: number): ValueAssertion;
  /**
   * 允许这条断言证据缺席:评不了时只记录 `outcome: "unavailable"`,不影响判定。
   * 与 severity 正交(severity 说影不影响质量判定,optional 说证据允不允许缺席)。返回新实例,不改原对象。
   */
  optional(): ValueAssertion;
}

/**
 * 断言记录的公共字段(见 docs/feature/scoring/architecture.md「断言记录」——字段契约的单点定义)。
 */
export interface AssertionBase {
  /** 断言标题:t.group 内是该断言自己的摘要,组外是 matcher 摘要或 judge 问题;show/view 失败行的标题。 */
  name: string;
  /** 所属分组路径:外层在前的 t.group 标题数组;无分组省略。纯报告用,不影响判定。 */
  groupPath?: string[];
  severity: Severity;
  /** 作者用 .optional() 显式允许该断言缺席;只改变 unavailable 的折叠方式(见 Severity 与 Verdict),不改变 severity 语义。 */
  optional?: true;
  /** matcher / judge 摘要,如 `equals(4)`、`closedQA("…")`;与 name 分开,供 show/view 同时展示分组标题与检查方式。 */
  detail?: string;
  /** 断言在 eval 源码中的调用点,`--eval` 把结果标回源码行的锚。 */
  loc?: SourceLoc;
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
    })
  | (AssertionBase & {
      outcome: "unavailable";
      /** 机器可读原因,如 "judge-model-unresolved"、"coverage:actions=partial"。 */
      reason: string;
    });

/** eval 作者拿到的可链式句柄(t.judge.autoevals.closedQA(...).atLeast(0.7))。 */
export interface AssertionHandle {
  atLeast(threshold: number): AssertionHandle;
  gate(threshold?: number): AssertionHandle;
  /** 允许这条断言证据缺席:unavailable 只保留在记录里,不影响判定(见 Severity 与 Verdict)。 */
  optional(): AssertionHandle;
}

/** scoped / judge 断言在 final 评估时拿到的运行结果。 */
export interface ScoringContext {
  readonly events: readonly StreamEvent[];
  readonly facts: DerivedFacts;
  readonly diff: DiffData;
  readonly scripts: Record<string, ScriptResult>;
  readonly usage: Usage;
  readonly status: "completed" | "failed" | "waiting";
  /** 当前作用域(turn / session / attempt)解析后的证据覆盖;断言按它做三值折叠(见 scoped.ts)。 */
  readonly coverage: ResolvedCoverage;
  /** 读沙箱里某文件的最终内容(judge / file 断言用)。 */
  readFile(path: string): Promise<string | undefined>;
}

export interface ScriptResult {
  success: boolean;
  output: string;
}

export interface DiffData {
  generatedFiles: Record<string, string>;
  deletedFiles: string[];
}

export type Verdict = "passed" | "failed" | "errored" | "skipped";

export interface JudgeConfig {
  model: string;
  /** OpenAI 兼容 base url + key 来源;省略则从 env 探测(见 scoring/judge.ts)。 */
  baseUrl?: string;
  apiKeyEnv?: string;
}
