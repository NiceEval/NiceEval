import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectDetached } from "../../../../../src/sandbox/keep.ts";

// bug: memory/e2b-list-returns-paginator-not-array.md
// e2b 的 Sandbox.list() 是**同步**方法，返回 SandboxPaginator（hasNext + nextItems()），
// 不是 Promise<数组>；曾经手写 `as unknown as` 猜成数组签名，对账静默失败。
// 这里用与 e2b 包 .d.ts 同形状的分页器驱动真实消费方，不造 HTTP cursor 伪 E2E。

const e2bListMock = vi.fn();

vi.mock("e2b", () => ({
  Sandbox: {
    list: (...args: unknown[]) => e2bListMock(...args),
  },
}));

/** 与 e2b 包 SandboxPaginator 同形状：hasNext getter + 异步 nextItems()，逐页吐出。 */
function fakePaginator(
  pages: Array<Array<{ sandboxId: string; state?: string }>>,
): { hasNext: boolean; nextItems(): Promise<Array<{ sandboxId: string; state?: string }>> } {
  let cursor = 0;
  return {
    get hasNext() {
      return cursor < pages.length;
    },
    nextItems: async () => {
      const page = pages[cursor] ?? [];
      cursor += 1;
      return page;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.E2B_API_KEY;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("e2b Sandbox.list() 分页器形状（hasNext + nextItems）", () => {
  it("list() 同步返回分页器而不是 Promise<数组>：消费者按 hasNext/nextItems 翻页", async () => {
    e2bListMock.mockReturnValue(fakePaginator([[{ sandboxId: "sbx-1", state: "running" }]]));
    await expect(inspectDetached("e2b", "sbx-1")).resolves.toBe("alive");
    const returned = e2bListMock.mock.results[0]?.value;
    expect(returned).not.toBeInstanceOf(Promise);
    expect(Array.isArray(returned)).toBe(false);
    expect(typeof returned.hasNext).toBe("boolean");
    expect(typeof returned.nextItems).toBe("function");
  });

  it("目标只在第二页时完整翻页找到，不因第一页没命中就判 expired", async () => {
    e2bListMock.mockReturnValue(
      fakePaginator([
        [{ sandboxId: "sbx-other-1", state: "running" }],
        [{ sandboxId: "sbx-1", state: "paused" }],
      ]),
    );
    await expect(inspectDetached("e2b", "sbx-1")).resolves.toBe("dormant");
  });

  it("列表没有目标 -> expired", async () => {
    e2bListMock.mockReturnValue(fakePaginator([[{ sandboxId: "sbx-other-1", state: "running" }]]));
    await expect(inspectDetached("e2b", "sbx-gone")).resolves.toBe("expired");
  });

  it("list 抛错 -> unknown（不把 SDK/网络故障伪装成已删除）", async () => {
    e2bListMock.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(inspectDetached("e2b", "sbx-1")).resolves.toBe("unknown");
  });
});
