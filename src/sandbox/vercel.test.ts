// cases: docs/engineering/testing/unit/sandbox.md
// VercelSandbox.downloadDirectory 走 vercel/e2b 共用的 find+read 两阶段模板(见
// download-directory.test.ts;这里只证明 vercel provider 自己的接线,不重新验证模板本身的
// ignore/剥离/写盘逻辑)。fake `vsb.runCommand` / `vsb.readFileToBuffer`,不连真实 Vercel
// API——真实 Vercel Sandbox 行为归 E2E(../../docs/engineering/testing/e2e/README.md)。
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VercelSandbox } from "./vercel.ts";

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

async function makeLocalDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-vercel-download-"));
  roots.push(dir);
  return dir;
}

/** vercel 的构造函数是 TS `private`(编译期限定,运行时只是普通函数);测试绕开它直接注入
 *  fake vsb,不必走 `VercelSandbox.create()`(需要真实凭据、起真实 microVM)。 */
function makeSandbox(vsb: unknown): VercelSandbox {
  const Ctor = VercelSandbox as unknown as new (vsb: unknown, id: string, timeoutMs: number, runtime: string) => VercelSandbox;
  return new Ctor(vsb, "test-sandbox", 5_000, "node24");
}

describe("VercelSandbox.downloadDirectory", () => {
  it("lists under the resolved remote dir, threads ignore into the find script, and writes exact bytes", async () => {
    const localDir = await makeLocalDir();
    const files = new Map<string, Buffer>([
      ["a.txt", Buffer.from("hello")],
      ["nested/b.bin", Buffer.from([0, 1, 2, 255])],
    ]);
    let capturedScript = "";
    let capturedCwd = "";
    const sandbox = makeSandbox({
      runCommand: async (opts: { cmd: string; args: string[]; cwd: string }) => {
        // runShell 经 runCommand("bash", ["-c", script], opts) 转发,script 是 args[1]。
        capturedScript = opts.args[1] ?? "";
        capturedCwd = opts.cwd;
        const stdout = [...files.keys()].map((p) => `./${p}`).join("\n");
        return { exitCode: 0, stdout: async () => stdout, stderr: async () => "" };
      },
      readFileToBuffer: async ({ path }: { path: string }) => {
        const rel = path.slice(capturedCwd.length + 1);
        return files.get(rel) ?? null;
      },
    });

    await sandbox.downloadDirectory(localDir, "out", { ignore: ["node_modules"] });

    expect(capturedCwd).toBe(`${sandbox.workdir}/out`);
    expect(capturedScript).toContain("node_modules");
    expect((await readFile(join(localDir, "a.txt"))).toString()).toBe("hello");
    expect(await readFile(join(localDir, "nested/b.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it("falls back to workdir when targetDir is omitted", async () => {
    let capturedCwd = "";
    const sandbox = makeSandbox({
      runCommand: async (opts: { cwd: string }) => {
        capturedCwd = opts.cwd;
        return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
      },
      readFileToBuffer: async () => null,
    });

    await sandbox.downloadDirectory(await makeLocalDir());

    expect(capturedCwd).toBe(sandbox.workdir);
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用」——能力归属。
// 寿命只从当前 session 的远端元数据读(createdAt + timeout),续期走 SDK 的 extendTimeout;
// plan 上限拒绝续期时如实报 ready:false,不把请求值当成已生效(见 vercel.ts 的注释)。
describe("VercelSandbox.ensureLifetime", () => {
  function sessionFake(opts: { timeout: number; createdAtOffsetMs?: number; extend?: (ms: number) => void }) {
    const session = { createdAt: new Date(Date.now() - (opts.createdAtOffsetMs ?? 0)), timeout: opts.timeout };
    return {
      currentSession: () => session,
      extendTimeout: async (ms: number) => {
        if (!opts.extend) throw new Error("Bad Request: sandbox timeout exceeds the maximum for this plan");
        opts.extend(ms);
        session.timeout += ms;
      },
    };
  }

  it("当前 session 的远端剩余时间够时直接确认,不调 extendTimeout", async () => {
    let extended = 0;
    const sandbox = makeSandbox(sessionFake({ timeout: 1_200_000, extend: () => (extended += 1) }));

    const result = await sandbox.ensureLifetime(600_000);

    expect(result.ready).toBe(true);
    expect(extended).toBe(0);
  });

  it("剩余不够时按缺口续期,续到够就确认", async () => {
    const asked: number[] = [];
    const sandbox = makeSandbox(
      sessionFake({ timeout: 600_000, createdAtOffsetMs: 540_000, extend: (ms) => asked.push(ms) }),
    );

    const result = await sandbox.ensureLifetime(120_000);

    expect(result.ready).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBeGreaterThan(0);
  });

  it("plan 拒绝续期(HTTP 400)时报 ready:false 并带上 provider 理由", async () => {
    const sandbox = makeSandbox(sessionFake({ timeout: 600_000, createdAtOffsetMs: 590_000 }));

    const result = await sandbox.ensureLifetime(1_800_000);

    expect(result.ready).toBe(false);
    expect(result.ready === false ? result.reason : "").toContain("maximum");
  });
});
