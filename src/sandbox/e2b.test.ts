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
import { SandboxCommandTimeoutError } from "./deadline.ts";

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
  const Ctor = E2BSandbox as unknown as new (
    sbx: unknown,
    id: string,
    timeoutMs: number,
    lifetime: { readonly _tag: "ProviderDefault" },
  ) => E2BSandbox;
  return new Ctor(sbx, "test-sandbox", 5_000, { _tag: "ProviderDefault" });
}

interface FakeE2BRunOptions {
  readonly background?: boolean;
  readonly onStdout?: (chunk: string) => void | Promise<void>;
  readonly onStderr?: (chunk: string) => void | Promise<void>;
}

function completionMarkerParts(script: string): { prefix: string; suffix: string } {
  const markers = [...script.matchAll(/'(__niceeval_e2b_command_[0-9a-f]+_(?:exit_|end__))'/g)]
    .map((match) => match[1]!)
    .filter((marker, index, all) => all.indexOf(marker) === index);
  if (markers.length !== 2) throw new Error(`expected two e2b completion marker parts, received ${markers.length}`);
  return { prefix: markers[0]!, suffix: markers[1]! };
}

async function completedCommandHandle(
  script: string,
  opts: FakeE2BRunOptions,
  result: { stdout: string; stderr: string; exitCode: number },
): Promise<{ wait: () => Promise<never>; disconnect: () => Promise<void> }> {
  expect(opts.background).toBe(true);
  const { prefix, suffix } = completionMarkerParts(script);
  const marker = `${prefix}${result.exitCode}${suffix}`;
  await opts.onStdout?.(`${result.stdout}${marker}`);
  await opts.onStderr?.(`${result.stderr}${marker}`);
  return {
    wait: () => new Promise<never>(() => {}),
    disconnect: async () => {},
  };
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
        run: async (script: string, opts: FakeE2BRunOptions & { cwd: string }) => {
          capturedScript = script;
          capturedCwd = opts.cwd;
          // 不重新实现 find 语义:直接回放已知的(已被剪枝过的)相对路径清单。
          return completedCommandHandle(
            script,
            opts,
            { stdout: [...files.keys()].map((p) => `./${p}`).join("\n"), stderr: "", exitCode: 0 },
          );
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
        run: async (script: string, opts: FakeE2BRunOptions & { cwd: string }) => {
          capturedCwd = opts.cwd;
          return completedCommandHandle(script, opts, { stdout: "", stderr: "", exitCode: 0 });
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
  /** 构造函数第四个参数是 runtime 已写进 provider 的寿命请求。 */
  function makeReusable(sbx: unknown, lifetimeMs?: number): E2BSandbox {
    const Ctor = E2BSandbox as unknown as new (
      sbx: unknown,
      id: string,
      timeoutMs: number,
      lifetime: { readonly _tag: "ProviderDefault" } | {
        readonly _tag: "Requested";
        readonly milliseconds: number;
        readonly source: "explicit" | "attempt-deadline";
      },
    ) => E2BSandbox;
    return new Ctor(
      sbx,
      "test-sandbox",
      5_000,
      lifetimeMs === undefined
        ? { _tag: "ProviderDefault" }
        : { _tag: "Requested", milliseconds: lifetimeMs, source: "explicit" },
    );
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

  it("没有可请求寿命的无限 attempt 不假装能复用,也不去碰远端", async () => {
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
    // bounded attempt 未声明时 runtime 会传入 deadline 派生值；这里是没有 deadline 可派生的
    // ProviderDefault，远端还剩一小时也不能伪装成可确认的复用寿命。
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

// bug: memory/e2b-command-stream-waits-for-detached-service.md
describe("E2BSandbox command completion", () => {
  it("直接 shell 退出即返回完整前台输出与退出码，只断 transport、不杀仍持有输出管道的任务服务", async () => {
    let wrappedScript = "";
    let runOptions: FakeE2BRunOptions | undefined;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let disconnects = 0;
    let sandboxKills = 0;
    let serviceAlive = true;
    const sandbox = makeSandbox({
      commands: {
        run: async (script: string, opts: FakeE2BRunOptions) => {
          wrappedScript = script;
          runOptions = opts;
          notifyStarted();
          return {
            // 模拟 E2B 的真实症状：后台服务继承 stdout/stderr，SDK wait 永远等不到 EOF。
            wait: () => new Promise<never>(() => {}),
            disconnect: async () => {
              disconnects += 1;
            },
          };
        },
      },
      kill: async () => {
        sandboxKills += 1;
        serviceAlive = false;
      },
    });
    const streamedStdout: string[] = [];
    const streamedStderr: string[] = [];
    const source = "printf front; printf warn >&2; nohup task-server &; exit 23";

    const running = sandbox.runShell(source, {
      onStdout: (chunk) => {
        streamedStdout.push(chunk);
      },
      onStderr: (chunk) => {
        streamedStderr.push(chunk);
      },
    });
    await started;

    expect(runOptions?.background).toBe(true);
    expect(wrappedScript).toContain(source);
    const { prefix, suffix } = completionMarkerParts(wrappedScript);
    const marker = `${prefix}23${suffix}`;
    // 两路 marker 都故意跨 chunk；正文尾巴也和 marker prefix 同 chunk，证明过滤不会吞前台输出。
    await runOptions?.onStdout?.(`front${marker.slice(0, 9)}`);
    await runOptions?.onStdout?.(marker.slice(9));
    await runOptions?.onStderr?.(`warn${marker.slice(0, 17)}`);
    await runOptions?.onStderr?.(marker.slice(17));

    await expect(running).resolves.toEqual({ stdout: "front", stderr: "warn", exitCode: 23 });
    expect(streamedStdout).toEqual(["front"]);
    expect(streamedStderr).toEqual(["warn"]);
    expect(disconnects).toBe(1);
    expect(sandboxKills).toBe(0);
    expect(serviceAlive).toBe(true);
  });
});

describe("E2BSandbox command interruption", () => {
  it("signal 取消时退休整台 VM，再以原始取消原因 reject", async () => {
    const reason = new DOMException("cancelled by test", "AbortError");
    const controller = new AbortController();
    let sandboxKills = 0;
    let commandKills = 0;
    const sandbox = makeSandbox({
      commands: {
        run: async (_script: string, opts: { background?: boolean }) => {
          expect(opts.background).toBe(true);
          return {
            wait: () => new Promise(() => {}),
            kill: async () => {
              commandKills += 1;
              return true;
            },
          };
        },
      },
      kill: async () => {
        sandboxKills += 1;
        return true;
      },
    });

    const running = sandbox.runShell("sh -c 'sleep 60 &'", { signal: controller.signal });
    controller.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(sandboxKills).toBe(1);
    expect(commandKills).toBe(0);
  });

  it("SDK command timeout 时退休整台 VM，再抛带归属的 timeout error", async () => {
    let sandboxKills = 0;
    const sandbox = makeSandbox({
      commands: {
        run: async () => {
          throw Object.assign(new Error("command timed out"), { name: "TimeoutError" });
        },
      },
      kill: async () => {
        sandboxKills += 1;
        return true;
      },
    });

    const failure = sandbox.runShell("sleep 60", { timeoutMs: 25 });
    await expect(failure).rejects.toBeInstanceOf(SandboxCommandTimeoutError);
    expect(sandboxKills).toBe(1);
  });
});
