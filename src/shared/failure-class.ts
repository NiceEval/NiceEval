// 执行失败分类的词表、抛出点糖衣类与结构守卫——全仓唯一一份两轴词表,turn 失败、生命周期
// 阶段失败与 sandbox provisioning 失败说同一种语言(判据见
// docs/feature/error-classification/README.md「分类」)。
//
// 本模块刻意零依赖(只 import type):公开面活在 Promise 世界,糖衣类不继承任何 effect 类型,
// 生成的 .d.ts 零 effect 依赖(见 architecture.md「Effect 边界」)。turn 链的实现在
// src/context/turn-errors.ts,provisioning 的内部分类在 src/sandbox/,两边各自实现、只共享
// 这份词表。

import type { LifecyclePhase } from "../runner/types.ts";

/** 空间轴取值:失败死因的波及范围。 */
export type FailureScope = "attempt" | "eval" | "experiment";

/**
 * 一次执行失败的分类:`retryable`(时间轴)与 `scope`(空间轴)是仅有的两条决策轴;
 * `reason` 是开放词表的细分诊断,只进 activity 与诊断文案,不参与策略。内建兜底产出
 * reason `"rate_limit"` / `"network"`;声明方可自造词。`scope` 缺省 `"attempt"`。
 *
 * `retryable: true` 时 `reason` 必填:可重试的失败一定出现在 activity 行与可能的耗尽摘要里,
 * 那里需要一个给人读的词;不可重试的失败常常说不清是什么(这正是它不可重试的原因)。
 */
export type FailureClass =
  | { readonly retryable: true; readonly reason: string; readonly scope?: FailureScope }
  | { readonly retryable: false; readonly reason?: string; readonly scope?: FailureScope };

/**
 * 实验级分类器的输入:本实验任意 per-attempt 阶段的一次终局失败。
 */
export interface AttemptFailureInfo {
  /** 失败发生在哪个生命周期阶段;turn 失败恒为 `"agent.run"`。 */
  readonly phase: LifecyclePhase;
  /** 与报错文案同源的失败文本:thrown 取错误链(含 cause 链)message 串接,turn 失败取 `turnErrorText`。 */
  readonly text: string;
  /** 原始失败对象:thrown 形态是抛出的错误,turn 失败形态是那个失败 Turn。 */
  readonly cause: unknown;
}

/**
 * 实验可选分类器,挂载在 `ExperimentDef.classifyFailure`:识别自家共享基建的死因
 * (对自家隧道 host 的拒连一类)。返回 `undefined` 表示「不认识,交给后续链路」。
 * 分类器必须快、纯、不抛错——抛错按 `undefined` 回落并被吞掉,不掩盖原始失败。
 */
export type AttemptFailureClassifier = (failure: AttemptFailureInfo) => FailureClass | undefined;

/** 携带分类的错误对象的判别字段值;识别只看这个数据字段,不看类身份。 */
const FAILURE_CLASS_TAG = "NiceevalClassifiedError";

/**
 * 从任意 per-attempt 阶段抛出:全实验剩余 attempt 同因必死,停止派发。
 * 携带 `{ retryable: false, scope: "experiment" }`,message 原样走完反馈流与
 * `dispatch-halted` 诊断——把它写成「现象 + 下一步」的修复提示。
 */
export class ExperimentFatalError extends Error {
  readonly _tag = FAILURE_CLASS_TAG;
  readonly class: FailureClass = { retryable: false, scope: "experiment" };

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ExperimentFatalError";
  }
}

/**
 * 从任意 per-attempt 阶段抛出:本 eval 剩余 attempt 同因必死,停止派发。
 * 携带 `{ retryable: false, scope: "eval" }`;message 同样是走完全程的修复提示。
 */
export class EvalFatalError extends Error {
  readonly _tag = FAILURE_CLASS_TAG;
  readonly class: FailureClass = { retryable: false, scope: "eval" };

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EvalFatalError";
  }
}

/**
 * 结构守卫:识别任何携带分类的错误对象(`_tag` + `class` 两个数据字段),沿 `cause` 链逐层
 * 查找、取**最外层**命中——糖衣类被上层库包装再抛时声明不丢失。识别不依赖 `instanceof`:
 * 依赖树里出现第二份 niceeval 实例(link、版本重复)时类身份静默失效,数据不会。
 */
export function failureClassOf(error: unknown): FailureClass | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_CHAIN_DEPTH && current != null; depth++) {
    if (typeof current === "object") {
      const candidate = current as { _tag?: unknown; class?: unknown };
      if (candidate._tag === FAILURE_CLASS_TAG && isFailureClass(candidate.class)) return candidate.class;
    }
    current = causeOf(current);
  }
  return undefined;
}

/** cause 链与错误文本串接共用的深度上限:防御自引用 / 病态深链,不做环检测。 */
const CAUSE_CHAIN_DEPTH = 5;

function causeOf(value: unknown): unknown {
  return typeof value === "object" && value !== null ? (value as { cause?: unknown }).cause : undefined;
}

function isFailureClass(value: unknown): value is FailureClass {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { retryable?: unknown; reason?: unknown; scope?: unknown };
  if (typeof v.retryable !== "boolean") return false;
  if (v.retryable && typeof v.reason !== "string") return false;
  if (v.reason !== undefined && typeof v.reason !== "string") return false;
  if (v.scope !== undefined && v.scope !== "attempt" && v.scope !== "eval" && v.scope !== "experiment") return false;
  return true;
}

/**
 * @internal 把框架决议出的分类挂到即将浮出的失败对象上,供 attempt 封口经 `failureClassOf`
 * 读取(止损闸的消费点)。两个字段都不可枚举——不进 JSON、不进 console 输出,只是路由标记;
 * 已携带分类的对象不覆盖(抛出点声明优先),不可写对象静默跳过(分类是旁路,不制造新失败)。
 */
export function attachFailureClass<T>(target: T, cls: FailureClass): T {
  if (typeof target !== "object" || target === null) return target;
  if (failureClassOf(target) !== undefined) return target;
  try {
    Object.defineProperty(target, "_tag", { value: FAILURE_CLASS_TAG, enumerable: false, configurable: true });
    Object.defineProperty(target, "class", { value: cls, enumerable: false, configurable: true });
  } catch {
    // 冻结 / 密封的错误对象:标记不上就算了,分类退化成 attempt 档,不掩盖原始失败。
  }
  return target;
}

/**
 * @internal 错误链(含 `cause` 链)的 message 串接:给人读的报错文案与给分类器看的失败文本
 * 用这同一段,不出现「报错说 A、分类看 B」。
 */
export function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_CHAIN_DEPTH && current != null; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (message) parts.push(message);
    current = current instanceof Error ? causeOf(current) : undefined;
  }
  return parts.join(" · ");
}

/**
 * @internal 调分类器的统一纪律:抛错按 `undefined` 回落(自身错误被吞掉,不得用新错误掩盖
 * 原始失败),返回值原样透出。turn 链与生命周期链共用这一处,两条链的纪律不会跑偏。
 */
export function callClassifier<T>(classifier: ((failure: T) => FailureClass | undefined) | undefined, failure: T) {
  if (!classifier) return undefined;
  try {
    return classifier(failure);
  } catch {
    return undefined;
  }
}

/**
 * @internal 生命周期阶段失败的分类链(三道):抛出点携带的分类 → 实验分类器 → 缺省
 * `{ retryable: false }`。这些位置(sandbox 钩子、`EvalDef.setup`、`test(t)` 体内、
 * per-attempt teardown)没有重试执行体,链上不挂产时间轴的兜底正则——时间轴即使给出也无人
 * 消费(见 architecture.md「分类链」)。
 */
export function resolveAttemptFailureClass(
  info: AttemptFailureInfo,
  experimentClassifier?: AttemptFailureClassifier,
): FailureClass {
  const declared = failureClassOf(info.cause);
  if (declared) return declared;
  return callClassifier(experimentClassifier, info) ?? { retryable: false };
}

/** @internal 从一个抛出的错误构造实验分类器的输入(文本与报错文案同源)。 */
export function attemptFailureInfo(phase: LifecyclePhase, error: unknown): AttemptFailureInfo {
  return { phase, text: errorChainText(error), cause: error };
}
