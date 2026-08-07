// cases: docs/engineering/testing/unit/sandbox.md
// keep.ts 的留存(keep)登记项 expiresAt 计算,与 detached 生命周期路由:三 provider
// (docker/e2b/vercel)分支各自的正常路径与失败路径。mock dockerode / e2b / @vercel/sandbox /
// node:child_process,不发真实请求——真实 provider 行为归 E2E(../../docs/engineering/testing/e2e/README.md)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

// ---- dockerode ----
const dockerGetContainerMock = vi.fn();
class FakeDocker {
  getContainer(...args: unknown[]) {
    return dockerGetContainerMock(...args);
  }
}
vi.mock("dockerode", () => ({ default: FakeDocker }));

// ---- e2b ----
const e2bListMock = vi.fn();
const e2bKillMock = vi.fn();
const e2bResumeMock = vi.fn();
const e2bConnectMock = vi.fn();
const e2bPauseMock = vi.fn();
vi.mock("e2b", () => ({
  Sandbox: {
    list: (...a: unknown[]) => e2bListMock(...a),
    kill: (...a: unknown[]) => e2bKillMock(...a),
    resume: (...a: unknown[]) => e2bResumeMock(...a),
    connect: (...a: unknown[]) => e2bConnectMock(...a),
    pause: (...a: unknown[]) => e2bPauseMock(...a),
  },
}));

function fakePaginator(items: unknown[]) {
  let done = false;
  return { get hasNext() { return !done; }, nextItems: async () => { done = true; return items; } };
}

/** 多页分页器:每次 `nextItems()` 只吐出一页,直到 `pages` 耗尽——用于证明翻页真的逐页推进,
 *  不是只看第一页。 */
function fakeMultiPagePaginator(pages: unknown[][]) {
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

// ---- @vercel/sandbox ----
const vercelGetMock = vi.fn();
vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    get: (...a: unknown[]) => vercelGetMock(...a),
  },
}));

// ---- node:child_process(openInteractiveShell 的子进程 spawn) ----
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...a: unknown[]) => spawnMock(...a),
}));

import {
  computeExpiresAt,
  destroyDetached,
  detachedCapabilityGap,
  execInDetached,
  inspectDetached,
  nativeEnterCommand,
  openInteractiveShell,
  suspendDetached,
  suspendSandbox,
  wakeDetached,
} from "./keep.ts";
import type { Sandbox } from "../types.ts";
import { noSandboxBackendCapabilities, supportedBackendCapability } from "./backend.ts";
import { normalizeSandboxPaths } from "./paths.ts";

const CLOUD_ENV_KEYS = ["VERCEL_API_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID", "E2B_API_KEY"] as const;
let savedEnv: globalThis.Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetAllMocks();
  savedEnv = Object.fromEntries(CLOUD_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of CLOUD_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of CLOUD_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("computeExpiresAt", () => {
  it("docker: 本地停驻,非远端保留期概念 -> undefined", () => {
    expect(computeExpiresAt("docker", "2026-07-14T15:02:00.000Z")).toBeUndefined();
  });

  it("e2b: pause 官方契约无自然过期 -> undefined", () => {
    expect(computeExpiresAt("e2b", "2026-07-14T15:02:00.000Z")).toBeUndefined();
  });

  it("vercel: keptAt + 默认快照保留期(30 天,2,592,000,000ms)", () => {
    const keptAt = "2026-07-14T15:02:00.000Z";
    expect(computeExpiresAt("vercel", keptAt)).toBe(
      new Date(new Date(keptAt).getTime() + 2_592_000_000).toISOString(),
    );
    expect(computeExpiresAt("vercel", keptAt)).toBe("2026-08-13T15:02:00.000Z");
  });

  it("未知 provider 名同样不写(不是 KEEPABLE_PROVIDERS 三家之一时没有 TTL 语义可算)", () => {
    expect(computeExpiresAt("local", "2026-07-14T15:02:00.000Z")).toBeUndefined();
  });
});

describe("suspendSandbox", () => {
  function fakeSandboxWithSuspend(suspendSupported: boolean): { sandbox: Sandbox; suspend: ReturnType<typeof vi.fn> } {
    const suspend = vi.fn().mockResolvedValue(undefined);
    const backend: import("./backend.ts").SandboxProviderBackend = {
      workdir: "/work",
      sandboxId: "sbx-no-suspend",
      otlpHost: null,
      capabilities: {
        ...noSandboxBackendCapabilities,
        ...(suspendSupported ? { suspend: supportedBackendCapability(suspend) } : {}),
      },
      runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      runShell: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      readText: async () => "",
      writeText: async () => {},
      readBytes: async () => new Uint8Array(),
      writeBytes: async () => {},
      pathExists: async () => true,
      uploadDirectory: async () => {},
      stop: async () => {},
      downloadFile: async () => {},
      uploadFile: async () => {},
      downloadDirectory: async () => {},
    };
    return { sandbox: normalizeSandboxPaths(backend, "fake"), suspend };
  }

  it("底层实例有 suspend() -> 原样调用", async () => {
    const { sandbox, suspend } = fakeSandboxWithSuspend(true);
    await suspendSandbox(sandbox);
    expect(suspend).toHaveBeenCalledTimes(1);
  });

  it("底层实例没有 suspend() -> 抛出带 sandboxId 的清晰错误(不是静默跳过)", async () => {
    const { sandbox } = fakeSandboxWithSuspend(false);
    await expect(suspendSandbox(sandbox)).rejects.toThrow(/no suspend capability.*sbx-no-suspend/);
  });
});

describe("detachedCapabilityGap", () => {
  it.each(["docker", "e2b", "vercel"])("%s 是已知 niceeval provider -> undefined(可执行)", (p) => {
    expect(detachedCapabilityGap(p)).toBeUndefined();
  });

  it("未知 provider 名 -> 返回可展示的非空原因", () => {
    const reason = detachedCapabilityGap("acme-cloud");
    expect(typeof reason).toBe("string");
    expect(reason!.length).toBeGreaterThan(0);
    expect(reason).toContain("acme-cloud");
  });
});

describe("nativeEnterCommand", () => {
  it("三 provider 各自的原生直连命令", () => {
    expect(nativeEnterCommand("docker", "abc")).toBe("docker start abc && docker exec -it abc bash");
    expect(nativeEnterCommand("e2b", "abc")).toBe("e2b sandbox connect abc");
    expect(nativeEnterCommand("vercel", "abc")).toBe("sandbox connect abc");
  });

  it("未知 provider -> undefined", () => {
    expect(nativeEnterCommand("acme-cloud", "abc")).toBeUndefined();
  });
});

describe("wakeDetached", () => {
  describe("docker", () => {
    it("已在运行 -> 不重复 start", async () => {
      const start = vi.fn();
      dockerGetContainerMock.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
        start,
      });
      await wakeDetached("docker", "abc");
      expect(start).not.toHaveBeenCalled();
    });

    it("已停驻 -> docker start", async () => {
      const start = vi.fn().mockResolvedValue(undefined);
      dockerGetContainerMock.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
        start,
      });
      await wakeDetached("docker", "abc");
      expect(start).toHaveBeenCalledTimes(1);
    });

    it("DinD 唤醒后以 Agent 用户等待 inner daemon readiness", async () => {
      const stream = Readable.from([]);
      const execution = {
        start: vi.fn().mockResolvedValue(stream),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      };
      const exec = vi.fn().mockResolvedValue(execution);
      dockerGetContainerMock.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          State: { Running: false },
          Config: {
            Labels: {
              "niceeval.docker-access": "dind",
              "niceeval.dind-readiness-user": "node",
            },
          },
        }),
        start: vi.fn().mockResolvedValue(undefined),
        exec,
      });

      await wakeDetached("docker", "abc");

      expect(exec).toHaveBeenCalledWith(expect.objectContaining({
        Cmd: ["docker", "info"],
        User: "node",
      }));
    });
  });

  describe("e2b", () => {
    it("resume 成功 -> 调用 Sandbox.resume(sandboxId, opts)", async () => {
      e2bResumeMock.mockResolvedValue(undefined);
      await wakeDetached("e2b", "sbx-1");
      expect(e2bResumeMock).toHaveBeenCalledTimes(1);
      expect(e2bResumeMock.mock.calls[0]![0]).toBe("sbx-1");
    });

    it("resume 被 SDK 拒绝 -> 抛出原始错误", async () => {
      const err = new Error("network down");
      e2bResumeMock.mockRejectedValue(err);
      await expect(wakeDetached("e2b", "sbx-1")).rejects.toBe(err);
    });
  });

  describe("vercel", () => {
    it("Sandbox.get({ name, resume: true }) 唤醒(name 而非 sessionId)", async () => {
      vercelGetMock.mockResolvedValue({});
      await wakeDetached("vercel", "my-persistent-sbx");
      expect(vercelGetMock).toHaveBeenCalledWith({ name: "my-persistent-sbx", resume: true });
    });

    it("get 被 SDK 拒绝 -> 抛出原始错误", async () => {
      const err = new Error("api down");
      vercelGetMock.mockRejectedValue(err);
      await expect(wakeDetached("vercel", "my-sbx")).rejects.toBe(err);
    });
  });

  it("未知 provider -> 抛错", async () => {
    await expect(wakeDetached("acme-cloud", "x")).rejects.toThrow(/no wake channel/);
  });
});

describe("suspendDetached", () => {
  it("docker: container.stop({ t: 5 })", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    dockerGetContainerMock.mockReturnValue({ stop });
    await suspendDetached("docker", "abc");
    expect(stop).toHaveBeenCalledWith({ t: 5 });
  });

  describe("e2b", () => {
    it("pause 成功 -> 调用 Sandbox.pause(sandboxId, opts)", async () => {
      e2bPauseMock.mockResolvedValue(undefined);
      await suspendDetached("e2b", "sbx-1");
      expect(e2bPauseMock.mock.calls[0]![0]).toBe("sbx-1");
    });

    it("pause 被 SDK 拒绝 -> 抛出原始错误", async () => {
      const err = new Error("pause failed");
      e2bPauseMock.mockRejectedValue(err);
      await expect(suspendDetached("e2b", "sbx-1")).rejects.toBe(err);
    });
  });

  describe("vercel", () => {
    it("get({ name, resume: false }) 找到实例后调用 stop()(不是 delete())——避免唤醒副作用", async () => {
      const stop = vi.fn().mockResolvedValue(undefined);
      const del = vi.fn();
      vercelGetMock.mockResolvedValue({ stop, delete: del });
      await suspendDetached("vercel", "my-sbx");
      expect(vercelGetMock).toHaveBeenCalledWith({ name: "my-sbx", resume: false });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(del).not.toHaveBeenCalled();
    });

    it("实例已不存在 -> 抛错", async () => {
      vercelGetMock.mockResolvedValue(null);
      await expect(suspendDetached("vercel", "gone")).rejects.toThrow(/not found/);
    });
  });

  it("未知 provider -> 抛错", async () => {
    await expect(suspendDetached("acme-cloud", "x")).rejects.toThrow(/no suspend channel/);
  });
});

describe("inspectDetached", () => {
  describe("docker", () => {
    it("Running -> alive", async () => {
      dockerGetContainerMock.mockReturnValue({ inspect: vi.fn().mockResolvedValue({ State: { Running: true } }) });
      expect(await inspectDetached("docker", "abc")).toBe("alive");
    });

    it("已停驻 -> dormant", async () => {
      dockerGetContainerMock.mockReturnValue({ inspect: vi.fn().mockResolvedValue({ State: { Running: false } }) });
      expect(await inspectDetached("docker", "abc")).toBe("dormant");
    });

    it("inspect 探测抛错 -> unknown(不把凭据/daemon 故障伪装成已删除)", async () => {
      dockerGetContainerMock.mockReturnValue({ inspect: vi.fn().mockRejectedValue(new Error("no such container")) });
      expect(await inspectDetached("docker", "abc")).toBe("unknown");
    });
  });

  describe("e2b", () => {
    it("list 命中且 running -> alive", async () => {
      e2bListMock.mockReturnValue(fakePaginator([{ sandboxId: "sbx-1", state: "running" }]));
      expect(await inspectDetached("e2b", "sbx-1")).toBe("alive");
    });

    it("list 未命中 -> expired", async () => {
      e2bListMock.mockReturnValue(fakePaginator([]));
      expect(await inspectDetached("e2b", "sbx-1")).toBe("expired");
    });

    it("list 抛错 -> unknown", async () => {
      e2bListMock.mockImplementation(() => {
        throw new Error("boom");
      });
      expect(await inspectDetached("e2b", "sbx-1")).toBe("unknown");
    });

    it("目标只在第二页 -> 完整翻页找到,不因第一页没命中就判 expired", async () => {
      // bug: memory/e2b-list-returns-paginator-not-array.md
      e2bListMock.mockReturnValue(
        fakeMultiPagePaginator([
          [{ sandboxId: "sbx-other-1", state: "running" }],
          [{ sandboxId: "sbx-1", state: "paused" }],
        ]),
      );
      expect(await inspectDetached("e2b", "sbx-1")).toBe("dormant");
    });
  });

  describe("vercel", () => {
    it("get({ name, resume: false }) 命中且 running -> alive,不产生唤醒副作用", async () => {
      vercelGetMock.mockResolvedValue({ status: "running" });
      expect(await inspectDetached("vercel", "my-sbx")).toBe("alive");
      expect(vercelGetMock).toHaveBeenCalledWith({ name: "my-sbx", resume: false });
    });

    it("get 返回 null(实例不存在) -> expired", async () => {
      vercelGetMock.mockResolvedValue(null);
      expect(await inspectDetached("vercel", "gone")).toBe("expired");
    });

    it("get 抛错 -> unknown", async () => {
      vercelGetMock.mockRejectedValue(new Error("boom"));
      expect(await inspectDetached("vercel", "my-sbx")).toBe("unknown");
    });
  });

  it("未知 provider -> expired", async () => {
    expect(await inspectDetached("acme-cloud", "x")).toBe("expired");
  });
});

describe("destroyDetached", () => {
  describe("docker", () => {
    it("remove 成功 -> stopped", async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      dockerGetContainerMock.mockReturnValue({ remove });
      expect(await destroyDetached("docker", "abc")).toBe("stopped");
      expect(remove).toHaveBeenCalledWith({ force: true });
    });

    it("remove 404(已不存在) -> already-gone", async () => {
      const err = Object.assign(new Error("no such container"), { statusCode: 404 });
      dockerGetContainerMock.mockReturnValue({ remove: vi.fn().mockRejectedValue(err) });
      expect(await destroyDetached("docker", "abc")).toBe("already-gone");
    });

    it("remove 其它错误 -> 上抛(不能把仍活着的资源从管理面隐藏掉)", async () => {
      const err = Object.assign(new Error("permission denied"), { statusCode: 500 });
      dockerGetContainerMock.mockReturnValue({ remove: vi.fn().mockRejectedValue(err) });
      await expect(destroyDetached("docker", "abc")).rejects.toBe(err);
    });
  });

  describe("e2b", () => {
    it("kill 返回 true -> stopped", async () => {
      e2bKillMock.mockResolvedValue(true);
      expect(await destroyDetached("e2b", "sbx-1")).toBe("stopped");
    });

    it("kill 返回 false(已不存在) -> already-gone", async () => {
      e2bKillMock.mockResolvedValue(false);
      expect(await destroyDetached("e2b", "sbx-1")).toBe("already-gone");
    });
  });

  describe("vercel", () => {
    it("找到实例 -> 调用 delete()(不是可恢复的 stop())", async () => {
      const del = vi.fn().mockResolvedValue(undefined);
      const stop = vi.fn();
      vercelGetMock.mockResolvedValue({ delete: del, stop });
      expect(await destroyDetached("vercel", "my-sbx")).toBe("stopped");
      expect(vercelGetMock).toHaveBeenCalledWith({ name: "my-sbx", resume: false });
      expect(del).toHaveBeenCalledTimes(1);
      expect(stop).not.toHaveBeenCalled();
    });

    it("get 明确 404 或未找到 -> already-gone(幂等),其它错误上抛", async () => {
      vercelGetMock.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
      expect(await destroyDetached("vercel", "gone")).toBe("already-gone");
      const outage = new Error("credentials unavailable");
      vercelGetMock.mockRejectedValueOnce(outage);
      await expect(destroyDetached("vercel", "gone")).rejects.toBe(outage);
    });
  });

  it("未知 provider -> 抛错", async () => {
    await expect(destroyDetached("acme-cloud", "x")).rejects.toThrow(/no detached stop channel/);
  });
});

describe("execInDetached", () => {
  it("docker: exec 一条命令,多路复用帧逐帧剥离拼回文本", async () => {
    const start = vi.fn().mockResolvedValue(buildDockerLogStream("hello from ledger\n"));
    const exec = vi.fn().mockResolvedValue({ start });
    dockerGetContainerMock.mockReturnValue({ exec });

    const out = await execInDetached("docker", "abc", "/workspace", "git log");

    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({ Cmd: ["sh", "-c", "git log"], AttachStdout: true, AttachStderr: true }),
    );
    expect(out).toBe("hello from ledger\n");
  });

  it("e2b: connect 拿句柄后 commands.run(script, { cwd, envs })", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "e2b ledger output\n" });
    e2bConnectMock.mockResolvedValue({ commands: { run } });

    const out = await execInDetached("e2b", "sbx-1", "/home/user/workspace", "git log");

    expect(e2bConnectMock.mock.calls[0]![0]).toBe("sbx-1");
    expect(run).toHaveBeenCalledWith("git log", expect.objectContaining({ cwd: "/home/user/workspace" }));
    expect(out).toBe("e2b ledger output\n");
  });

  it("vercel: get({ name, resume: false }) 后 runCommand 取 stdout()", async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: async () => "vercel ledger output\n" });
    vercelGetMock.mockResolvedValue({ runCommand });

    const out = await execInDetached("vercel", "my-sbx", "/vercel/sandbox", "git log");

    expect(vercelGetMock).toHaveBeenCalledWith({ name: "my-sbx", resume: false });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: "sh", args: ["-c", "git log"], cwd: "/vercel/sandbox" }),
    );
    expect(out).toBe("vercel ledger output\n");
  });

  it("未知 provider -> 抛错", async () => {
    await expect(execInDetached("acme-cloud", "x", "/w", "git log")).rejects.toThrow(/no exec channel/);
  });
});

describe("openInteractiveShell", () => {
  it("docker: 起 docker exec -it -w <workdir> <id> bash -l,返回退出码", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const promise = openInteractiveShell("docker", "abc", "/workspace");
    await vi.waitFor(() => expect(child.handlers.exit).toBeDefined());
    child.handlers.exit!(0);
    expect(await promise).toBe(0);
    expect(spawnMock).toHaveBeenCalledWith(
      "docker",
      ["exec", "-it", "-w", "/workspace", "abc", "bash", "-l"],
      { stdio: "inherit" },
    );
  });

  it("e2b: 起 e2b sandbox connect <id>", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const promise = openInteractiveShell("e2b", "sbx-1", "/home/user/workspace");
    await vi.waitFor(() => expect(child.handlers.exit).toBeDefined());
    child.handlers.exit!(0);
    await promise;
    expect(spawnMock).toHaveBeenCalledWith("e2b", ["sandbox", "connect", "sbx-1"], { stdio: "inherit" });
  });

  it("vercel: 起 sandbox connect --workdir <workdir> <id>", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const promise = openInteractiveShell("vercel", "my-sbx", "/vercel/sandbox");
    await vi.waitFor(() => expect(child.handlers.exit).toBeDefined());
    child.handlers.exit!(0);
    await promise;
    expect(spawnMock).toHaveBeenCalledWith(
      "sandbox",
      ["connect", "--workdir", "/vercel/sandbox", "my-sbx"],
      { stdio: "inherit" },
    );
  });

  it("原生命令本身起不来(如未装对应 CLI) -> 上抛 spawn 的原始错误", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const promise = openInteractiveShell("docker", "abc", "/workspace");
    await vi.waitFor(() => expect(child.handlers.error).toBeDefined());
    const err = Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    child.handlers.error!(err);
    await expect(promise).rejects.toBe(err);
  });

  it("未知 provider -> 抛错", async () => {
    await expect(openInteractiveShell("acme-cloud", "x", "/w")).rejects.toThrow(/no interactive enter channel/);
  });
});

/** 构造一段 docker exec 多路复用输出流:8 字节帧头(stream type + 长度)后跟 payload。 */
function buildDockerLogStream(text: string): NodeJS.ReadableStream {
  const payload = Buffer.from(text, "utf-8");
  const header = Buffer.alloc(8);
  header.writeUInt8(1, 0); // stdout
  header.writeUInt32BE(payload.length, 4);
  const framed = Buffer.concat([header, payload]);
  return Readable.from(framed) as unknown as NodeJS.ReadableStream;
}

/** 一个可控的 fake ChildProcess:记录 on() 注册的回调,供测试手动触发 exit/error。 */
function fakeChildProcess(): {
  handlers: globalThis.Record<string, (...a: unknown[]) => void>;
  on: (e: string, cb: (...a: unknown[]) => void) => unknown;
} {
  const handlers: globalThis.Record<string, (...a: unknown[]) => void> = {};
  const child = {
    handlers,
    on(event: string, cb: (...a: unknown[]) => void) {
      handlers[event] = cb;
      return child;
    },
  };
  return child;
}
