// scoring 域类型:值级断言(expect 匹配器)、断言记录与结果、评分上下文、judge 配置。

import type { Severity, SourceLoc } from "../shared/types.ts";
import type { DerivedFacts, StreamEvent, Usage } from "../o11y/types.ts";

/** 值级断言(expect 匹配器)。纯函数 score + 可链式改严重级 / 阈值。 */
export interface ValueAssertion {
  readonly name: string;
  readonly severity: Severity;
  readonly threshold?: number;
  score(value: unknown): number | Promise<number>;
  /** 转成硬门槛断言:未达阈值(省略 threshold 则按 score > 0 判定)整条 eval 判为 failed。返回新实例,不改原对象。 */
  gate(threshold?: number): ValueAssertion;
  /**
   * 转成软阈值断言:未达 threshold 时该条记为 failed,但默认不拖累整条 eval 的 verdict;
   * `--strict` 运行下,软阈值失败也会把整条 eval 的 verdict 计为 failed。返回新实例,不改原对象。
   */
  atLeast(threshold: number): ValueAssertion;
}

/** 收集到 collector 里的一条断言记录(评估前)。 */
export interface AssertionSpec {
  name: string;
  severity: Severity;
  threshold?: number;
  /** 延迟评估:final 时拿到完整运行结果再算分。 */
  evaluate(ctx: ScoringContext): Promise<number> | number;
}

/** 断言评估完的结果(进判定 / 报告)。 */
export interface AssertionResult {
  name: string;
  severity: Severity;
  threshold?: number;
  score: number;
  passed: boolean;
  detail?: string;
  /** 这条分数是看着什么材料算出来的(judge 收到的输入,或 t.check 失败时实际被检查的值)。view 展开排查「为什么是这个分」,默认不展示。 */
  evidence?: string;
  /** 所属分组(t.group 标题)。纯报告用,不影响 passed/score。 */
  group?: string;
  /** 断言在 eval 源码里的调用点(栈回溯抠出);view 把判定叠回这一行。 */
  loc?: SourceLoc;
}

/** eval 作者拿到的可链式句柄(t.judge.autoevals.closedQA(...).atLeast(0.7))。 */
export interface AssertionHandle {
  atLeast(threshold: number): AssertionHandle;
  gate(threshold?: number): AssertionHandle;
}

/** scoped / judge 断言在 final 评估时拿到的运行结果。 */
export interface ScoringContext {
  readonly events: readonly StreamEvent[];
  readonly facts: DerivedFacts;
  readonly diff: DiffData;
  readonly scripts: Record<string, ScriptResult>;
  readonly usage: Usage;
  readonly status: "completed" | "failed" | "waiting";
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
