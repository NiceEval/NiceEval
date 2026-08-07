// cases: docs/engineering/testing/unit/sandbox.md
// DockerSandbox.downloadDirectory 走 getArchive 单次 tar 取回(不同于 vercel/e2b 共用的
// find+read 模板,见 download-directory.test.ts)。这里 fake 容器的 getArchive,不连真实
// daemon——真实容器行为归 E2E(../../docs/engineering/testing/e2e/README.md)。
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import * as tar from "tar-stream";
import {
  assertRootlessPrivilegedDaemon,
  dockerHostConfig,
  DOCKER_ACCESS_COMPATIBILITY_COMMAND,
  dockerManagedNetworkOptions,
  DockerSandbox,
  resolveDockerSocketMount,
} from "./docker.ts";

describe("Docker privileged boundary and resources", () => {
  it("Docker access不向容器注入endpoint环境，并在作者readiness之前锁定默认Unix endpoint", () => {
    expect(DOCKER_ACCESS_COMPATIBILITY_COMMAND).toEqual([
      "sh",
      "-ec",
      expect.stringContaining('test -z "${DOCKER_HOST+x}"'),
    ]);
    expect(DOCKER_ACCESS_COMPATIBILITY_COMMAND[2]).toContain('test -z "${DOCKER_CONTEXT+x}"');
    expect(DOCKER_ACCESS_COMPATIBILITY_COMMAND[2]).toContain('docker context show');
    expect(DOCKER_ACCESS_COMPATIBILITY_COMMAND[2]).toContain("docker --host=unix:///var/run/docker.sock info");
  });

  it("作者自定义readiness不能绕过Docker access compatibility门", async () => {
    const sandbox = new DockerSandbox({
      dockerAccess: { mode: "dind", isolation: "raw-privileged" },
      readiness: { command: ["author-ready"], timeoutMs: 8, intervalMs: 1 },
    });
    const calls: string[] = [];
    const internals = sandbox as unknown as {
      container: { inspect: () => Promise<unknown> };
      execCommand: (command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
      waitForReadiness: () => Promise<void>;
    };
    internals.container = { inspect: async () => ({ State: { Running: true } }) };
    internals.execCommand = async (command) => {
      calls.push(command);
      return { exitCode: 1, stdout: "", stderr: "daemon starting" };
    };

    await expect(internals.waitForReadiness()).rejects.toThrow(/Docker access compatibility timed out/);
    expect(calls).toContain("sh");
    expect(calls).not.toContain("author-ready");
  });

  it("rootless-only privileged 拒绝默认/rootful/TCP daemon，只接受显式 rootless Unix socket", () => {
    const rootless = {
      ID: "daemon-123",
      SecurityOptions: ["name=seccomp,profile=builtin", "name=rootless"],
      DockerRootDir: "/data",
      CgroupDriver: "systemd",
      CgroupVersion: "2",
    };
    const attestation = { daemonId: "daemon-123", dataRoot: "/data" };
    expect(() => assertRootlessPrivilegedDaemon(
      rootless,
      "unix:///tmp/niceeval/docker.sock",
      attestation,
    )).not.toThrow();
    expect(() => assertRootlessPrivilegedDaemon(rootless, undefined, attestation)).toThrow(
      /explicit rootless Unix DOCKER_HOST/,
    );
    expect(() => assertRootlessPrivilegedDaemon(rootless, "unix:///var/run/docker.sock", attestation)).toThrow(
      /rootful Docker socket/,
    );
    expect(() => assertRootlessPrivilegedDaemon(rootless, "tcp://127.0.0.1:2375", attestation)).toThrow(
      /Unix DOCKER_HOST/,
    );
    expect(() => assertRootlessPrivilegedDaemon({
      ...rootless,
      SecurityOptions: ["name=seccomp,profile=builtin"],
    }, "unix:///tmp/niceeval/docker.sock", attestation)).toThrow(/SecurityOptions report rootless/);
    expect(() => assertRootlessPrivilegedDaemon({
      ...rootless,
      CgroupDriver: "none",
    }, "unix:///tmp/niceeval/docker.sock", attestation)).toThrow(/delegated cgroup v2/);
    expect(() => assertRootlessPrivilegedDaemon(
      rootless,
      "unix:///tmp/niceeval/docker.sock",
      { daemonId: undefined, dataRoot: "/data" },
    )).toThrow(/NICEEVAL_ROOTLESS_DOCKER_ID attestation/);
    expect(() => assertRootlessPrivilegedDaemon(
      rootless,
      "unix:///tmp/niceeval/docker.sock",
      { daemonId: "daemon-123", dataRoot: "/other" },
    )).toThrow(/DockerRootDir does not match/);
  });

  it("把结构化限制精确映射为 Docker HostConfig", () => {
    expect(dockerHostConfig("rootless", {
      cpus: 2.5,
      memoryBytes: 4_294_967_296,
      pidsLimit: 2048,
      readOnlyRootfs: true,
      tmpfs: { "/var/lib/docker": { sizeBytes: 3_221_225_472, mode: 0o711, uid: 0, gid: 0, executable: true } },
    }, ["1.1.1.1", "9.9.9.9"])).toMatchObject({
      Privileged: true,
      Dns: ["1.1.1.1", "9.9.9.9"],
      NanoCpus: 2_500_000_000,
      Memory: 4_294_967_296,
      MemorySwap: 4_294_967_296,
      PidsLimit: 2048,
      ReadonlyRootfs: true,
      Tmpfs: { "/var/lib/docker": "rw,exec,nosuid,nodev,size=3221225472,mode=0711,uid=0,gid=0" },
    });
    expect(dockerHostConfig("disabled", {})).not.toHaveProperty("Privileged");
    expect(dockerHostConfig("rootless", {})).not.toHaveProperty("ExtraHosts");
    expect(dockerHostConfig("disabled", {})).toMatchObject({
      ExtraHosts: ["host.docker.internal:host-gateway"],
    });
    expect(new DockerSandbox({ privileged: "rootless" }).otlpHost).toBeNull();
  });

  it("socket access把规范Unix socket挂到固定目标并按数值GID授权", async () => {
    const dir = await makeLocalDir();
    const socket = join(dir, "daemon.sock");
    const alias = join(dir, "docker.sock");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });
    try {
      await symlink(socket, alias);
      const mount = await resolveDockerSocketMount(alias);
      expect(mount.source).toBe(socket);
      expect(dockerHostConfig("disabled", {}, [], mount)).toMatchObject({
        Mounts: [{ Type: "bind", Source: socket, Target: "/var/run/docker.sock" }],
        GroupAdd: [String(mount.gid)],
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("socket access拒绝最终目标不是Unix socket", async () => {
    const dir = await makeLocalDir();
    await expect(resolveDockerSocketMount(dir)).rejects.toThrow(/not a Unix socket/);
  });

  it("raw privileged只设置Privileged且不伪造managed DNS", () => {
    expect(dockerHostConfig("raw", {})).toMatchObject({ Privileged: true });
    expect(dockerHostConfig("raw", {})).not.toHaveProperty("Dns");
    expect(dockerHostConfig("raw", {})).not.toHaveProperty("ExtraHosts");
  });

  it("为每个 managed privileged Attempt 声明独占且禁止 sibling 互通的 bridge", () => {
    expect(dockerManagedNetworkOptions("provision-1", "attempt-1")).toEqual({
      Name: "niceeval-attempt-attempt-1",
      CheckDuplicate: false,
      Driver: "bridge",
      Internal: false,
      Attachable: false,
      Options: { "com.docker.network.bridge.enable_icc": "false" },
      Labels: {
        "niceeval.managed-network": "true",
        "niceeval.provision-token": "provision-1",
      },
    });
  });
});

describe("DockerSandbox.stop cleanup ownership", () => {
  function withCleanupContainer(
    sandbox: DockerSandbox,
    container: { stop: () => Promise<void>; remove: () => Promise<void> },
  ): void {
    (sandbox as unknown as { container: typeof container }).container = container;
    (sandbox as unknown as { _containerId: string })._containerId = "abcdef1234567890";
  }

  it("只忽略 stopped/not-found，并完成幂等释放", async () => {
    const sandbox = new DockerSandbox();
    withCleanupContainer(sandbox, {
      stop: async () => Promise.reject(Object.assign(new Error("already stopped"), { statusCode: 304 })),
      remove: async () => Promise.reject(Object.assign(new Error("gone"), { statusCode: 404 })),
    });

    await expect(sandbox.stop()).resolves.toBeUndefined();
    await expect(sandbox.stop()).resolves.toBeUndefined();
  });

  it("remove 失败时上报并保留句柄，供 registry 后续重试", async () => {
    const sandbox = new DockerSandbox();
    let removeCalls = 0;
    withCleanupContainer(sandbox, {
      stop: async () => {},
      remove: async () => {
        removeCalls += 1;
        if (removeCalls === 1) throw Object.assign(new Error("daemon unavailable"), { statusCode: 500 });
      },
    });

    await expect(sandbox.stop()).rejects.toThrow(/failed to destroy Docker sandbox abcdef123456/);
    await expect(sandbox.stop()).resolves.toBeUndefined();
    expect(removeCalls).toBe(2);
  });

  it("stop 异常即使 force remove 成功也如实上报，但第二次调用可完成登记解除", async () => {
    const sandbox = new DockerSandbox();
    withCleanupContainer(sandbox, {
      stop: async () => Promise.reject(Object.assign(new Error("stop transport failed"), { statusCode: 500 })),
      remove: async () => {},
    });

    await expect(sandbox.stop()).rejects.toThrow(/failed to destroy Docker sandbox abcdef123456/);
    await expect(sandbox.stop()).resolves.toBeUndefined();
  });
});

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

async function makeLocalDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-docker-download-"));
  roots.push(dir);
  return dir;
}

/** 构造一份 Docker getArchive 会返回的形状:目录归档,entry 名以请求路径 basename 为首段。 */
async function buildDirectoryArchive(): Promise<Buffer> {
  const pack = tar.pack();
  pack.entry({ name: "out/", type: "directory" }, () => {});
  pack.entry({ name: "out/a.txt" }, "hello");
  pack.entry({ name: "out/nested/", type: "directory" }, () => {});
  pack.entry({ name: "out/nested/b.bin" }, Buffer.from([0, 1, 2, 255]));
  pack.entry({ name: "out/node_modules/", type: "directory" }, () => {});
  pack.entry({ name: "out/node_modules/x.txt" }, "should be pruned");
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** 给 DockerSandbox 实例注入一个 fake container——绕开真实 dockerode 连接,只验证我们自己的下载逻辑。 */
function withFakeContainer(sandbox: DockerSandbox, getArchive: (opts: { path: string }) => Promise<NodeJS.ReadableStream>) {
  (sandbox as unknown as { container: { getArchive: typeof getArchive } }).container = { getArchive };
}

describe("DockerSandbox.downloadDirectory", () => {
  it("strips the archive's leading directory segment, honors ignore, and writes exact bytes", async () => {
    const localDir = await makeLocalDir();
    const sandbox = new DockerSandbox();
    const archive = await buildDirectoryArchive();
    let requestedPath: string | undefined;
    withFakeContainer(sandbox, async (opts) => {
      requestedPath = opts.path;
      return Readable.from(archive);
    });

    await sandbox.downloadDirectory("out", localDir, { ignore: ["node_modules"] });

    expect(requestedPath).toBe(`${sandbox.workdir}/out`);
    expect((await readFile(join(localDir, "a.txt"))).toString()).toBe("hello");
    expect(await readFile(join(localDir, "nested/b.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(existsSync(join(localDir, "node_modules"))).toBe(false);
    // 归档里的顶层目录条目("out/")本身不应该在本地磁盘上冒出同名文件或空目录。
    expect(existsSync(join(localDir, "out"))).toBe(false);
  });

  it("throws instead of silently no-op-ing when the container has not been initialized", async () => {
    const sandbox = new DockerSandbox();
    await expect(sandbox.downloadDirectory("out", await makeLocalDir())).rejects.toThrow();
  });
});

describe("DockerSandbox runner tools", () => {
  it("probes git and can bootstrap it for attached Compose task images", async () => {
    const sandbox = new DockerSandbox();
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    (sandbox as unknown as {
      runCommandAsRoot(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    }).runCommandAsRoot = async (command, args) => {
      calls.push({ command, args });
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await sandbox.ensureRunnerTools();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("sh");
    expect(calls[0]?.args.join("\n")).toContain("command -v git");
    expect(calls[0]?.args.join("\n")).toContain("apt-get install");
    expect(calls[0]?.args.join("\n")).toContain("apk add");
  });

  it("surfaces the installer diagnostic instead of failing later in workspace.baseline", async () => {
    const sandbox = new DockerSandbox();
    (sandbox as unknown as {
      runCommandAsRoot(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    }).runCommandAsRoot = async () => ({
      stdout: "",
      stderr: "no supported package manager",
      exitCode: 127,
    });

    await expect(sandbox.ensureRunnerTools()).rejects.toThrow(
      /prepare Docker runner tools failed.*no supported package manager/,
    );
  });
});

/** 给 DockerSandbox 注入一个 fake container.exec:即时结束、退出码 0,只用于捕获
 *  传给 `docker exec` 的 `Env`——不连真实 daemon。 */
function withFakeExec(sandbox: DockerSandbox): { calls: Array<{ Env?: string[] }> } {
  const calls: Array<{ Env?: string[] }> = [];
  (sandbox as unknown as {
    container: { exec: (opts: { Env?: string[] }) => Promise<{
      start: () => Promise<NodeJS.ReadableStream>;
      inspect: () => Promise<{ ExitCode: number }>;
    }> };
  }).container = {
    exec: async (opts) => {
      calls.push(opts);
      return {
        start: async () => {
          const stream = new PassThrough();
          queueMicrotask(() => stream.end());
          return stream;
        },
        inspect: async () => ({ ExitCode: 0 }),
      };
    },
  };
  return { calls };
}

/** 从 `docker exec` 的 `Env`(`"KEY=value"` 数组)里取出 `PATH` 的值。 */
function pathOf(env: string[] | undefined): string | undefined {
  return env?.find((entry) => entry.startsWith("PATH="))?.slice("PATH=".length);
}

describe("DockerSandbox managed PATH", () => {
  it("keeps the existing managed PATH byte-for-byte when pathPrepend is omitted", async () => {
    const sandbox = new DockerSandbox();
    const { calls } = withFakeExec(sandbox);

    await sandbox.runCommand("true");

    expect(pathOf(calls[0]?.Env)).toBe(
      "/root/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
  });

  it("prepends pathPrepend directories, in declared order, ahead of the provider defaults", async () => {
    const sandbox = new DockerSandbox({ pathPrepend: ["/opt/tools/bin", "/opt/more/bin"] });
    const { calls } = withFakeExec(sandbox);

    await sandbox.runCommand("true");

    expect(pathOf(calls[0]?.Env)).toBe(
      "/opt/tools/bin:/opt/more/bin:/root/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
  });

  it("stays Sandbox-managed: opts.env.PATH cannot override the pathPrepend-derived PATH", async () => {
    const sandbox = new DockerSandbox({ pathPrepend: ["/opt/tools/bin"] });
    const { calls } = withFakeExec(sandbox);

    await sandbox.runCommand("true", [], { env: { PATH: "/should/not/win" } });

    expect(pathOf(calls[0]?.Env)).toBe(
      "/opt/tools/bin:/root/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
  });
});

/** `expiresAtMs` 是 initialize() 把 TTL 烧进 PID1 那一刻定死的私有字段;测试直接注入,
 *  不必起真实容器。 */
function withExpiry(sandbox: DockerSandbox, expiresAtMs: number): DockerSandbox {
  (sandbox as unknown as { expiresAtMs?: number }).expiresAtMs = expiresAtMs;
  return sandbox;
}

describe("DockerSandbox.ensureLifetime", () => {
  it("refuses to confirm a lifetime nobody declared", async () => {
    const sandbox = withExpiry(new DockerSandbox(), Date.now() + 4 * 60 * 60_000);

    const result = await sandbox.ensureLifetime(60_000);

    // 容器 TTL 有兜底值(timeout×2 或 20 分钟地板),但那是给用完即弃的实例保命用的,
    // 不是作者声明的复用寿命——不能拿它冒充一次声明。
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toContain("lifetimeMs");
  });

  it("refuses before the container has started, when no TTL has been burned in yet", async () => {
    const sandbox = new DockerSandbox({ lifetimeMs: 4 * 60 * 60_000 });

    const result = await sandbox.ensureLifetime(60_000);

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toContain("not started");
  });

  it("confirms while the burned-in TTL still covers the next attempt", async () => {
    const sandbox = withExpiry(new DockerSandbox({ lifetimeMs: 4 * 60 * 60_000 }), Date.now() + 60 * 60_000);

    const result = await sandbox.ensureLifetime(20 * 60_000);

    expect(result.ready).toBe(true);
  });

  it("says the TTL cannot be extended instead of pretending it can", async () => {
    // TTL 写死在 PID1 的 `timeout` 里,没有续期通道:剩 5 分钟就是只剩 5 分钟,
    // 由 runner 轮换实例,而不是让容器在 attempt 中途消失。
    const sandbox = withExpiry(new DockerSandbox({ lifetimeMs: 4 * 60 * 60_000 }), Date.now() + 5 * 60_000);

    const result = await sandbox.ensureLifetime(20 * 60_000);

    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reason).toContain("cannot be extended");
      expect(result.reason).toContain("1200s");
    }
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用」——能力归属。
// 容器的 dead-man TTL 烧在 PID1 的 `timeout` 里:到期真的会被杀,但没有续期通道。
// 所以这条能力只确认、不续期,剩余不够就如实说不够,由 runner 轮换实例。
describe("DockerSandbox.ensureLifetime", () => {
  /** initialize() 才会算 expiresAtMs(要起真实容器);这里直接注入那一刻的结果。 */
  function makeStarted(lifetimeMs: number | undefined, remainingMs: number): DockerSandbox {
    const sandbox = new DockerSandbox(lifetimeMs === undefined ? {} : { lifetimeMs });
    (sandbox as unknown as { expiresAtMs?: number }).expiresAtMs = Date.now() + remainingMs;
    return sandbox;
  }

  it("容器 TTL 剩得够时确认,并给出真实到期时刻", async () => {
    const result = await makeStarted(4 * 3_600_000, 3_600_000).ensureLifetime(600_000);

    expect(result.ready).toBe(true);
    expect(result.ready === true ? result.expiresAt : undefined).toBeDefined();
  });

  it("容器 TTL 剩得不够时如实报 ready:false(TTL 没有续期通道)", async () => {
    const result = await makeStarted(4 * 3_600_000, 60_000).ensureLifetime(600_000);

    expect(result.ready).toBe(false);
    expect(result.ready === false ? result.reason : "").toContain("cannot be extended");
  });

  it("没有声明 lifetimeMs 时不假装能复用", async () => {
    const result = await makeStarted(undefined, 3_600_000).ensureLifetime(1_000);

    expect(result.ready).toBe(false);
    expect(result.ready === false ? result.reason : "").toContain("lifetimeMs");
  });

  it("容器还没起来时不猜寿命", async () => {
    const result = await new DockerSandbox({ lifetimeMs: 3_600_000 }).ensureLifetime(1_000);

    expect(result.ready).toBe(false);
    expect(result.ready === false ? result.reason : "").toContain("not started");
  });
});
