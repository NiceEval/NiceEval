// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖「孤儿核对与 prune」声明的三行:创建期运行标识元数据的写入边界(run-identity.ts 的
// label/metadata 往返与缺字段降级);孤儿三条件与 unverified 的保守判定(同宿主存活排除、
// 同宿主死亡→orphan、异宿主→unverified、留存注册表条目排除);prune 的幂等、--force 语义与
// 失败退出码(单台失败列出继续处理其余,不因一台失败中止整批)。mock dockerode / e2b,不发
// 真实请求——真实 provider 行为归 E2E(../../docs/engineering/testing/e2e/README.md)。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostname } from "node:os";

const dockerListContainersMock = vi.fn();
const dockerListNetworksMock = vi.fn();
const dockerRemoveContainerMock = vi.fn();
const dockerRemoveNetworkMock = vi.fn();
class FakeDocker {
  listContainers(...args: unknown[]) {
    return dockerListContainersMock(...args);
  }
  listNetworks(...args: unknown[]) {
    return dockerListNetworksMock(...args);
  }
  getContainer(id: string) {
    return { remove: (opts: unknown) => dockerRemoveContainerMock(id, opts) };
  }
  getNetwork(id: string) {
    return { remove: () => dockerRemoveNetworkMock(id) };
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

beforeEach(() => {
  // 多数用例只关心容器那一半;网络查询默认返回空集合,由 Compose 组的用例显式覆盖。
  dockerListNetworksMock.mockResolvedValue([]);
  dockerRemoveContainerMock.mockResolvedValue(undefined);
  dockerRemoveNetworkMock.mockResolvedValue(undefined);
});

afterEach(() => {
  dockerListContainersMock.mockReset();
  dockerListNetworksMock.mockReset();
  dockerRemoveContainerMock.mockReset();
  dockerRemoveNetworkMock.mockReset();
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
    expect(classifyRunIdentity({ host: hostname(), pid: process.pid, startedAt: new Date().toISOString() }, () => "2000-01-01T00:00:00.000Z")).toBe("alive");
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

  it("pid 已复用(当前进程启动晚于登记 run) → orphan；取不到启动时间 → unverified", async () => {
    const { classifyRunIdentity } = await import("./run-identity.ts");
    const identity = { host: hostname(), pid: process.pid, startedAt: "2020-01-01T00:00:00.000Z" };
    expect(classifyRunIdentity(identity, () => "2021-01-01T00:00:00.000Z")).toBe("orphan");
    expect(classifyRunIdentity(identity, () => undefined)).toBe("unverified");
  });
});

/** 一个几乎确定不存在的 pid,用于制造「同宿主但已死」的场景;真实系统 pid 上限远低于此值。 */
function deadPid(): number {
  return 999_999_999;
}

describe("listOrphanCandidates: 孤儿核对(docker + e2b)", () => {
  it("docker:排除留存注册表已登记条目,按注入判据保留 orphan 与 unverified,alive 完全不进列表", async () => {
    const ORPHAN_PID = 1;
    const ALIVE_PID = 2;
    const UNVERIFIED_PID = 3;
    dockerListContainersMock.mockResolvedValue([
      {
        Id: "aaaaaaaaaaaa1111",
        Labels: { "niceeval.host": hostname(), "niceeval.pid": String(ORPHAN_PID), "niceeval.started-at": "2026-07-20T14:02:00.000Z" },
      },
      {
        // 留存注册表已登记的条目:即使带运行标识也不是孤儿,连判据都不会被调用。
        Id: "bbbbbbbbbbbb2222",
        Labels: { "niceeval.host": hostname(), "niceeval.pid": String(ORPHAN_PID), "niceeval.started-at": "t" },
      },
      {
        // 属主还活着:完全不出现在孤儿列表里(不是 unverified)。
        Id: "cccccccccccc3333",
        Labels: { "niceeval.host": hostname(), "niceeval.pid": String(ALIVE_PID), "niceeval.started-at": "t" },
      },
      {
        // 判据给不出确定结论:同样出现在列表里,但状态是 unverified 不是 orphan。
        Id: "dddddddddddd4444",
        Labels: { "niceeval.host": hostname(), "niceeval.pid": String(UNVERIFIED_PID), "niceeval.started-at": "t" },
      },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates } = await import("./orphans.ts");
    const keptIds = new Set(["bbbbbbbbbbbb"]); // 12 位短 id,与 sandboxId 截断口径一致
    // 注入窄判据,按 pid 直接裁决三种状态——不经真实 ps 探测或当前进程真实启动时刻,结果
    // 在任意环境(含禁止 ps 的受限容器)下确定性一致;classifyRunIdentity 自身的
    // host/pid/启动时刻裁决语义由下面独立的「classifyRunIdentity」用例组覆盖。
    const classify = (identity: { pid: number }) =>
      identity.pid === ALIVE_PID ? ("alive" as const) : identity.pid === ORPHAN_PID ? ("orphan" as const) : ("unverified" as const);
    const candidates = await listOrphanCandidates(keptIds, classify);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ provider: "docker", sandboxId: "aaaaaaaaaaaa", state: "orphan" });
    expect(candidates[1]).toMatchObject({ provider: "docker", sandboxId: "dddddddddddd", state: "unverified" });
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

describe("资源组:Compose case 的伴随容器与网络整组核对、整组销毁", () => {
  const PROJECT = "ne-tb-net-a1b2c3";
  const DEAD = { "niceeval.host": hostname(), "niceeval.pid": String(deadPid()), "niceeval.started-at": "2026-07-31T09:00:00.000Z" };

  it("识别 label:受管 overlay 把运行标识写到组内每个服务与每个受管网络上", async () => {
    const { buildComposeIdentityOverlay } = await import("./compose.ts");
    const yaml = buildComposeIdentityOverlay({
      identity: { host: "mbp", pid: 4242, startedAt: "2026-07-31T09:00:00.000Z" },
      serviceNames: ["client", "program"],
      networkNames: ["default"],
    });
    expect(yaml).toContain("services:");
    expect(yaml).toContain("  client:");
    expect(yaml).toContain("  program:");
    expect(yaml).toContain("networks:");
    expect(yaml).toContain("  default:");
    // 网络那一半必须自带标识,否则主容器消失后没有任何可核对的归属。
    expect(yaml.slice(yaml.indexOf("networks:"))).toContain('niceeval.pid: "4242"');
    expect(yaml.match(/niceeval\.host: "mbp"/g)).toHaveLength(3);
  });

  it("受管网络名:服务未声明网络时是 default;external 网络不进受管清单", async () => {
    const { inspectComposeYaml } = await import("./compose.ts");
    expect(inspectComposeYaml("services:\n  a:\n    image: alpine\n").networkNames).toEqual(["default"]);
    expect(
      inspectComposeYaml("services:\n  a:\n    image: alpine\n    networks:\n      - lan\nnetworks:\n  lan:\n    external: true\n")
        .networkNames,
    ).toEqual([]);
    expect(
      inspectComposeYaml("services:\n  a:\n    image: alpine\n    networks:\n      - lan\nnetworks:\n  lan:\n    driver: bridge\n")
        .networkNames,
    ).toEqual(["lan"]);
  });

  it("整组列出:主容器 + sidecar + 网络合成一条候选,不逐容器单列", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "main11111111aaaa", Labels: { ...DEAD, "com.docker.compose.project": PROJECT, "niceeval.main-service": "true" } },
      { Id: "side22222222bbbb", Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    dockerListNetworksMock.mockResolvedValue([
      { Id: "net1", Name: `${PROJECT}_default`, Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates } = await import("./orphans.ts");
    const candidates = await listOrphanCandidates(new Set());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      provider: "docker",
      sandboxId: "main11111111", // 主服务容器代表整组
      state: "orphan",
      resources: {
        kind: "docker-compose",
        projectName: PROJECT,
        containerIds: ["main11111111", "side22222222"],
        networkIds: ["net1"],
        networkNames: [`${PROJECT}_default`],
      },
    });
  });

  it("主实例已消失、只剩网络残留:仍被列出,并被 prune 收回", async () => {
    dockerListContainersMock.mockResolvedValue([]);
    dockerListNetworksMock.mockResolvedValue([
      { Id: "net1", Name: `${PROJECT}_default`, Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
      { Id: "net2", Name: `${PROJECT}_lan`, Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates, pruneOrphans } = await import("./orphans.ts");
    const candidates = await listOrphanCandidates(new Set());
    expect(candidates).toHaveLength(1);
    // 没有容器可当主键时退回 project 名,组照样有身份、有状态。
    expect(candidates[0]).toMatchObject({ sandboxId: PROJECT, state: "orphan", resources: { containerIds: [], networkIds: ["net1", "net2"] } });

    const outcome = await pruneOrphans(new Set(), false);
    expect(outcome.pruned).toHaveLength(1);
    expect(outcome.failed).toEqual([]);
    expect(dockerRemoveNetworkMock.mock.calls.map(([id]) => id)).toEqual(["net1", "net2"]);
    expect(destroyDetachedMock).not.toHaveBeenCalled();
  });

  it("整组销毁:先删组内容器再删网络,不走单实例 destroyDetached", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "main11111111aaaa", Labels: { ...DEAD, "com.docker.compose.project": PROJECT, "niceeval.main-service": "true" } },
      { Id: "side22222222bbbb", Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    dockerListNetworksMock.mockResolvedValue([
      { Id: "net1", Name: `${PROJECT}_default`, Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));
    const order: string[] = [];
    dockerRemoveContainerMock.mockImplementation(async (id: string) => void order.push(`container:${id}`));
    dockerRemoveNetworkMock.mockImplementation(async (id: string) => void order.push(`network:${id}`));

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(), false);

    expect(outcome.pruned).toHaveLength(1);
    // 网络还挂着容器时 daemon 拒绝删除,顺序不能反。
    expect(order).toEqual(["container:main11111111", "container:side22222222", "network:net1"]);
    expect(dockerRemoveContainerMock).toHaveBeenCalledWith("main11111111", { force: true, v: true });
    expect(destroyDetachedMock).not.toHaveBeenCalled();
  });

  it("组内任一容器已在留存注册表:整组免动", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "main11111111aaaa", Labels: { ...DEAD, "com.docker.compose.project": PROJECT, "niceeval.main-service": "true" } },
      { Id: "side22222222bbbb", Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    dockerListNetworksMock.mockResolvedValue([
      { Id: "net1", Name: `${PROJECT}_default`, Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(["main11111111"]), true);

    expect(outcome.pruned).toEqual([]);
    expect(dockerRemoveContainerMock).not.toHaveBeenCalled();
    expect(dockerRemoveNetworkMock).not.toHaveBeenCalled();
  });

  it("属主 run 还活着的资源组整组不出现在列表里", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "main11111111aaaa", Labels: { "niceeval.host": hostname(), "niceeval.pid": String(process.pid), "niceeval.started-at": "t", "com.docker.compose.project": PROJECT, "niceeval.main-service": "true" } },
    ]);
    dockerListNetworksMock.mockResolvedValue([
      { Id: "net1", Name: `${PROJECT}_default`, Labels: { "niceeval.host": hostname(), "niceeval.pid": String(process.pid), "niceeval.started-at": "t", "com.docker.compose.project": PROJECT } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates } = await import("./orphans.ts");
    await expect(listOrphanCandidates(new Set(), () => "alive")).resolves.toEqual([]);
  });

  it("整组销毁幂等:资源已不存在(404)算已完成,不记失败", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "main11111111aaaa", Labels: { ...DEAD, "com.docker.compose.project": PROJECT, "niceeval.main-service": "true" } },
    ]);
    dockerListNetworksMock.mockResolvedValue([
      { Id: "net1", Name: `${PROJECT}_default`, Labels: { ...DEAD, "com.docker.compose.project": PROJECT } },
    ]);
    e2bListMock.mockReturnValue(fakePaginator([]));
    dockerRemoveContainerMock.mockRejectedValue(Object.assign(new Error("no such container"), { statusCode: 404 }));
    dockerRemoveNetworkMock.mockRejectedValue(Object.assign(new Error("network not found"), { statusCode: 404 }));

    const { pruneOrphans } = await import("./orphans.ts");
    const outcome = await pruneOrphans(new Set(), false);

    expect(outcome.pruned).toHaveLength(1);
    expect(outcome.failed).toEqual([]);
  });

  it("网络查询失败(老 daemon)时容器那一半照常核对", async () => {
    dockerListContainersMock.mockResolvedValue([
      { Id: "main11111111aaaa", Labels: { ...DEAD, "com.docker.compose.project": PROJECT, "niceeval.main-service": "true" } },
    ]);
    dockerListNetworksMock.mockRejectedValue(new Error("filters not supported"));
    e2bListMock.mockReturnValue(fakePaginator([]));

    const { listOrphanCandidates } = await import("./orphans.ts");
    const candidates = await listOrphanCandidates(new Set());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.resources).toMatchObject({ containerIds: ["main11111111"], networkIds: [] });
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
