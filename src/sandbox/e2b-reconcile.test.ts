// 覆盖 reconcileProvision 对账逻辑,不打真实 e2b API——mock "e2b" 整个模块。
// 背景:线上跑分撞见过 nextItems() 之后 `for...of` 抛 "X is not iterable" 的一次,
// 没能稳定复现出确切成因;这里补的是"对账这条路径本身撞上瞬时错误该怎么办"这层契约,
// 不是去复现那次具体的 SDK 行为。
import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeNotFoundError extends Error {}
class FakeRateLimitError extends Error {}
class FakeCommandExitError extends Error {}

const listMock = vi.fn();
const killMock = vi.fn();

vi.mock("e2b", () => ({
  Sandbox: { list: (...args: unknown[]) => listMock(...args), kill: (...args: unknown[]) => killMock(...args) },
  NotFoundError: FakeNotFoundError,
  RateLimitError: FakeRateLimitError,
  CommandExitError: FakeCommandExitError,
}));

function fakePaginator(pages: Array<() => Promise<unknown[]>>) {
  let i = 0;
  return {
    get hasNext() {
      return i < pages.length;
    },
    nextItems: async () => {
      const page = pages[i];
      i += 1;
      return page();
    },
  };
}

describe("reconcileProvision", () => {
  beforeEach(() => {
    listMock.mockReset();
    killMock.mockReset();
  });

  it("kills every sandbox found under the provision token, across pages", async () => {
    const { reconcileProvision } = await import("./e2b.ts");
    listMock.mockReturnValue(
      fakePaginator([
        async () => [{ sandboxId: "a" }],
        async () => [{ sandboxId: "b" }],
      ]),
    );
    killMock.mockResolvedValue(undefined);

    await reconcileProvision("tok");

    expect(killMock).toHaveBeenCalledTimes(2);
    expect(killMock.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("treats a NotFound on kill as already-reconciled, not an error", async () => {
    const { reconcileProvision } = await import("./e2b.ts");
    listMock.mockReturnValue(fakePaginator([async () => [{ sandboxId: "gone" }]]));
    killMock.mockRejectedValue(new FakeNotFoundError("gone"));

    await expect(reconcileProvision("tok")).resolves.toBeUndefined();
  });

  it("retries nextItems() on a transient (ambiguous) error and still succeeds", async () => {
    vi.useFakeTimers();
    try {
      const { reconcileProvision } = await import("./e2b.ts");
      let calls = 0;
      let done = false;
      listMock.mockReturnValue({
        get hasNext() {
          return !done;
        },
        nextItems: vi.fn(async () => {
          calls += 1;
          if (calls === 1) throw new Error("fetch failed");
          done = true;
          return [];
        }),
      });

      const promise = reconcileProvision("tok");
      await vi.runAllTimersAsync();
      await promise;
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not swallow a nextItems() result that isn't an array", async () => {
    const { reconcileProvision } = await import("./e2b.ts");
    listMock.mockReturnValue({ hasNext: true, nextItems: vi.fn().mockResolvedValue(undefined) });

    await expect(reconcileProvision("tok")).rejects.toThrow(/not an array|SandboxInfo/);
  });

  it("gives up after repeated transient nextItems() failures instead of retrying forever", async () => {
    vi.useFakeTimers();
    try {
      const { reconcileProvision } = await import("./e2b.ts");
      const err = new Error("fetch failed");
      listMock.mockReturnValue({
        hasNext: true,
        nextItems: vi.fn().mockRejectedValue(err),
      });

      const assertion = expect(reconcileProvision("tok")).rejects.toBe(err);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates a non-retryable kill error immediately", async () => {
    const { reconcileProvision } = await import("./e2b.ts");
    listMock.mockReturnValue(fakePaginator([async () => [{ sandboxId: "a" }]]));
    const err = new Error("permission denied");
    killMock.mockRejectedValue(err);

    await expect(reconcileProvision("tok")).rejects.toBe(err);
  });
});
