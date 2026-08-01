// cases: docs/engineering/testing/unit/sandbox.md
// E2BSandbox.downloadDirectory 走 vercel/e2b 共用的 find+read 两阶段模板(见
// download-directory.test.ts;这里只证明 e2b provider 自己的接线——不重新验证模板本身的
// ignore/剥离/写盘逻辑)。fake `sbx.commands.run` / `sbx.files.read`,不连真实 e2b API——
// 真实 E2B 沙箱行为归 E2E(../../docs/engineering/testing/e2e/README.md)。
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2BSandbox } from "./e2b.ts";

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

async function makeLocalDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-e2b-download-"));
  roots.push(dir);
  return dir;
}

/** e2b 的构造函数是 TS `private`(编译期限定,运行时只是普通函数);测试绕开它直接注入 fake sbx,
 *  不必走 `E2BSandbox.create()`(需要真实 API key、起真实 microVM)。 */
function makeSandbox(sbx: unknown): E2BSandbox {
  const Ctor = E2BSandbox as unknown as new (sbx: unknown, id: string, timeoutMs: number) => E2BSandbox;
  return new Ctor(sbx, "test-sandbox", 5_000);
}

describe("E2BSandbox.downloadDirectory", () => {
  it("lists under the resolved remote dir, threads ignore into the find script, and writes exact bytes", async () => {
    const localDir = await makeLocalDir();
    const files = new Map<string, Buffer>([
      ["a.txt", Buffer.from("hello")],
      ["nested/b.bin", Buffer.from([0, 1, 2, 255])],
    ]);
    let capturedScript = "";
    let capturedCwd = "";
    const sandbox = makeSandbox({
      commands: {
        run: async (script: string, opts: { cwd: string }) => {
          capturedScript = script;
          capturedCwd = opts.cwd;
          // 不重新实现 find 语义:直接回放已知的(已被剪枝过的)相对路径清单。
          return { stdout: [...files.keys()].map((p) => `./${p}`).join("\n"), stderr: "", exitCode: 0 };
        },
      },
      files: {
        read: async (path: string, opts: { format: string }) => {
          const rel = path.slice(capturedCwd.length + 1);
          const content = files.get(rel);
          if (!content) throw new Error(`unexpected read: ${path}`);
          return opts.format === "bytes" ? new Uint8Array(content) : content.toString("utf8");
        },
      },
    });

    await sandbox.downloadDirectory("out", localDir, { ignore: ["node_modules"] });

    expect(capturedCwd).toBe(`${sandbox.workdir}/out`);
    expect(capturedScript).toContain("node_modules");
    expect((await readFile(join(localDir, "a.txt"))).toString()).toBe("hello");
    expect(await readFile(join(localDir, "nested/b.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it("resolves a relative source directory from workdir", async () => {
    let capturedCwd = "";
    const sandbox = makeSandbox({
      commands: {
        run: async (_script: string, opts: { cwd: string }) => {
          capturedCwd = opts.cwd;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
      files: { read: async () => new Uint8Array() },
    });

    await sandbox.downloadDirectory(".", await makeLocalDir());

    expect(capturedCwd).toBe(sandbox.workdir);
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用」——能力归属。
// `ready: true` 的唯一合法依据是远端真实到期时刻:两次都读 `getInfo().endAt`,不复读我们
// 请求给 `setTimeout` 的值——e2b 的账号档位会把请求值压短(见 e2b.ts 的 ensureLifetime 注释)。
describe("E2BSandbox.ensureLifetime", () => {
  /** 带寿命声明的实例:构造函数第四个参数就是作者声明的 lifetimeMs。 */
  function makeReusable(sbx: unknown, lifetimeMs?: number): E2BSandbox {
    const Ctor = E2BSandbox as unknown as new (
      sbx: unknown,
      id: string,
      timeoutMs: number,
      lifetimeMs?: number,
    ) => E2BSandbox;
    return new Ctor(sbx, "test-sandbox", 5_000, lifetimeMs);
  }

  it("远端剩余寿命已经够时直接确认,不动 setTimeout", async () => {
    let renewals = 0;
    const sandbox = makeReusable(
      {
        getInfo: async () => ({ endAt: new Date(Date.now() + 3_600_000) }),
        setTimeout: async () => {
          renewals += 1;
        },
      },
      4 * 3_600_000,
    );

    const result = await sandbox.ensureLifetime(600_000);

    expect(result.ready).toBe(true);
    expect(renewals).toBe(0);
  });

  it("剩余不够时按声明的 lifetimeMs 续期,并以续期后远端报的到期时刻为准", async () => {
    let endAt = Date.now() + 10_000;
    const renewals: number[] = [];
    const sandbox = makeReusable(
      {
        getInfo: async () => ({ endAt: new Date(endAt) }),
        setTimeout: async (ms: number) => {
          renewals.push(ms);
          endAt = Date.now() + ms;
        },
      },
      3_600_000,
    );

    const result = await sandbox.ensureLifetime(600_000);

    expect(result.ready).toBe(true);
    expect(renewals).toEqual([3_600_000]);
  });

  it("平台把续期压短时如实报 ready:false(不拿请求值当答案)", async () => {
    const sandbox = makeReusable(
      {
        // 请求 4 小时,平台只给 60s:续期「成功」了,但远端到期时刻才是事实。
        getInfo: async () => ({ endAt: new Date(Date.now() + 60_000) }),
        setTimeout: async () => {},
      },
      4 * 3_600_000,
    );

    const result = await sandbox.ensureLifetime(1_800_000);

    expect(result.ready).toBe(false);
    expect(result.ready === false ? result.reason : "").toContain("capped");
  });

  it("没有声明 lifetimeMs 时不假装能复用,也不去碰远端", async () => {
    let touched = 0;
    const sandbox = makeReusable({
      getInfo: async () => {
        touched += 1;
        return { endAt: new Date(Date.now() + 3_600_000) };
      },
      setTimeout: async () => {
        touched += 1;
      },
    });

    const result = await sandbox.ensureLifetime(1_000);

    expect(result.ready).toBe(false);
    expect(result.ready === false ? result.reason : "").toContain("lifetimeMs");
    // 远端还剩一小时也没用:这条能力的前提是作者声明过寿命,没声明就没有可确认的东西。
    expect(touched).toBe(0);
  });

  it("远端问不到寿命时报 ready:false,不静默当成够用", async () => {
    const sandbox = makeReusable(
      {
        getInfo: async () => {
          throw new Error("e2b api unreachable");
        },
        setTimeout: async () => {},
      },
      3_600_000,
    );

    const result = await sandbox.ensureLifetime(1_000);

    expect(result.ready).toBe(false);
    expect(result.ready === false ? result.reason : "").toContain("e2b api unreachable");
  });
});
