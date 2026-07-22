// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖「孤儿核对与 prune」声明的三行:创建期运行标识元数据的写入边界(run-identity.ts 的
// label/metadata 往返与缺字段降级);孤儿三条件与 unverified 的保守判定(同宿主存活排除、
// 同宿主死亡→orphan、异宿主→unverified、留存注册表条目排除);prune 的幂等、--force 语义与
// 失败退出码(单台失败列出继续处理其余,不因一台失败中止整批)。mock dockerode / e2b,不发
// 真实请求——真实 provider 行为归 E2E(../../docs/engineering/testing/e2e/README.md)。

import { afterEach, describe, expect, it, vi } from "vitest";
import { hostname } from "node:os";

const dockerListContainersMock = vi.fn();
class FakeDocker {
  listContainers(...args: unknown[]) {
    return dockerListContainersMock(...args);
  }
}
vi.mock("dockerode", () => ({ default: FakeDocker }));

const e2bListMock = vi.fn();
vi.mock("e2b", () => ({ Sandbox: { list: (...a: unknown[]) => e2bListMock(...a) } }));

const destroyDetachedMock = vi.fn();
vi.mock("./keep.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./keep.ts")>();
  return { ...actual, destroyDetached: destroyDetachedMock };
});

function fakePaginator(items: unknown[]) {
  let done = false;
  return {
    get hasNext() {
      return !done;
    },
    nextItems: async () => {
      done = true;
      return items;
    },
  };
}

afterEach(() => {
  dockerListContainersMock.mockReset();
  e2bListMock.mockReset();
  destroyDetachedMock.mockReset();
});

describe("run-identity: 创建期运行标识元数据的写入边界", () => {
  it("dockerRunIdentityLabels 与 parseDockerRunIdentity 往返还原同一份标识", async () => {
    const { currentRunIdentity, dockerRunIdentityLabels, parseDockerRunIdentity } = await import("./run-identity.ts");
    const identity = currentRunIdentity();
    const labels = dockerRunIdentityLabels(identity);
    expect(parseDockerRunIdentity(labels)).toEqual(identity);
  });

  it("e2bRunIdentityMetadata 与 parseE2BRunIdentity 往返还原同一份标识", async () => {
    const { currentRunIdentity, e2bRunIdentityMetadata, parseE2BRunIdentity } = await import("./run-identity.ts");
    const identity = currentRunIdentity();
    const metadata = e2bRunIdentityMetadata(identity);
    expect(parseE2BRunIdentity(metadata)).toEqual(identity);
  });

  it.each(["niceeval.host", "niceeval.pid", "niceeval.started-at"] as const)(
    "缺 %s 时 parseDockerRunIdentity 判定没有运行标识(非 niceeval 容器)",
    async (missingKey) => {
      const { currentRunIdentity, dockerRunIdentityLabels, parseDockerRunIdentity } = await import("./run-identity.ts");
      const labels = dockerRunIdentityLabels(currentRunIdentity());
      delete labels[missingKey];
      expect(parseDockerRunIdentity(labels)).toBeUndefined();
    },
  );

  it("pid 字段不是数字时判定没有运行标识", async () => {
    const { parseDockerRunIdentity } = await import("./run-identity.ts");
    expect(
      parseDockerRunIdentity({ "niceeval.host": "h", "niceeval.pid": "not-a-number", "niceeval.started-at": "t" }),
    ).toBeUndefined();
  });

  it("undefined label/metadata 集合判定没有运行标识", async () => {
    const { parseDockerRunIdentity, parseE2BRunIdentity } = await import("./run-identity.ts");
    expect(parseDockerRunIdentity(undefined)).toBeUndefined();
    expect(parseE2BRunIdentity(undefined)).toBeUndefined();
  });
});

describe("classifyRunIdentity: 孤儿三条件里「属主已死亡」的裁决,偏保守", () => {
  it("同宿主且 pid 存活 → alive(调用方应整个排除,不进孤儿列表)", async () => {
    const { classifyRunIdentity } = await import("./run-identity.ts");
    expect(classifyRunIdentity({ host: hostname(), pid: process.pid, startedAt: "t" })).toBe("alive");
  });

  it("同宿主且 pid 不存活 → orphan", async () => {
    const { classifyRunIdentity } = await import("./run-identity.ts");
    expect(classifyRunIdentity({ host: hostname(), pid: deadPid(), startedAt: "t" })).toBe("orphan");
  });

  it("异宿主 → unverified,即使 pid 数值上恰好活着,也不当同宿主核对", async () => {
    const { classifyRunIdentity } = await import("./run-identity.ts");
    expect(classifyRunIdentity({ host: "some-other-host", pid: process.pid, startedAt: "t" })).toBe("unverified");
    expect(classifyRunIdentity({ host: "some-other-host", pid: deadPid(), startedAt: "t" })).toBe("unverified");
  });
});

/** 一个几乎确定不存在的 pid,用于制造「同宿主但已死」的场景;真实系统 pid 上限远低于此值。 */
function deadPid(): number {
  return 999_999_999;
}

describe("listOrphanCandidates: 孤儿核对(docker + e2b)", () => {
  it("docker:排除留存注册表已登记条目,只保留带运行标识且非 alive 的容器", async () => {
    dockerListContainersMock.mockResolvedValue([
      {
        Id: "aaaaaaaaaaaa1111",
        Labels: { "niceeval.host": hostname(), "niceeval.pid": String(deadPid()), "niceeval.started-at": "2026-07-20T14:02:00.000Z" },
      },
      {
        // 留存注册表已登记的条目:即使带运行标识也不是孤儿。
        Id: "bbbbbbbbbbbb2222",
        Labels: { "niceeval.host": hostname(), "niceeval.pid": String(deadPid()), "niceeval.started-at": "t" },
      },
      {
        // 属主还活着:完全不出现在孤儿列表里(不是 unverified)。
        Id: "cccccccccccc3333",
        Labels: { "niceeval.host": hostname(), "niceeval.pid": String(process.pid), "niceeval.started-at": "t" },
      },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates } = await import("./orphans.ts");
    const keptIds = new Set(["bbbbbbbbbbbb"]); // 12 位短 id,与 sandboxId 截断口径一致
    const candidates = await listOrphanCandidates(keptIds);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ provider: "docker", sandboxId: "aaaaaaaaaaaa", state: "orphan" });
  });

  it("e2b:异宿主标识判定 unverified,与 docker 的 orphan 一起返回", async () => {
    dockerListContainersMock.mockResolvedValue([]);
    e2bListMock.mockReturnValue(
      fakePaginator([
        {
          sandboxId: "sbx-1",
          metadata: { "niceeval-host": "ci-runner-07", "niceeval-pid": "913", "niceeval-started-at": "2026-07-20T13:40:00.000Z" },
        },
      ]),
    );

    const { listOrphanCandidates } = await import("./orphans.ts");
    const candidates = await listOrphanCandidates(new Set());

    expect(candidates).toEqual([
      {
        provider: "e2b",
        sandboxId: "sbx-1",
        identity: { host: "ci-runner-07", pid: 913, startedAt: "2026-07-20T13:40:00.000Z" },
        state: "unverified",
      },
    ]);
  });

  it("docker daemon 不可用(listContainers 抛错)时静默返回空集合,不整体报错", async () => {
    dockerListContainersMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates } = await import("./orphans.ts");
    await expect(listOrphanCandidates(new Set())).resolves.toEqual([]);
  });

  it("没有运行标识的容器(非 niceeval 或旧版本)不出现在候选里", async () => {
    dockerListContainersMock.mockResolvedValue([{ Id: "dddddddddddd4444", Labels: {} }]);
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates } = await import("./orphans.ts");
    await expect(listOrphanCandidates(new Set())).resolves.toEqual([]);
  });
});

describe("pruneOrphans: 幂等、--force 语义与失败退出", () => {
  function twoOrphansAndOneUnverified() {
    dockerListContainersMock.mockResolvedValue([
      { Id: "aaaaaaaaaaaa", Labels: { "niceeval.host": hostname(), "niceeval.pid": String(deadPid()), "niceeval.started-at": "t1" } },
      { Id: "bbbbbbbbbbbb", Labels: { "niceeval.host": hostname(), "niceeval.pid": String(deadPid()), "niceeval.started-at": "t2" } },
    ]);
    e2bListMock.mockReturnValue(
      fakePaginator([{ sandboxId: "sbx-unverified", metadata: { "niceeval-host": "other-host", "niceeval-pid": "1", "niceeval-started-at": "t3" } }]),
    );
  }

  it("默认(无 --force)只销毁 orphan,unverified 原样保留并计入 unverifiedRemaining", async () => {
    twoOrphansAndOneUnverified();
    destroyDetachedMock.mockResolvedValue("stopped");

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(), false);

    expect(outcome.pruned.map((c) => c.sandboxId).sort()).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.unverifiedRemaining).toBe(1);
    expect(destroyDetachedMock).toHaveBeenCalledTimes(2);
    expect(destroyDetachedMock).not.toHaveBeenCalledWith("e2b", "sbx-unverified");
  });

  it("--force 连 unverified 一起销毁,unverifiedRemaining 归零", async () => {
    twoOrphansAndOneUnverified();
    destroyDetachedMock.mockResolvedValue("stopped");

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(), true);

    expect(outcome.pruned).toHaveLength(3);
    expect(outcome.unverifiedRemaining).toBe(0);
    expect(destroyDetachedMock).toHaveBeenCalledWith("e2b", "sbx-unverified");
  });

  it("幂等:destroyDetached 报告 already-gone 时同样算成功销毁,不报错", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "aaaaaaaaaaaa", Labels: { "niceeval.host": hostname(), "niceeval.pid": String(deadPid()), "niceeval.started-at": "t" } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));
    destroyDetachedMock.mockResolvedValue("already-gone");

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(), false);

    expect(outcome.pruned).toHaveLength(1);
    expect(outcome.failed).toEqual([]);
  });

  it("单台销毁失败列出并继续处理其余,不因一台失败中止整批", async () => {
    twoOrphansAndOneUnverified();
    destroyDetachedMock.mockImplementation(async (_provider: string, sandboxId: string) => {
      if (sandboxId === "aaaaaaaaaaaa") throw new Error("docker daemon rejected removal");
      return "stopped";
    });

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(), false);

    expect(outcome.pruned.map((c) => c.sandboxId)).toEqual(["bbbbbbbbbbbb"]);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]).toMatchObject({ message: "docker daemon rejected removal" });
    expect(outcome.failed[0]!.candidate.sandboxId).toBe("aaaaaaaaaaaa");
  });

  it("留存注册表已登记的条目永不被 prune 触碰,即使它同时带运行标识", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "aaaaaaaaaaaa", Labels: { "niceeval.host": hostname(), "niceeval.pid": String(deadPid()), "niceeval.started-at": "t" } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));
    destroyDetachedMock.mockResolvedValue("stopped");

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(["aaaaaaaaaaaa"]), true);

    expect(outcome.pruned).toEqual([]);
    expect(destroyDetachedMock).not.toHaveBeenCalled();
  });
});
