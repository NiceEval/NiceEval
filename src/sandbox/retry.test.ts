import { describe, expect, it, vi } from "vitest";
import { withProvisionRetry, type ProvisionSlot } from "./retry.ts";

function fakeSlot() {
  const calls: string[] = [];
  const slot: ProvisionSlot = {
    release: async () => {
      calls.push("release");
    },
    reacquire: async () => {
      calls.push("reacquire");
    },
  };
  return { slot, calls };
}

describe("withProvisionRetry", () => {
  it("succeeds without touching the slot when create() succeeds first try", async () => {
    const { slot, calls } = fakeSlot();
    const result = await withProvisionRetry(
      async () => "sandbox",
      () => "unknown",
      slot,
    );
    expect(result).toBe("sandbox");
    expect(calls).toEqual([]);
  });

  it("throws immediately on a non-retryable error without touching the slot", async () => {
    const { slot, calls } = fakeSlot();
    const err = new Error("bad template");
    await expect(
      withProvisionRetry(
        async () => {
          throw err;
        },
        () => "unknown",
        slot,
      ),
    ).rejects.toBe(err);
    expect(calls).toEqual([]);
  });

  it("throws an ambiguous error on the first attempt when no reconcile channel exists", async () => {
    const err = new Error("fetch failed");
    let attempts = 0;
    await expect(
      withProvisionRetry(
        async () => {
          attempts += 1;
          throw err;
        },
        () => "ambiguous",
      ),
    ).rejects.toBe(err);
    expect(attempts).toBe(1);
  });

  it("reconciles before every retry, including rejected-class errors like rate_limit", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      let attempts = 0;
      const promise = withProvisionRetry(
        async () => {
          attempts += 1;
          order.push(`create#${attempts}`);
          if (attempts === 1) throw new Error("rate limited");
          return "sandbox";
        },
        () => "rate_limit",
        undefined,
        undefined,
        async () => {
          order.push("reconcile");
        },
      );
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe("sandbox");
      // create() 闭包跨多个请求,429 可能来自实例已创建之后的初始化请求——拒绝类也必须先对账。
      expect(order).toEqual(["create#1", "reconcile", "create#2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the retry and rethrows the original error when reconcile fails", async () => {
    vi.useFakeTimers();
    try {
      const createErr = new Error("rate limited");
      let attempts = 0;
      const promise = withProvisionRetry(
        async () => {
          attempts += 1;
          throw createErr;
        },
        () => "rate_limit",
        undefined,
        undefined,
        async () => {
          throw new Error("list also rate limited");
        },
      );
      const assertion = expect(promise).rejects.toBe(createErr);
      await vi.runAllTimersAsync();
      await assertion;
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the slot before backing off and reacquires it before retrying", async () => {
    vi.useFakeTimers();
    try {
      const { slot, calls } = fakeSlot();
      let attempts = 0;
      const promise = withProvisionRetry(
        async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("rate limited");
          return "sandbox";
        },
        () => "rate_limit",
        slot,
      );
      // 第一次失败后应该先 release,再进入退避睡眠 —— 此时还没到 reacquire。
      await vi.waitFor(() => expect(calls).toEqual(["release"]));
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe("sandbox");
      expect(calls).toEqual(["release", "reacquire"]);
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
