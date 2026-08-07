// cases: docs/engineering/testing/unit/sandbox.md
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sandbox, SandboxInfo, SandboxPaginator } from "e2b";
import { inspectDetached } from "../../../../../../src/sandbox/keep.ts";

type E2bListPaginator = Pick<SandboxPaginator, "hasNext" | "nextItems">;
type E2bListMock = (...args: Parameters<typeof Sandbox.list>) => E2bListPaginator;

const e2bListMock = vi.fn<E2bListMock>();

vi.mock("e2b", () => ({
  Sandbox: {
    list: e2bListMock,
  },
}));

// 单元层只驱动 inspectDetached 的领域状态分类；live SDK 可用性由真实 E2B E2E 拥有。
const sandboxInfoDefaults = {
  templateId: "niceeval-test-template",
  metadata: {},
  startedAt: new Date("2026-08-01T00:00:00.000Z"),
  endAt: new Date("2026-08-01T01:00:00.000Z"),
  cpuCount: 2,
  memoryMB: 512,
  envdVersion: "test",
} satisfies Omit<SandboxInfo, "sandboxId" | "state">;

const runningSandbox = {
  ...sandboxInfoDefaults,
  sandboxId: "sbx-1",
  state: "running",
} satisfies SandboxInfo;

const pausedSandbox = {
  ...sandboxInfoDefaults,
  sandboxId: "sbx-1",
  state: "paused",
} satisfies SandboxInfo;

const otherSandbox = {
  ...sandboxInfoDefaults,
  sandboxId: "sbx-other-1",
  state: "running",
} satisfies SandboxInfo;

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.E2B_API_KEY;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("inspectDetached 的 E2B detached 状态", () => {
  it("找到运行中的目标沙箱时返回 alive", async () => {
    const pages = [[runningSandbox]] satisfies SandboxInfo[][];
    let page = 0;
    const paginator = {
      get hasNext() {
        return page < pages.length;
      },
      nextItems: async () => pages[page++] ?? [],
    } satisfies E2bListPaginator;
    e2bListMock.mockReturnValue(paginator);

    await expect(inspectDetached("e2b", "sbx-1")).resolves.toBe("alive");
  });

  // bug: memory/e2b-list-returns-paginator-not-array.md
  it("跨过第一页在第二页找到暂停的目标沙箱时返回 dormant", async () => {
    const pages = [[otherSandbox], [pausedSandbox]] satisfies SandboxInfo[][];
    let page = 0;
    const paginator = {
      get hasNext() {
        return page < pages.length;
      },
      nextItems: async () => pages[page++] ?? [],
    } satisfies E2bListPaginator;
    e2bListMock.mockReturnValue(paginator);

    await expect(inspectDetached("e2b", "sbx-1")).resolves.toBe("dormant");
  });

  it("列表确认没有目标沙箱时返回 expired", async () => {
    const pages = [[otherSandbox]] satisfies SandboxInfo[][];
    let page = 0;
    const paginator = {
      get hasNext() {
        return page < pages.length;
      },
      nextItems: async () => pages[page++] ?? [],
    } satisfies E2bListPaginator;
    e2bListMock.mockReturnValue(paginator);

    await expect(inspectDetached("e2b", "sbx-gone")).resolves.toBe("expired");
  });

  it("E2B 列表查询失败时返回 unknown，而不是把 SDK 故障当成 expired", async () => {
    e2bListMock.mockImplementation(() => {
      throw new Error("E2B unavailable");
    });

    await expect(inspectDetached("e2b", "sbx-1")).resolves.toBe("unknown");
  });
});
