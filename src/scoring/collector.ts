// 断言收集器:test 期间记录断言(值断言就地、作用域断言延迟),test 结束后对完整运行
// 结果(ScoringContext)统一 finalize 成 AssertionResult[],再交判定。

import type { AssertionResult, ScoringContext, Severity, SourceLoc } from "../types.ts";
import { captureLoc } from "../source-loc.ts";
import { t } from "../i18n/index.ts";
import { formatThrown } from "../util.ts";

export interface EvalScore {
  score: number;
  detail?: string;
  /** 期望条件的有界文本预览(如 `contains "Brooklyn"`),失败时供 show/view 直接展示。 */
  expected?: string;
  /** 实际值的有界文本预览(被检查值 / 作用域内实际调用清单)。 */
  received?: string;
  /** 这条分数是看着什么材料算出来的(judge 收到的输入等);供 view 展开排查「为什么是这个分」。 */
  evidence?: string;
}

/** evaluate 返回它表示「这条断言评不了」:证据通道不完整 / judge 未解析到模型等。 */
export interface EvalUnavailable {
  unavailable: true;
  /** 机器可读原因,如 "judge-model-unresolved"、"coverage:actions=partial"。 */
  reason: string;
}

/** 构造 EvalUnavailable 的便捷工厂(scoped / judge 断言用)。 */
export function unavailable(reason: string): EvalUnavailable {
  return { unavailable: true, reason };
}

function isUnavailable(v: unknown): v is EvalUnavailable {
  return typeof v === "object" && v !== null && (v as EvalUnavailable).unavailable === true;
}

/** 一条尚未评估的断言。evaluate 在 finalize 时拿到完整运行结果再算分 [0,1](或报告评不了)。 */
export interface Spec {
  name: string;
  severity: Severity;
  threshold?: number;
  /** 作者用 .optional() 显式允许该断言证据缺席;unavailable 只保留在记录里,不影响判定。 */
  optional?: true;
  detail?: string;
  /** 所属分组路径(外层在前的 t.group 标题数组)。纯组织用,不影响打分。 */
  groupPath?: string[];
  /** 断言在 eval 源码里的调用点(record 时栈回溯抠出)。 */
  loc?: SourceLoc;
  evaluate(ctx: ScoringContext): number | EvalScore | EvalUnavailable | Promise<number | EvalScore | EvalUnavailable>;
}

/** 作者拿到的可链式句柄,改严重度 / 阈值 / optional(回头改 spec)。 */
export interface RecordHandle {
  atLeast(threshold: number): RecordHandle;
  gate(threshold?: number): RecordHandle;
  optional(): RecordHandle;
}

export class AssertionCollector {
  private readonly specs: Spec[] = [];
  private readonly groupStack: string[] = [];

  get hasEntries(): boolean {
    return this.specs.length > 0;
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
    this.specs.push(spec);
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
      optional() {
        spec.optional = true;
        return handle;
      },
    };
    return handle;
  }

  async finalize(ctx: ScoringContext): Promise<AssertionResult[]> {
    const out: AssertionResult[] = [];
    for (const spec of this.specs) {
      const base = {
        name: spec.name,
        severity: spec.severity,
        ...(spec.optional ? { optional: true as const } : {}),
        ...(spec.detail !== undefined ? { detail: spec.detail } : {}),
        ...(spec.groupPath !== undefined ? { groupPath: spec.groupPath } : {}),
        ...(spec.loc !== undefined ? { loc: spec.loc } : {}),
      };
      let score = 0;
      let detail = spec.detail;
      let expected: string | undefined;
      let received: string | undefined;
      let evidence: string | undefined;
      try {
        const raw = await spec.evaluate(ctx);
        if (isUnavailable(raw)) {
          out.push({ ...base, outcome: "unavailable", reason: raw.reason });
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
      } catch (e) {
        score = 0;
        detail = `${detail ? detail + "; " : ""}${t("scoring.evalError", {
          error: formatThrown(e),
        })}`;
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
      });
    }
    return out;
  }
}

export function computePassed(severity: Severity, threshold: number | undefined, score: number): boolean {
  if (severity === "gate") return threshold === undefined ? score > 0 : score >= threshold;
  return threshold === undefined ? true : score >= threshold;
}
