// 断言收集器:test 期间记录断言(值级就地、作用域延迟),test 结束后对完整运行
// 结果(ScoringContext)统一 finalize 成 AssertionResult[],再交判决。

import type { AssertionResult, ScoringContext, Severity } from "../types.ts";
import { t } from "../i18n/index.ts";

/** 一条尚未评估的断言。evaluate 在 finalize 时拿到完整运行结果再算分 [0,1]。 */
export interface Spec {
  name: string;
  severity: Severity;
  threshold?: number;
  detail?: string;
  /** 所属分组(t.group 标题,可嵌套用 › 连接)。纯组织用,不影响打分。 */
  group?: string;
  evaluate(ctx: ScoringContext): number | Promise<number>;
}

/** 作者拿到的可链式句柄,改严重级 / 阈值(回头改 spec)。 */
export interface RecordHandle {
  atLeast(threshold: number): RecordHandle;
  gate(): RecordHandle;
  soft(threshold?: number): RecordHandle;
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
    this.specs.push(spec);
    const handle: RecordHandle = {
      atLeast(threshold) {
        spec.severity = "soft";
        spec.threshold = threshold;
        return handle;
      },
      gate() {
        spec.severity = "gate";
        spec.threshold = undefined;
        return handle;
      },
      soft(threshold) {
        spec.severity = "soft";
        if (threshold !== undefined) spec.threshold = threshold;
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
      try {
        score = await spec.evaluate(ctx);
      } catch (e) {
        score = 0;
        detail = `${detail ? detail + "; " : ""}${t("scoring.evalError", {
          error: e instanceof Error ? e.message : String(e),
        })}`;
      }
      out.push({
        name: spec.name,
        severity: spec.severity,
        threshold: spec.threshold,
        score,
        passed: computePassed(spec.severity, spec.threshold, score),
        detail,
        group: spec.group,
      });
    }
    return out;
  }
}

export function computePassed(severity: Severity, threshold: number | undefined, score: number): boolean {
  if (severity === "gate") return score >= (threshold ?? 1);
  return threshold === undefined ? true : score >= threshold;
}
