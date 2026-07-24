// cases: docs/engineering/testing/unit/eval.md
import { describe, expect, it, vi } from "vitest";
import {
  EvalFatalError,
  ExperimentFatalError,
  attachFailureClass,
  attemptFailureInfo,
  failureClassOf,
  resolveAttemptFailureClass,
  type AttemptFailureInfo,
} from "./failure-class.ts";

describe("糖衣类 · 抛出点声明空间轴", () => {
  it("ExperimentFatalError 携带 experiment 档,message 原样保留(它是走完全程的修复提示)", () => {
    const error = new ExperimentFatalError("server probe failed — 修好隧道后重跑");
    expect(failureClassOf(error)).toEqual({ retryable: false, scope: "experiment" });
    expect(error.message).toBe("server probe failed — 修好隧道后重跑");
  });

  it("EvalFatalError 携带 eval 档,cause 原样透传", () => {
    const cause = new Error("ENOENT");
    const error = new EvalFatalError("fixture 缺失", { cause });
    expect(failureClassOf(error)).toEqual({ retryable: false, scope: "eval" });
    expect(error.cause).toBe(cause);
  });

  it("糖衣类是纯 Error 子类:instanceof Error 成立,可被常规 catch 捕获", () => {
    expect(new ExperimentFatalError("x")).toBeInstanceOf(Error);
    expect(new EvalFatalError("x")).toBeInstanceOf(Error);
  });
});

describe("failureClassOf · 结构守卫", () => {
  it("识别不依赖类身份:结构相同的手工对象同样命中(第二份 niceeval 实例下也不失效)", () => {
    const impostor = { _tag: "NiceevalClassifiedError", class: { retryable: false, scope: "experiment" } };
    expect(failureClassOf(impostor)).toEqual({ retryable: false, scope: "experiment" });
  });

  it("沿 cause 链穿透:糖衣类被上层库包装再抛,声明不丢失", () => {
    const wrapped = new Error("sdk wrapper", { cause: new Error("layer 2", { cause: new EvalFatalError("boom") }) });
    expect(failureClassOf(wrapped)).toEqual({ retryable: false, scope: "eval" });
  });

  it("取最外层命中:内外都带分类时,外层的声明生效", () => {
    const outer = new ExperimentFatalError("outer", { cause: new EvalFatalError("inner") });
    expect(failureClassOf(outer)).toEqual({ retryable: false, scope: "experiment" });
  });

  it("没有分类的错误、非对象值一律 undefined", () => {
    expect(failureClassOf(new Error("plain"))).toBeUndefined();
    expect(failureClassOf("just a string")).toBeUndefined();
    expect(failureClassOf(undefined)).toBeUndefined();
  });

  it("`_tag` 对但 class 字段形状非法的对象不算命中(不把垃圾当分类喂给执行体)", () => {
    expect(failureClassOf({ _tag: "NiceevalClassifiedError", class: { retryable: "yes" } })).toBeUndefined();
    // retryable: true 必须带 reason(类型级规则),运行时进来的非法组合同样不认
    expect(failureClassOf({ _tag: "NiceevalClassifiedError", class: { retryable: true } })).toBeUndefined();
    expect(failureClassOf({ _tag: "NiceevalClassifiedError", class: { retryable: false, scope: "run" } })).toBeUndefined();
  });
});

describe("attachFailureClass · 框架决议出的分类附着", () => {
  it("挂上的两个字段不可枚举:不进 JSON,只是路由标记", () => {
    const error = attachFailureClass(new Error("boom"), { retryable: false, scope: "eval" });
    expect(failureClassOf(error)).toEqual({ retryable: false, scope: "eval" });
    expect(Object.keys(error)).not.toContain("class");
    expect(JSON.stringify({ ...error })).toBe("{}");
  });

  it("抛出点已声明过的分类不被框架覆盖", () => {
    const declared = new ExperimentFatalError("tunnel down");
    attachFailureClass(declared, { retryable: true, reason: "rate_limit" });
    expect(failureClassOf(declared)).toEqual({ retryable: false, scope: "experiment" });
  });

  it("非对象抛出值原样返回,不制造新失败", () => {
    expect(attachFailureClass("string failure", { retryable: false })).toBe("string failure");
  });

  it("冻结的错误对象标记不上也不抛错(分类是旁路)", () => {
    const frozen = Object.freeze(new Error("frozen"));
    expect(() => attachFailureClass(frozen, { retryable: false, scope: "eval" })).not.toThrow();
    expect(failureClassOf(frozen)).toBeUndefined();
  });
});

describe("resolveAttemptFailureClass · 生命周期阶段的三道链", () => {
  const info = (error: unknown): AttemptFailureInfo => attemptFailureInfo("eval.setup", error);

  it("抛出点携带的分类命中即定,不询问实验分类器", () => {
    const classifier = vi.fn(() => ({ retryable: false as const, scope: "attempt" as const }));
    expect(resolveAttemptFailureClass(info(new EvalFatalError("fixture missing")), classifier)).toEqual({
      retryable: false,
      scope: "eval",
    });
    expect(classifier).not.toHaveBeenCalled();
  });

  it("实验分类器认领第三方错误,scope 与自造 reason 原样生效", () => {
    const result = resolveAttemptFailureClass(info(new Error("connect ECONNREFUSED tunnel.example:443")), (failure) =>
      failure.text.includes("tunnel.example")
        ? { retryable: false, scope: "experiment", reason: "tunnel_down" }
        : undefined,
    );
    expect(result).toEqual({ retryable: false, scope: "experiment", reason: "tunnel_down" });
  });

  it("链上不挂兜底正则:限流文案在这些位置也不产时间轴,缺省不可重试", () => {
    // 同一段文本在 turn 链上会被兜底判成 rate_limit 可重试;这里没有重试执行体,
    // 时间轴即使给出也无人消费(见 architecture.md「分类链」)。
    expect(resolveAttemptFailureClass(info(new Error("429 too many requests, please retry later")))).toEqual({
      retryable: false,
    });
  });

  it("实验分类器返回 undefined / 抛错都落缺省,不掩盖原始失败", () => {
    expect(resolveAttemptFailureClass(info(new Error("boom")), () => undefined)).toEqual({ retryable: false });
    expect(
      resolveAttemptFailureClass(info(new Error("boom")), () => {
        throw new Error("classifier bug");
      }),
    ).toEqual({ retryable: false });
  });

  it("分类器读到的 text 与报错文案同源:错误链(含 cause)message 串接", () => {
    const error = new Error("eval setup failed", { cause: new Error("connect ECONNREFUSED tunnel.example:443") });
    const seen: AttemptFailureInfo[] = [];
    resolveAttemptFailureClass(attemptFailureInfo("eval.setup", error), (failure) => {
      seen.push(failure);
      return undefined;
    });
    expect(seen[0].phase).toBe("eval.setup");
    expect(seen[0].text).toBe("eval setup failed · connect ECONNREFUSED tunnel.example:443");
    expect(seen[0].cause).toBe(error);
  });
});
