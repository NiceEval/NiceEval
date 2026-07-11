// 断言收集器:test 期间记录断言(值级就地、作用域延迟),test 结束后对完整运行
// 结果(ScoringContext)统一 finalize 成 AssertionResult[],再交判定。

import type { AssertionResult, ScoringContext, Severity, SourceLoc } from "../types.ts";
import { captureLoc } from "../source-loc.ts";
import { t } from "../i18n/index.ts";
import { formatThrown } from "../util.ts";

export interface EvalScore {
  score: number;
  detail?: string;
  /** 这条分数是看着什么材料算出来的(judge 收到的输入,或 t.check 失败时实际被检查的值);供 view 展开排查「为什么是这个分」。 */
  evidence?: string;
}

/** 一条尚未评估的断言。evaluate 在 finalize 时拿到完整运行结果再算分 [0,1]。 */
export interface Spec {
  name: string;
  severity: Severity;
  threshold?: number;
  detail?: string;
  /** 所属分组(t.group 标题,可嵌套用 › 连接)。纯组织用,不影响打分。 */
  group?: string;
  /** 断言在 eval 源码里的调用点(record 时栈回溯抠出)。 */
  loc?: SourceLoc;
  evaluate(ctx: ScoringContext): number | EvalScore | Promise<number | EvalScore>;
}

/** 作者拿到的可链式句柄,改严重级 / 阈值(回头改 spec)。 */
export interface RecordHandle {
  atLeast(threshold: number): RecordHandle;
  gate(threshold?: number): RecordHandle;
}

export class AssertionCollector {
  private readonly specs: Spec[] = [];
  private readonly groupStack: string[] = [];

  get hasEntries(): boolean {
    return this.specs.length > 0;
  }

  /** t.group(title, fn) 期间入栈;栈内 record 的断言都打上当前(嵌套则 › 连接)分组标题。 */
  async withGroup<T>(title: string, fn: () => Promise<T> | T): Promise<T> {
    this.groupStack.push(title);
    try {
      return await fn();
    } finally {
      this.groupStack.pop();
    }
  }

  record(spec: Spec): RecordHandle {
    if (spec.group === undefined && this.groupStack.length > 0) {
      spec.group = this.groupStack.join(" › ");
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
    };
    return handle;
  }

  async finalize(ctx: ScoringContext): Promise<AssertionResult[]> {
    const out: AssertionResult[] = [];
    for (const spec of this.specs) {
      let score = 0;
      let detail = spec.detail;
      let evidence: string | undefined;
      try {
        const raw = await spec.evaluate(ctx);
        if (typeof raw === "number") {
          score = raw;
        } else {
          score = raw.score;
          if (raw.detail) detail = detail ? `${detail}; ${raw.detail}` : raw.detail;
          evidence = raw.evidence;
        }
      } catch (e) {
        score = 0;
        detail = `${detail ? detail + "; " : ""}${t("scoring.evalError", {
          error: formatThrown(e),
        })}`;
      }
      out.push({
        name: spec.name,
        severity: spec.severity,
        threshold: spec.threshold,
        score,
        passed: computePassed(spec.severity, spec.threshold, score),
        detail,
        evidence,
        group: spec.group,
        loc: spec.loc,
      });
    }
    return out;
  }
}

export function computePassed(severity: Severity, threshold: number | undefined, score: number): boolean {
  if (severity === "gate") return threshold === undefined ? score > 0 : score >= threshold;
  return threshold === undefined ? true : score >= threshold;
}
