// cases: docs/engineering/testing/unit/eval.md
import { describe, expect, it, vi } from "vitest";
import {
  classifyTurnError,
  hasAgentEvidence,
  resolveTurnFailureClass,
  turnErrorText,
  type TurnFailure,
} from "./turn-errors.ts";
import {
  EvalFatalError,
  ExperimentFatalError,
  type AttemptFailureInfo,
  type FailureClass,
} from "../shared/failure-class.ts";
import type { StreamEvent, Turn } from "../types.ts";

function turnFailed(events: StreamEvent[]): TurnFailure {
  return { type: "turn-failed", turn: { status: "failed", events } };
}

function errorEvent(message: string): StreamEvent {
  return { type: "error", message };
}

describe("turnErrorText", () => {
  it("取 events 里最后一条 error 事件的 message", () => {
    const turn: Turn = { status: "failed", events: [errorEvent("first"), errorEvent("second")] };
    expect(turnErrorText(turn)).toBe("second");
  });

  it("没有 error 事件时返回 undefined", () => {
    const turn: Turn = { status: "failed", events: [{ type: "message", role: "assistant", text: "hi" }] };
    expect(turnErrorText(turn)).toBeUndefined();
  });
});

describe("classifyTurnError(保守兜底) · turn-failed 形态", () => {
  it("真实样本「Concurrency limit exceeded for user, please retry later」归 rate_limit", () => {
    const failure = turnFailed([
      errorEvent(
        "agent run exited with code 1 · last error: stream disconnected before completion: Concurrency limit exceeded for user, please retry later",
      ),
    ]);
    expect(classifyTurnError(failure)).toEqual({ retryable: true, reason: "rate_limit" });
  });

  it("DNS 解析失败(连接建立层)归 network", () => {
    const failure = turnFailed([errorEvent("request failed: getaddrinfo ENOTFOUND api.example.com")]);
    expect(classifyTurnError(failure)).toEqual({ retryable: true, reason: "network" });
  });

  it("文档用例的诚实 errored 原文「stream reset mid-response after 3 tool calls」不可重试", () => {
    const failure = turnFailed([errorEvent("stream reset mid-response after 3 tool calls")]);
    expect(classifyTurnError(failure)).toEqual({ retryable: false });
  });

  it("没有 error 事件的 failed Turn(turnErrorText 为 undefined)不可重试,不因空文本误判", () => {
    const failure = turnFailed([{ type: "message", role: "assistant", text: "" }]);
    expect(classifyTurnError(failure)).toEqual({ retryable: false });
  });
});

describe("classifyTurnError(保守兜底) · thrown 形态", () => {
  it("错误链顶层 message 命中限流关键字归 rate_limit", () => {
    const failure: TurnFailure = { type: "thrown", error: new Error("429 too many requests") };
    expect(classifyTurnError(failure)).toEqual({ retryable: true, reason: "rate_limit" });
  });

  it("限流关键字只出现在 cause 链深处也能命中(串接错误链,不止看顶层 message)", () => {
    const inner = new Error("please retry later");
    const outer = new Error("send failed", { cause: inner });
    const failure: TurnFailure = { type: "thrown", error: outer };
    expect(classifyTurnError(failure)).toEqual({ retryable: true, reason: "rate_limit" });
  });

  it("ECONNREFUSED 错误码(连接建立层)归 network", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4000"), { code: "ECONNREFUSED" });
    const failure: TurnFailure = { type: "thrown", error };
    expect(classifyTurnError(failure)).toEqual({ retryable: true, reason: "network" });
  });

  it("响应中途连接重置(ECONNRESET)不属于连接建立层,不可重试", () => {
    const error = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const failure: TurnFailure = { type: "thrown", error };
    expect(classifyTurnError(failure)).toEqual({ retryable: false });
  });

  it("非 Error 抛出值(字符串)按 String() 兜底,不崩溃", () => {
    const failure: TurnFailure = { type: "thrown", error: "rate limit exceeded" };
    expect(classifyTurnError(failure)).toEqual({ retryable: true, reason: "rate_limit" });
  });
});

describe("resolveTurnFailureClass · 五道分类链", () => {
  it("adapter 分类器返回结果时优先生效,自定义 reason 原样透出(不被塞进内建词表)", () => {
    const failure = turnFailed([errorEvent("ACME_QUEUE_FULL: too many concurrent runs")]);
    const result = resolveTurnFailureClass(failure, { adapter: () => ({ retryable: true, reason: "acme_queue_full" }) });
    expect(result).toEqual({ retryable: true, reason: "acme_queue_full" });
  });

  it("adapter 分类器返回 undefined 时回落保守兜底", () => {
    const failure = turnFailed([errorEvent("too many requests, back off")]);
    const result = resolveTurnFailureClass(failure, { adapter: () => undefined });
    expect(result).toEqual({ retryable: true, reason: "rate_limit" });
  });

  it("adapter 分类器抛错按 undefined 回落:错误被吞掉,链继续走到兜底", () => {
    const failure = turnFailed([errorEvent("too many requests, back off")]);
    const result = resolveTurnFailureClass(failure, {
      adapter: () => {
        throw new Error("classifier bug");
      },
    });
    expect(result).toEqual({ retryable: true, reason: "rate_limit" });
  });

  it("实验分类器抛错同样按 undefined 回落,后续通道照常认领(不掩盖原始失败)", () => {
    const failure = turnFailed([errorEvent("ACME_QUEUE_FULL")]);
    const result = resolveTurnFailureClass(failure, {
      experiment: () => {
        throw new Error("classifier bug");
      },
      adapter: () => ({ retryable: true, reason: "acme_queue_full" }),
    });
    expect(result).toEqual({ retryable: true, reason: "acme_queue_full" });
  });

  it("没有 adapter 分类器时直接走保守兜底", () => {
    const failure = turnFailed([errorEvent("too many requests, back off")]);
    expect(resolveTurnFailureClass(failure)).toEqual({ retryable: true, reason: "rate_limit" });
  });

  describe("受理证据门:失败 Turn 带 agent 产出事件时强制降级为不可重试", () => {
    it.each([
      ["message", { type: "message", role: "assistant", text: "working on it" } satisfies StreamEvent],
      ["thinking", { type: "thinking", text: "let me think" } satisfies StreamEvent],
      ["action.called", { type: "action.called", name: "bash", callId: "c1", input: {} } satisfies StreamEvent],
      ["action.result", { type: "action.result", callId: "c1", output: "", status: "completed" } satisfies StreamEvent],
    ])("%s 事件出现时,文本再像限流也不重试(reason 原样留着给人读)", (_label, evidenceEvent) => {
      const failure = turnFailed([evidenceEvent, errorEvent("Concurrency limit exceeded, please retry later")]);
      expect(resolveTurnFailureClass(failure)).toEqual({ retryable: false, reason: "rate_limit" });
    });

    it("adapter 分类器判可重试同样被否决(执行体的否决权压过分类器)", () => {
      const failure = turnFailed([
        { type: "action.called", name: "bash", callId: "c1", input: {} },
        errorEvent("ACME_QUEUE_FULL"),
      ]);
      const result = resolveTurnFailureClass(failure, { adapter: () => ({ retryable: true, reason: "acme_queue_full" }) });
      expect(result).toEqual({ retryable: false, reason: "acme_queue_full" });
    });

    it("只裁时间轴:分类器给的 scope 原样保留,证据门不触碰空间轴", () => {
      const failure = turnFailed([
        { type: "action.called", name: "bash", callId: "c1", input: {} },
        errorEvent("tunnel flaky, retry later"),
      ]);
      const result = resolveTurnFailureClass(failure, {
        experiment: () => ({ retryable: true, reason: "tunnel_flaky", scope: "experiment" }),
      });
      expect(result).toEqual({ retryable: false, reason: "tunnel_flaky", scope: "experiment" });
    });

    it("thrown 形态没有 Turn 可查,不受证据门影响", () => {
      const failure: TurnFailure = { type: "thrown", error: new Error("too many requests") };
      expect(resolveTurnFailureClass(failure)).toEqual({ retryable: true, reason: "rate_limit" });
    });

    it("不可重试分类结果不受证据门触碰(门只降级可重试的判断)", () => {
      const failure = turnFailed([
        { type: "action.called", name: "bash", callId: "c1", input: {} },
        errorEvent("stream reset mid-response"),
      ]);
      const result: FailureClass = resolveTurnFailureClass(failure);
      expect(result).toEqual({ retryable: false });
    });
  });
});

describe("resolveTurnFailureClass · 决议序(先非 undefined 定案)", () => {
  // 区分力场景:同一条失败两个通道都认领——adapter 只能给时间轴(连接错误的通用形状),
  // 只有实验作者认得这个 host 是全实验共享的隧道。实验分类器排在 adapter 之前,
  // scope 才赢得下来(裁决见 memory/failure-chain-experiment-before-adapter.md)。
  const tunnelFailure = turnFailed([errorEvent("connect ECONNREFUSED nowledge.trycloudflare.com:443")]);
  const experimentClassifier = () => ({ retryable: false, scope: "experiment", reason: "tunnel_down" }) as const;
  const adapterClassifier = () => ({ retryable: true, reason: "network" }) as const;

  it("实验分类器与 adapter 同时认领时,实验的 scope 声明胜出", () => {
    const result = resolveTurnFailureClass(tunnelFailure, {
      experiment: experimentClassifier,
      adapter: adapterClassifier,
    });
    expect(result).toEqual({ retryable: false, scope: "experiment", reason: "tunnel_down" });
  });

  it("实验分类器认领后不再询问 adapter", () => {
    const adapter = vi.fn(adapterClassifier);
    resolveTurnFailureClass(tunnelFailure, { experiment: experimentClassifier, adapter });
    expect(adapter).not.toHaveBeenCalled();
  });

  it("实验分类器不认(返回 undefined)时才轮到 adapter,adapter 的时间轴答案生效", () => {
    const result = resolveTurnFailureClass(tunnelFailure, {
      experiment: () => undefined,
      adapter: adapterClassifier,
    });
    expect(result).toEqual({ retryable: true, reason: "network" });
  });

  it("实验分类器读到的 text 与报错文案同源,phase 是 agent.run,cause 是那个失败 Turn", () => {
    const turn: Turn = { status: "failed", events: [errorEvent("connect ECONNREFUSED nowledge.trycloudflare.com:443")] };
    const seen: AttemptFailureInfo[] = [];
    resolveTurnFailureClass(
      { type: "turn-failed", turn },
      {
        experiment: (failure) => {
          seen.push(failure);
          return undefined;
        },
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].phase).toBe("agent.run");
    expect(seen[0].text).toBe(turnErrorText(turn));
    expect(seen[0].cause).toBe(turn);
  });

  it("thrown 形态下实验分类器读到抛出的错误本身,text 是错误链串接", () => {
    const error = new Error("send failed", { cause: new Error("connect ECONNREFUSED tunnel.example:443") });
    const seen: { text: string; cause: unknown }[] = [];
    resolveTurnFailureClass({ type: "thrown", error }, {
      experiment: (failure) => {
        seen.push(failure);
        return undefined;
      },
    });
    expect(seen[0].cause).toBe(error);
    expect(seen[0].text).toBe("send failed · connect ECONNREFUSED tunnel.example:443");
  });

  it("抛出点携带的分类优先级最高:糖衣类命中即定,任何分类器都不被询问", () => {
    const experiment = vi.fn(experimentClassifier);
    const adapter = vi.fn(adapterClassifier);
    const failure: TurnFailure = { type: "thrown", error: new ExperimentFatalError("tunnel probe failed") };
    const result = resolveTurnFailureClass(failure, { experiment, adapter });
    expect(result).toEqual({ retryable: false, scope: "experiment" });
    expect(experiment).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
  });

  it("糖衣类被上层包装再抛(cause 链)也照样命中,声明不丢失", () => {
    const wrapped = new Error("adapter wrapped", { cause: new EvalFatalError("fixture missing") });
    const result = resolveTurnFailureClass({ type: "thrown", error: wrapped });
    expect(result).toEqual({ retryable: false, scope: "eval" });
  });
});

describe("hasAgentEvidence", () => {
  it("空事件流(无 error 事件也无产出事件)判 false", () => {
    expect(hasAgentEvidence({ status: "failed", events: [] })).toBe(false);
  });

  it("只有 error 事件、没有 agent 产出事件时判 false", () => {
    expect(hasAgentEvidence({ status: "failed", events: [errorEvent("boom")] })).toBe(false);
  });
});
