// cases: docs/engineering/testing/unit/eval.md
import { describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_MAX_RETRIES,
  SEND_MAX_ATTEMPTS,
  createAttemptRetryBudget,
  sendWithTurnRetry,
  type ConcurrencySlot,
  type SendRetryDeps,
  type TurnLens,
} from "./send-retry.ts";
import { failureClassOf, type FailureClass } from "../shared/failure-class.ts";
import type { Turn } from "../types.ts";

// 直调执行体,不用真实 setTimeout 睡眠——sleep 注入即返回(受控时钟),random 注入固定值,
// 让指数退避的计算可断言。lens 恒等:T 就是 Turn 本身(非 otel 路径)。
const identityLens: TurnLens<Turn> = { get: (t) => t, set: (_t, next) => next };

function failedTurn(message: string): Turn {
  return { status: "failed", events: [{ type: "error", message }] };
}

function completedTurn(): Turn {
  return { status: "completed", events: [{ type: "message", role: "assistant", text: "ok" }] };
}

function baseDeps(overrides: Partial<SendRetryDeps> = {}): SendRetryDeps {
  return {
    budget: createAttemptRetryBudget(),
    signal: new AbortController().signal,
    random: () => 0, // 固定抖动:退避延迟恒为下界 0,测试只关心次数与是否释放槽位
    sleep: async () => {},
    ...overrides,
  };
}

function fakeSlot() {
  const calls: string[] = [];
  const slot: ConcurrencySlot = {
    release: async () => {
      calls.push("release");
    },
    reacquire: async () => {
      calls.push("reacquire");
    },
  };
  return { slot, calls };
}

describe("sendWithTurnRetry · 成功路径", () => {
  it("首次成功不重试,callOnce 只调一次", async () => {
    let calls = 0;
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        return completedTurn();
      },
      identityLens,
      baseDeps(),
    );
    expect(calls).toBe(1);
    expect(result.status).toBe("completed");
  });

  it("waiting 状态同样视为非失败,不重试", async () => {
    const waiting: Turn = { status: "waiting", events: [] };
    let calls = 0;
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        return waiting;
      },
      identityLens,
      baseDeps(),
    );
    expect(calls).toBe(1);
    expect(result.status).toBe("waiting");
  });
});

describe("sendWithTurnRetry · 不可重试立即浮出", () => {
  it("turn-failed 且分类不可重试:不重试,原样返回该 Turn,message 无后缀", async () => {
    let calls = 0;
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        return failedTurn("stream reset mid-response after 3 tool calls");
      },
      identityLens,
      baseDeps(),
    );
    expect(calls).toBe(1);
    expect(result.status).toBe("failed");
    expect((result.events[0] as { message: string }).message).toBe("stream reset mid-response after 3 tool calls");
  });

  it("thrown 且分类不可重试:不重试,原样抛出同一个错误对象", async () => {
    const original = new Error("bad request: malformed input");
    await expect(
      sendWithTurnRetry(
        async () => {
          throw original;
        },
        identityLens,
        baseDeps(),
      ),
    ).rejects.toBe(original);
  });
});

describe("sendWithTurnRetry · 可重试:重发直到成功", () => {
  it("第一次撞限流、第二次成功:callOnce 调用两次,退避期间释放并收回槽位", async () => {
    let calls = 0;
    const { slot, calls: slotCalls } = fakeSlot();
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        if (calls === 1) return failedTurn("too many requests, retry later");
        return completedTurn();
      },
      identityLens,
      baseDeps({ slot }),
    );
    expect(calls).toBe(2);
    expect(result.status).toBe("completed");
    expect(slotCalls).toEqual(["release", "reacquire"]);
  });

  it("重试期间的进度行:reason 原样出现在 activity 消息里", async () => {
    let calls = 0;
    const messages: string[] = [];
    await sendWithTurnRetry(
      async () => {
        calls++;
        if (calls === 1) return failedTurn("concurrency limit exceeded, please retry later");
        return completedTurn();
      },
      identityLens,
      baseDeps({ reportRetry: (m) => messages.push(m) }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("rate_limit");
  });

  it("被吸收的失败尝试不外泄:只有最终返回的 Turn 是完整的,失败尝试的 Turn 从不返回给调用方", async () => {
    let calls = 0;
    const seen: Turn[] = [];
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        const turn = calls === 1 ? failedTurn("rate limit hit") : completedTurn();
        seen.push(turn);
        return turn;
      },
      identityLens,
      baseDeps(),
    );
    // 执行体只把第二次(成功)的 Turn 交回;第一次失败的 Turn 只存在于 seen(测试自己的记录),
    // 从未经由 sendWithTurnRetry 的返回值泄漏出去。
    expect(result).toBe(seen[1]);
  });
});

describe("sendWithTurnRetry · send 级预算(封顶 4 次尝试)", () => {
  it("连续 4 次都撞限流:耗尽在 send 级,message 追加 send 级摘要,budget 消耗 3 次重试", async () => {
    let calls = 0;
    const budget = createAttemptRetryBudget();
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        return failedTurn("rate limited, please retry later");
      },
      identityLens,
      baseDeps({ budget }),
    );
    expect(calls).toBe(SEND_MAX_ATTEMPTS);
    expect(result.status).toBe("failed");
    const message = (result.events[0] as { message: string }).message;
    expect(message).toContain("rate_limit");
    expect(message).toMatch(/retries exhausted|重试已耗尽/);
    expect(message).toContain(String(SEND_MAX_ATTEMPTS));
    expect(budget.remaining).toBe(ATTEMPT_MAX_RETRIES - (SEND_MAX_ATTEMPTS - 1));
  });

  it("thrown 形态耗尽追加摘要但不变异 adapter 原始 Error", async () => {
    const budget = createAttemptRetryBudget();
    const original = new Error("429 too many requests");
    await expect(
      sendWithTurnRetry(
        async () => {
          throw original;
        },
        identityLens,
        baseDeps({ budget }),
      ),
    ).rejects.toThrow(/429 too many requests.*(retries exhausted|重试已耗尽)/s);
    expect(original.message).toBe("429 too many requests");
  });
});

describe("sendWithTurnRetry · attempt 级预算(跨多轮 send 持续扣减,不随单次 send 重置)", () => {
  it("send 级预算在每次新 send 调用时重置,但 attempt 级预算持续扣减", async () => {
    const budget = createAttemptRetryBudget();
    // 第一次 send:重试 2 次后成功(用掉 2 点 attempt 级预算),不触发任何一层耗尽。
    let firstCalls = 0;
    const first = await sendWithTurnRetry(
      async () => {
        firstCalls++;
        return firstCalls <= 2 ? failedTurn("rate limit hit") : completedTurn();
      },
      identityLens,
      baseDeps({ budget }),
    );
    expect(first.status).toBe("completed");
    expect(budget.remaining).toBe(ATTEMPT_MAX_RETRIES - 2);

    // 第二次 send:如果 send 级预算真的重置了,这里应该又能重试到 SEND_MAX_ATTEMPTS 次
    // (而不是被第一次 send 的历史提前拦下)。
    let secondCalls = 0;
    const second = await sendWithTurnRetry(
      async () => {
        secondCalls++;
        return failedTurn("rate limit hit");
      },
      identityLens,
      baseDeps({ budget }),
    );
    expect(secondCalls).toBe(SEND_MAX_ATTEMPTS); // send 级预算独立重置,不受上一次 send 影响
    expect(second.status).toBe("failed");
  });

  it("attempt 级预算耗尽后,新 send 的第一次可重试失败直接浮出(不重试),摘要注明 attempt 级耗尽", async () => {
    const budget = createAttemptRetryBudget();
    budget.remaining = 0; // 模拟前面几轮 send 已经把预算耗光
    let calls = 0;
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        return failedTurn("rate limited, please retry later");
      },
      identityLens,
      baseDeps({ budget }),
    );
    expect(calls).toBe(1); // 没有发生任何重试
    const message = (result.events[0] as { message: string }).message;
    expect(message).toMatch(/attempt retry budget exhausted|attempt 重试预算已耗尽/);
    expect(message).toContain(String(ATTEMPT_MAX_RETRIES));
  });
});

describe("sendWithTurnRetry · adapter 分类器接入", () => {
  it("adapter 分类器的自定义 reason 原样出现在耗尽摘要里", async () => {
    const budget = createAttemptRetryBudget();
    let calls = 0;
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        return failedTurn("ACME_QUEUE_FULL");
      },
      identityLens,
      baseDeps({ budget, classifier: () => ({ retryable: true, reason: "acme_queue_full" }) }),
    );
    expect(calls).toBe(SEND_MAX_ATTEMPTS);
    const message = (result.events[0] as { message: string }).message;
    expect(message).toContain("acme_queue_full");
  });
});

describe("sendWithTurnRetry · 终局失败携带分类浮出(止损闸的进料)", () => {
  const tunnelDown = { retryable: false, scope: "experiment", reason: "tunnel_down" } as const;

  it("thrown 形态:终局失败的分类标在浮出的错误上,经 failureClassOf 读得到", async () => {
    const original = new Error("connect ECONNREFUSED tunnel.example:443");
    const promise = sendWithTurnRetry(
      async () => {
        throw original;
      },
      identityLens,
      baseDeps({ experimentClassifier: () => tunnelDown }),
    );
    await expect(promise).rejects.toBe(original); // 浮出的仍是原始错误对象,不被包装替换
    expect(failureClassOf(original)).toEqual(tunnelDown);
  });

  it("turn-failed 形态:分类经 onFinalFailure 回执转交调用方(Turn 上不留字段)", async () => {
    const seen: { cls: FailureClass; turn?: Turn }[] = [];
    const result = await sendWithTurnRetry(
      async () => failedTurn("connect ECONNREFUSED tunnel.example:443"),
      identityLens,
      baseDeps({
        experimentClassifier: () => tunnelDown,
        onFinalFailure: (cls, failure) => {
          seen.push({ cls, turn: failure.type === "turn-failed" ? failure.turn : undefined });
        },
      }),
    );
    expect(seen).toEqual([{ cls: tunnelDown, turn: result }]);
    expect(failureClassOf(result)).toBeUndefined();
  });

  it("被重试吸收的失败不外泄:重试后成功时没有任何终局分类回执", async () => {
    const seen: FailureClass[] = [];
    let calls = 0;
    const result = await sendWithTurnRetry(
      async () => {
        calls++;
        return calls === 1 ? failedTurn("too many requests, retry later") : completedTurn();
      },
      identityLens,
      baseDeps({
        experimentClassifier: () => ({ retryable: true, reason: "tunnel_flaky", scope: "experiment" }),
        onFinalFailure: (cls) => seen.push(cls),
      }),
    );
    expect(result.status).toBe("completed");
    expect(seen).toEqual([]);
  });

  it("重试耗尽时 scope 随失败携带浮出,回执报的是带耗尽摘要的那个 Turn", async () => {
    const seen: { cls: FailureClass; turn?: Turn }[] = [];
    const result = await sendWithTurnRetry(
      async () => failedTurn("too many requests, retry later"),
      identityLens,
      baseDeps({
        experimentClassifier: () => ({ retryable: true, reason: "tunnel_flaky", scope: "experiment" }),
        onFinalFailure: (cls, failure) => {
          seen.push({ cls, turn: failure.type === "turn-failed" ? failure.turn : undefined });
        },
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].cls).toEqual({ retryable: true, reason: "tunnel_flaky", scope: "experiment" });
    expect(seen[0].turn).toBe(result);
    expect((result.events[0] as { message: string }).message).toContain("tunnel_flaky");
  });

  it("实验分类器排在 adapter 之前:两者同时认领时携带的是实验的 scope", async () => {
    const original = new Error("connect ECONNREFUSED tunnel.example:443");
    const promise = sendWithTurnRetry(
      async () => {
        throw original;
      },
      identityLens,
      baseDeps({
        experimentClassifier: () => tunnelDown,
        classifier: () => ({ retryable: true, reason: "network" }),
      }),
    );
    await expect(promise).rejects.toBe(original);
    expect(failureClassOf(original)).toEqual(tunnelDown);
  });
});

describe("sendWithTurnRetry · 中断", () => {
  it("退避睡眠期间 signal abort:干净打断,不等满整段延迟,槽位仍被收回", async () => {
    const ac = new AbortController();
    const { slot, calls: slotCalls } = fakeSlot();
    let sleepStarted = false;
    // 睡眠 promise 只在 signal abort 时落定(从不自己超时/resolve)——真实实现的等价物,
    // 用来证明「打断」不是靠等满 delayMs,而是靠 signal 提前让 sleep 落定。
    const realSleep = (_ms: number, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        sleepStarted = true;
        signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
      });

    const promise = sendWithTurnRetry(
      async () => failedTurn("rate limited, please retry later"),
      identityLens,
      baseDeps({ slot, sleep: realSleep, signal: ac.signal }),
    );
    // 等到退避睡眠真正开始(release 已发生、sleep 已调用并注册好 abort 监听)再中断,
    // 不用固定 tick 数猜时序(vi.waitFor 轮询,与 sandbox/retry.test.ts 同一手法)。
    await vi.waitFor(() => expect(sleepStarted).toBe(true));
    ac.abort(new Error("attempt interrupted"));

    await expect(promise).rejects.toThrow("attempt interrupted");
    expect(slotCalls).toEqual(["release", "reacquire"]); // 中断也要收回槽位,不遗留 permit 泄漏
  });
});
