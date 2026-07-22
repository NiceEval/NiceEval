// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖两行声明:①「留存(keep)登记项的 expiresAt」里「`niceeval sandbox list` 的过期分支据
// 登记项的 `expiresAt` 展示保留截止时刻」；②「sandbox enter/history/diff 的能力路由
// (cli-commands.ts)」——三条命令统一走"能力声明 gap 检查 → 唤醒 → 操作 → 回眠"、不含 provider
// 名分支,以及条目级 lease 互斥。mock keep.ts 的 provider 路由函数(inspectDetached/
// wakeDetached/suspendDetached/destroyDetached/execInDetached/openInteractiveShell/
// detachedCapabilityGap),只证明 cli-commands.ts 自己的编排逻辑——provider SDK 细节由
// keep.test.ts 覆盖。

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keptEntryId, readKeptEntries, writeKeptEntry, type KeptSandboxEntry } from "./keep-registry.ts";

const mockInspectDetached = vi.fn<(provider: string, sandboxId: string) => Promise<"alive" | "dormant" | "expired">>();
const mockWakeDetached = vi.fn<(provider: string, sandboxId: string) => Promise<void>>();
const mockSuspendDetached = vi.fn<(provider: string, sandboxId: string) => Promise<void>>();
const mockDestroyDetached = vi.fn<(provider: string, sandboxId: string) => Promise<"stopped" | "already-gone">>();
const mockExecInDetached = vi.fn<(provider: string, sandboxId: string, workdir: string, script: string) => Promise<string>>();
const mockOpenInteractiveShell = vi.fn<(provider: string, sandboxId: string, workdir: string) => Promise<number>>();
const mockDetachedCapabilityGap = vi.fn<(provider: string) => string | undefined>();

vi.mock("./keep.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./keep.ts")>();
  return {
    ...actual,
    inspectDetached: mockInspectDetached,
    wakeDetached: mockWakeDetached,
    suspendDetached: mockSuspendDetached,
    destroyDetached: mockDestroyDetached,
    execInDetached: mockExecInDetached,
    openInteractiveShell: mockOpenInteractiveShell,
    detachedCapabilityGap: mockDetachedCapabilityGap,
  };
});

// orphans.ts 的核对/分类/prune 逻辑由 orphans.test.ts 覆盖(mock dockerode/e2b);这里只证明
// cli-commands.ts 自己的编排——输出格式与退出码,不重复孤儿判定的等价类。
const mockListOrphanCandidates = vi.fn();
const mockPruneOrphans = vi.fn();
const mockDockerOrphanCount = vi.fn();
vi.mock("./orphans.ts", () => ({
  listOrphanCandidates: mockListOrphanCandidates,
  pruneOrphans: mockPruneOrphans,
  dockerOrphanCount: mockDockerOrphanCount,
}));

const { runSandboxCommand } = await import("./cli-commands.ts");

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
  mockInspectDetached.mockReset();
  mockWakeDetached.mockReset();
  mockSuspendDetached.mockReset();
  mockDestroyDetached.mockReset();
  mockExecInDetached.mockReset();
  mockOpenInteractiveShell.mockReset();
  mockDetachedCapabilityGap.mockReset();
  mockListOrphanCandidates.mockReset();
  mockPruneOrphans.mockReset();
  mockDockerOrphanCount.mockReset();
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-sandbox-list-"));
  roots.push(dir);
  return dir;
}

function entry(over: Partial<KeptSandboxEntry> = {}): KeptSandboxEntry {
  return {
    sandboxId: "a3f9c2d1",
    provider: "vercel",
    evalId: "onboarding/tool-first",
    attempt: 1,
    locator: "@1x7f3q9k",
    verdict: "errored",
    keptAt: "2026-07-14T15:02:00.000Z",
    workdir: "/vercel/sandbox",
    state: "alive",
    ...over,
  };
}

function collectOut() {
  const lines: string[] = [];
  return { io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) }, lines: () => lines.join("") };
}

/** cli-commands.ts 的 formatWhen() 按本地时区渲染 "YYYY-MM-DD HH:MM";测试用同一算法算期望值,
 *  不跨时区断言绝对小时数(运行测试的机器时区不固定)。 */
function localWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("niceeval sandbox list — expired 分支", () => {
  it("vercel 条目带 expiresAt:核对现场为 expired 时,展示 expiresAt 换算出的保留截止时刻", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const expiresAt = "2026-08-13T15:02:00.000Z"; // keptAt + 30 天
    await writeKeptEntry(niceevalRoot, entry({ expiresAt }));
    mockInspectDetached.mockResolvedValue("expired");

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    const out = lines();
    expect(out).toContain("expired");
    expect(out).toContain("remove with: niceeval sandbox stop");
    // formatWhen 不导出,直接核对年月日片段而不依赖具体时区的时分表示。
    expect(out).toMatch(/expired 2026-08-13/);
  });

  it("e2b 条目没有 expiresAt(官方契约无自然过期,niceeval 不写):现场核对仍能报 expired,且不显示虚构的过期时刻", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider: "e2b", sandboxId: "e2b-sbx-1" }));
    mockInspectDetached.mockResolvedValue("expired");

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    const out = lines();
    expect(out).toContain("expired");
    expect(out).toContain("remove with: niceeval sandbox stop");
    // 没有 expiresAt 时不拼出 "expired undefined" 一类假时刻。
    expect(out).not.toContain("expired undefined");
    expect(out).not.toMatch(/expired \d{4}-\d{2}-\d{2}/);
  });

  it("docker 条目没有 expiresAt(本地停驻,非远端保留期概念):同样只在真实核对为 expired 时才报,不据字段猜测", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider: "docker", sandboxId: "docker-sbx-1", workdir: "/workspace" }));
    mockInspectDetached.mockResolvedValue("dormant");

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    const out = lines();
    expect(out).not.toContain("expired");
    expect(out).toContain("enter: niceeval sandbox enter");
  });
});

describe("sandbox enter — 能力路由", () => {
  it("detachedCapabilityGap 返回原因时直接报错退出 1,不核对现场、不唤醒、不打开 shell", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider: "acme-cloud", sandboxId: "acme-1" }));
    const id = keptEntryId("acme-cloud", "acme-1");
    mockDetachedCapabilityGap.mockReturnValue(
      '"acme-cloud" is not a niceeval sandbox provider (expected one of: docker, e2b, vercel)',
    );

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["enter", id], { run: niceevalRoot }, io);

    expect(code).toBe(1);
    expect(lines()).toContain("is not a niceeval sandbox provider");
    expect(mockInspectDetached).not.toHaveBeenCalled();
    expect(mockWakeDetached).not.toHaveBeenCalled();
    expect(mockOpenInteractiveShell).not.toHaveBeenCalled();
  });

  it("openInteractiveShell 抛错(未装对应原生 CLI)时:现场保持 alive、报错含 entry.enter 直连提示、不误判成功退出 0", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const enterHint = "docker start docker-sbx-2 && docker exec -it docker-sbx-2 bash";
    await writeKeptEntry(
      niceevalRoot,
      entry({ provider: "docker", sandboxId: "docker-sbx-2", workdir: "/workspace", state: "dormant", enter: enterHint }),
    );
    const id = keptEntryId("docker", "docker-sbx-2");
    mockDetachedCapabilityGap.mockReturnValue(undefined);
    mockInspectDetached.mockResolvedValue("dormant");
    mockWakeDetached.mockResolvedValue(undefined);
    const spawnErr = Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    mockOpenInteractiveShell.mockRejectedValue(spawnErr);

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["enter", id], { run: niceevalRoot }, io);

    expect(code).toBe(1);
    const out = lines();
    expect(out).toContain("failed to open an interactive shell");
    expect(out).toContain(enterHint);
    expect(mockWakeDetached).toHaveBeenCalledTimes(1);
    expect(mockSuspendDetached).not.toHaveBeenCalled();

    const { entries } = await readKeptEntries(niceevalRoot);
    expect(entries[0]!.entry.state).toBe("alive");
  });

  it.each([
    { provider: "docker", sandboxId: "docker-sbx-3", workdir: "/workspace" },
    { provider: "e2b", sandboxId: "e2b-sbx-3", workdir: "/home/user/workspace" },
  ])("$provider: enter 成功路径——唤醒 → 打开 shell → 送回休眠,cli-commands.ts 不含 provider 名分支", async ({ provider, sandboxId, workdir }) => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider, sandboxId, workdir, state: "dormant" }));
    const id = keptEntryId(provider, sandboxId);
    mockDetachedCapabilityGap.mockReturnValue(undefined);
    mockInspectDetached.mockResolvedValue("dormant");
    mockWakeDetached.mockResolvedValue(undefined);
    mockOpenInteractiveShell.mockResolvedValue(0);
    mockSuspendDetached.mockResolvedValue(undefined);

    const { io } = collectOut();
    const code = await runSandboxCommand(root, ["enter", id], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    expect(mockWakeDetached).toHaveBeenCalledWith(provider, sandboxId);
    expect(mockOpenInteractiveShell).toHaveBeenCalledWith(provider, sandboxId, workdir);
    expect(mockSuspendDetached).toHaveBeenCalledWith(provider, sandboxId);
    const { entries } = await readKeptEntries(niceevalRoot);
    expect(entries[0]!.entry.state).toBe("dormant");
  });
});

describe("sandbox history/diff — 能力路由", () => {
  it("history: 能力 gap 时直接报错退出 1,不唤醒、不执行读取", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider: "acme-cloud", sandboxId: "acme-2" }));
    const id = keptEntryId("acme-cloud", "acme-2");
    mockDetachedCapabilityGap.mockReturnValue(
      '"acme-cloud" is not a niceeval sandbox provider (expected one of: docker, e2b, vercel)',
    );

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["history", id], { run: niceevalRoot }, io);

    expect(code).toBe(1);
    expect(lines()).toContain("is not a niceeval sandbox provider");
    expect(mockWakeDetached).not.toHaveBeenCalled();
    expect(mockExecInDetached).not.toHaveBeenCalled();
  });

  it("history: 现场休眠时唤醒读取、读完送回休眠", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(
      niceevalRoot,
      entry({ provider: "docker", sandboxId: "docker-sbx-4", workdir: "/workspace", state: "dormant" }),
    );
    const id = keptEntryId("docker", "docker-sbx-4");
    mockDetachedCapabilityGap.mockReturnValue(undefined);
    mockInspectDetached.mockResolvedValue("dormant");
    mockWakeDetached.mockResolvedValue(undefined);
    mockSuspendDetached.mockResolvedValue(undefined);
    mockExecInDetached.mockResolvedValue("1700000000 anchor\n");

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["history", id], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    expect(mockWakeDetached).toHaveBeenCalledTimes(1);
    expect(mockSuspendDetached).toHaveBeenCalledTimes(1);
    expect(lines()).toContain("anchor");
  });

  it("diff: 能力 gap 时直接报错退出 1,不唤醒", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider: "acme-cloud", sandboxId: "acme-3" }));
    const id = keptEntryId("acme-cloud", "acme-3");
    mockDetachedCapabilityGap.mockReturnValue(
      '"acme-cloud" is not a niceeval sandbox provider (expected one of: docker, e2b, vercel)',
    );

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["diff", id], { run: niceevalRoot }, io);

    expect(code).toBe(1);
    expect(lines()).toContain("is not a niceeval sandbox provider");
    expect(mockWakeDetached).not.toHaveBeenCalled();
  });
});

describe("sandbox enter/stop — 条目级 lease 互斥", () => {
  it("enter 持有 lease 期间,并发 stop 被拒绝并报出持有者;lease 释放后 stop 才能接管", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(
      niceevalRoot,
      entry({ provider: "docker", sandboxId: "docker-sbx-5", workdir: "/workspace", state: "dormant" }),
    );
    const id = keptEntryId("docker", "docker-sbx-5");
    mockDetachedCapabilityGap.mockReturnValue(undefined);
    mockInspectDetached.mockResolvedValue("dormant");
    mockWakeDetached.mockResolvedValue(undefined);
    mockSuspendDetached.mockResolvedValue(undefined);
    mockDestroyDetached.mockResolvedValue("stopped");

    let resolveShell!: (code: number) => void;
    const shellPromise = new Promise<number>((resolvePromise) => {
      resolveShell = resolvePromise;
    });
    mockOpenInteractiveShell.mockReturnValue(shellPromise);

    const enterIo = collectOut();
    const enterPromise = runSandboxCommand(root, ["enter", id], { run: niceevalRoot }, enterIo.io);

    // 等 enter 真正持有 lease(已原子写入注册表)再发起并发 stop——不靠 sleep 猜时序。
    await vi.waitFor(async () => {
      const { entries } = await readKeptEntries(niceevalRoot);
      expect(entries[0]!.entry.lease).toBeDefined();
    });

    const stopIo = collectOut();
    const stopCode = await runSandboxCommand(root, ["stop", id], { run: niceevalRoot }, stopIo.io);

    expect(stopCode).toBe(1);
    expect(stopIo.lines()).toContain("is in use by");
    expect(mockDestroyDetached).not.toHaveBeenCalled();

    resolveShell(0);
    expect(await enterPromise).toBe(0);

    // enter 退出后 lease 已释放(withLease 的 finally),再 stop 应能正常接管。
    const stopIo2 = collectOut();
    const stopCode2 = await runSandboxCommand(root, ["stop", id], { run: niceevalRoot }, stopIo2.io);
    expect(stopCode2).toBe(0);
    expect(mockDestroyDetached).toHaveBeenCalledTimes(1);
  });
});

describe("sandbox list --orphans / prune — 命令组编排(判定与销毁逻辑由 orphans.test.ts 覆盖)", () => {
  it("list --orphans 零候选时输出 No orphan sandboxes.,退出码 0", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    mockListOrphanCandidates.mockResolvedValue([]);
    const { io, lines } = collectOut();

    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot, orphans: true }, io);

    expect(code).toBe(0);
    expect(lines()).toBe("No orphan sandboxes.\n");
  });

  it("list --orphans 有候选时按 ID/PROVIDER/OWNER/STARTED/STATE 列输出,orphan 的 OWNER 带 dead 后缀", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const startedAtOrphan = "2026-07-20T14:02:00.000Z";
    const startedAtUnverified = "2026-07-20T13:40:00.000Z";
    mockListOrphanCandidates.mockResolvedValue([
      { provider: "docker", sandboxId: "f31b9a02", identity: { host: "mbp", pid: 4242, startedAt: startedAtOrphan }, state: "orphan" },
      { provider: "e2b", sandboxId: "77e01bc2", identity: { host: "ci-07", pid: 913, startedAt: startedAtUnverified }, state: "unverified" },
    ]);
    const { io, lines } = collectOut();

    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot, orphans: true }, io);

    expect(code).toBe(0);
    const out = lines();
    // 时间列按本地时区渲染(与 formatWhen 同源),不跨时区断言绝对小时数——只核对结构与其余各列。
    expect(out).toContain(`f31b9a02  docker    pid 4242@mbp dead  ${localWhen(startedAtOrphan)}   orphan\n`);
    expect(out).toContain(`77e01bc2  e2b       pid 913@ci-07      ${localWhen(startedAtUnverified)}   unverified\n`);
    expect(out).toContain("Remove orphans with: niceeval sandbox prune\n");
  });

  it("prune 无候选时输出 No orphan sandboxes.,退出码 0", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    mockPruneOrphans.mockResolvedValue({ pruned: [], failed: [], unverifiedRemaining: 0 });
    const { io, lines } = collectOut();

    const code = await runSandboxCommand(root, ["prune"], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    expect(lines()).toBe("No orphan sandboxes.\n");
  });

  it("prune 全部成功时退出码 0,并按 --force 透传给 pruneOrphans", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    mockPruneOrphans.mockResolvedValue({
      pruned: [{ provider: "docker", sandboxId: "f31b9a02", identity: { host: "mbp", pid: 4242, startedAt: "2026-07-20T14:02:00.000Z" }, state: "orphan" }],
      failed: [],
      unverifiedRemaining: 1,
    });
    const { io, lines } = collectOut();

    const code = await runSandboxCommand(root, ["prune"], { run: niceevalRoot, force: true }, io);

    expect(code).toBe(0);
    expect(mockPruneOrphans).toHaveBeenCalledWith(expect.any(Set), true);
    expect(lines()).toContain("pruned 1 orphan sandbox\n");
    expect(lines()).toContain("unverified left");
  });

  it("prune 单台失败时退出码 1,failed 的信息照实列出", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    mockPruneOrphans.mockResolvedValue({
      pruned: [],
      failed: [
        {
          candidate: { provider: "docker", sandboxId: "f31b9a02", identity: { host: "mbp", pid: 4242, startedAt: "t" }, state: "orphan" },
          message: "docker daemon rejected removal",
        },
      ],
      unverifiedRemaining: 0,
    });
    const { io, lines } = collectOut();

    const code = await runSandboxCommand(root, ["prune"], { run: niceevalRoot }, io);

    expect(code).toBe(1);
    expect(lines()).toContain("failed to prune f31b9a02 (docker): docker daemon rejected removal");
  });
});
