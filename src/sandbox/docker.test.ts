// cases: docs/engineering/testing/unit/sandbox.md
// DockerSandbox.downloadDirectory 走 getArchive 单次 tar 取回(不同于 vercel/e2b 共用的
// find+read 模板,见 download-directory.test.ts)。这里 fake 容器的 getArchive,不连真实
// daemon——真实容器行为归 E2E(../../docs/engineering/testing/e2e/README.md)。
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import * as tar from "tar-stream";
import { DockerSandbox } from "./docker.ts";

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
