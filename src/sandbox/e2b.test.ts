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
  readonly cwd?: string;
  readonly onStdout?: (chunk: string) => void | Promise<void>;
  readonly onStderr?: (chunk: string) => void | Promise<void>;
}

interface ScriptedCommandScenario {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly chunkSize?: number;
  readonly beforeStdoutFrame?: (markers: { readonly prefix: string; readonly suffix: string }) => string;
  readonly onDisconnect?: () => void | Promise<void>;
}

/**
 * 只模拟 E2B transport：从 wrapper 的 `printf %b` 单引号 `\\xHH` 字面量恢复 completion
 * marker，再把约定的两路正文和 marker 分块交给生产 parser。不会执行测试脚本。
 */
function scriptedCommandHandle(
  script: string,
  opts: FakeE2BRunOptions,
  scenario: ScriptedCommandScenario,
): { wait: () => Promise<{ stdout: string; stderr: string; exitCode: number }>; disconnect: () => Promise<void> } {
  expect(opts.background).toBe(true);
  const encodedMarkers = [...script.matchAll(
    /__niceeval_e2b_command_(?:prefix|suffix)=\$\(printf '%b' '((?:\\x[0-9a-fA-F]{2})*)'\)/g,
  )].map((match) => match[1]);
  expect(encodedMarkers).toHaveLength(2);
  const decode = (encoded: string): string => Buffer.from(
    [...encoded.matchAll(/\\x([0-9a-fA-F]{2})/g)].map((match) => Number.parseInt(match[1], 16)),
  ).toString("utf8");
  const [prefix, suffix] = encodedMarkers.map(decode);
  const chunkSize = scenario.chunkSize ?? 7;
  const deliver = async (
    callback: ((chunk: string) => void | Promise<void>) | undefined,
    text: string,
  ): Promise<void> => {
    for (let offset = 0; offset < text.length; offset += chunkSize) {
      await callback?.(text.slice(offset, offset + chunkSize));
    }
  };
  const wait = (async () => {
    await deliver(
      opts.onStdout,
      `${scenario.stdout}${scenario.beforeStdoutFrame?.({ prefix, suffix }) ?? ""}${prefix}${scenario.exitCode}${suffix}`,
    );
    await deliver(opts.onStderr, `${scenario.stderr}${prefix}${scenario.exitCode}${suffix}`);
    return scenario;
  })();
  return {
    wait: async () => {
      const { stdout, stderr, exitCode } = await wait;
      return { stdout, stderr, exitCode };
    },
    disconnect: async () => {
      await scenario.onDisconnect?.();
    },
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
          return scriptedCommandHandle(script, opts, {
            stdout: "./a.txt\n./nested/b.bin\n",
            stderr: "",
            exitCode: 0,
            chunkSize: 3,
          });
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
          return scriptedCommandHandle(script, opts, { stdout: "", stderr: "", exitCode: 0, chunkSize: 3 });
        },
      },
      files: { read: async () => new Uint8Array() },
    });

    await sandbox.downloadDirectory(".", await makeLocalDir());

    expect(capturedCwd).toBe(sandbox.workdir);
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「命令执行」——执行身份默认沿用环境声明。
// e2b commands.run 直接透传同名 user 参数;省略时不注入(沿用 template 默认用户),factory `user`
// 覆盖后的身份是 Sandbox 默认值,单条命令的 opts.user 再覆盖它(见 docs/feature/sandbox/library.md
// 「执行身份」)。这里只证明 `commandOptions.user` 的解析,不需要真实 bash 完成协议。
describe("E2BSandbox.runShell · 执行身份", () => {
  function makeSandboxWithUser(sbx: unknown, userOverride?: string): E2BSandbox {
    const Ctor = E2BSandbox as unknown as new (
      sbx: unknown,
      id: string,
      timeoutMs: number,
      lifetime: { readonly _tag: "ProviderDefault" },
      userOverride: string | undefined,
    ) => E2BSandbox;
    return new Ctor(sbx, "test-sandbox", 5_000, { _tag: "ProviderDefault" }, userOverride);
  }

  function capturingSandbox(userOverride: string | undefined, capture: (user: string | undefined) => void): E2BSandbox {
    return makeSandboxWithUser({
      commands: {
        run: async (_script: string, opts: FakeE2BRunOptions & { user?: string }) => {
          capture(opts.user);
          return { wait: () => new Promise<never>(() => {}), disconnect: async () => {} };
        },
      },
    }, userOverride);
  }

  it("省略 factory user 与命令级 user 时不注入 user(沿用 template 默认身份)", async () => {
    let captured: string | undefined = "not-called";
    const sandbox = capturingSandbox(undefined, (user) => {
      captured = user;
    });

    void sandbox.runShell("id");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(captured).toBeUndefined();
  });

  it("factory user 覆盖后,省略命令级 user 时沿用它", async () => {
    let captured: string | undefined;
    const sandbox = capturingSandbox("agent", (user) => {
      captured = user;
    });

    void sandbox.runShell("id");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(captured).toBe("agent");
  });

  it("命令级 user 覆盖 factory 默认身份,只这一条命令换身份", async () => {
    let captured: string | undefined;
    const sandbox = capturingSandbox("agent", (user) => {
      captured = user;
    });

    void sandbox.runShell("apt-get update", { user: "root" });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(captured).toBe("root");
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

// bug: memory/e2b-command-completion-marker-source-echo.md
// bug: memory/e2b-command-stream-waits-for-detached-service.md
describe("E2BSandbox command completion", () => {
  it.each([
    {
      name: "exit 0",
      source: "printf 'stdout body\\n'; printf 'stderr body\\n' >&2",
      exitCode: 0,
      stdout: "stdout body\n",
      stderr: "stderr body\n",
    },
    {
      name: "nonzero exit",
      source: "printf 'nonzero stdout\\n'; printf 'nonzero stderr\\n' >&2; exit 23",
      exitCode: 23,
      stdout: "nonzero stdout\n",
      stderr: "nonzero stderr\n",
    },
  ])("scripted completion preserves $name output and exit code", async ({ source, exitCode, stdout, stderr }) => {
    let disconnects = 0;
    let sandboxKills = 0;
    const sandbox = makeSandbox({
      commands: {
        run: async (script: string, opts: FakeE2BRunOptions) => {
          return scriptedCommandHandle(script, opts, {
            stdout,
            stderr,
            exitCode,
            chunkSize: 3,
            onDisconnect: () => {
              disconnects += 1;
            },
          });
        },
      },
      kill: async () => {
        sandboxKills += 1;
        return true;
      },
    });
    const streamedStdout: string[] = [];
    const streamedStderr: string[] = [];

    const running = sandbox.runShell(source, {
      onStdout: (chunk) => {
        streamedStdout.push(chunk);
      },
      onStderr: (chunk) => {
        streamedStderr.push(chunk);
      },
    });
    const result = await running;
    expect(result.exitCode).toBe(exitCode);
    expect(result.stdout).toContain(stdout.trim());
    expect(result.stderr).toContain(stderr.trim());
    expect(streamedStdout.join("")).toContain(stdout.trim());
    expect(streamedStderr.join("")).toContain(stderr.trim());
    expect(disconnects).toBe(1);
    expect(sandboxKills).toBe(0);
  });

  it("长命令/heredoc 原样交给 completion wrapper，不截断完成帧", async () => {
    const body = [
      "# generated by codex",
      "const answer = 42;",
      "x".repeat(8_192),
      "EOF-looking content is still ordinary heredoc text",
    ].join("\n");
    const source = [
      "cat > codex-output.txt <<'CODEX_EOF'",
      body,
      "CODEX_EOF",
      "printf 'codex stdout\\n'; printf 'codex stderr\\n' >&2; exit 7",
    ].join("\n");
    let disconnects = 0;
    let sandboxKills = 0;
    const sandbox = makeSandbox({
      commands: {
        run: async (script: string, opts: FakeE2BRunOptions) => {
          expect(script).toContain(body);
          return scriptedCommandHandle(script, opts, {
            stdout: "codex stdout\n",
            stderr: "codex stderr\n",
            exitCode: 7,
            chunkSize: 1,
            onDisconnect: () => {
              disconnects += 1;
            },
          });
        },
      },
      kill: async () => {
        sandboxKills += 1;
        return true;
      },
    });

    const result = await sandbox.runShell(source);
    expect(result).toMatchObject({
      stdout: "codex stdout\n",
      stderr: "codex stderr\n",
      exitCode: 7,
    });
    expect(disconnects).toBe(1);
    expect(sandboxKills).toBe(0);
  });

  it("stdout 的伪 completion frame 保留为正文，继续扫描后面的真实 frame", async () => {
    let fakeFrame = "";
    const sandbox = makeSandbox({
      commands: {
        run: async (script: string, opts: FakeE2BRunOptions) => scriptedCommandHandle(script, opts, {
          stdout: "before fake frame\n",
          stderr: "ordinary stderr\n",
          exitCode: 0,
          chunkSize: 2,
          beforeStdoutFrame: ({ prefix, suffix }) => {
            fakeFrame = `${prefix}not-an-exit${suffix}`;
            return fakeFrame;
          },
        }),
      },
      kill: async () => true,
    });

    const result = await sandbox.runShell("echo ignored");

    expect(result).toEqual({
      stdout: `before fake frame\n${fakeFrame}`,
      stderr: "ordinary stderr\n",
      exitCode: 0,
    });
  });

  it("abort 时等待唯一一次 VM kill 后才以取消原因 settle", async () => {
    const reason = new DOMException("cancelled during command delivery", "AbortError");
    const controller = new AbortController();
    let notifyRaceReady!: () => void;
    const raceReady = new Promise<void>((resolve) => {
      notifyRaceReady = resolve;
    });
    let releaseKill!: () => void;
    const killFinished = new Promise<void>((resolve) => {
      releaseKill = resolve;
    });
    const killFailure = new Error("e2b kill transport failed");
    let sandboxKills = 0;
    let disconnects = 0;
    const sandbox = makeSandbox({
      commands: {
        run: async () => {
          return {
            wait: () => {
              // runShell has installed its abort listener before it asks for the stream outcome.
              notifyRaceReady();
              return new Promise<never>(() => {});
            },
            disconnect: async () => {
              disconnects += 1;
            },
          };
        },
      },
      kill: async () => {
        sandboxKills += 1;
        if (sandboxKills === 1) {
          await killFinished;
          throw killFailure;
        }
        return true;
      },
    });

    const running = sandbox.runShell("exit 0", { signal: controller.signal });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await raceReady;
    controller.abort(reason);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(sandboxKills).toBe(1);
    expect(disconnects).toBe(0);
    releaseKill();
    await expect(running).rejects.toBe(reason);
    expect(settled).toBe(true);
    expect(sandboxKills).toBe(1);
    expect(disconnects).toBe(0);
    await expect(sandbox.stop()).resolves.toBeUndefined();
    expect(sandboxKills).toBe(2);
  });

  it("stream 与 callback 完整性异常都会先退休 VM", async () => {
    for (const kind of ["stream", "callback"] as const) {
      const failure = new Error(`${kind} failed`);
      let sandboxKills = 0;
      const sandbox = makeSandbox({
        commands: {
          run: async (_script: string, opts: FakeE2BRunOptions) => {
            if (kind === "callback") await opts.onStdout?.("front".repeat(100));
            return {
              wait: kind === "stream"
                ? async () => {
                    throw failure;
                  }
                : () => new Promise<never>(() => {}),
              disconnect: async () => {},
            };
          },
        },
        kill: async () => {
          sandboxKills += 1;
          return true;
        },
      });

      const running = sandbox.runShell("exit 0", kind === "callback"
        ? {
            onStdout: () => {
              throw failure;
            },
          }
        : {});
      await expect(running).rejects.toBe(failure);
      expect(sandboxKills).toBe(1);
    }
  });
});

describe("E2BSandbox command interruption", () => {
  it("commands.run 尚未返回 handle 时，signal 取消仍在 kill settle 后及时返回", async () => {
    const reason = new DOMException("cancelled during command start", "AbortError");
    const controller = new AbortController();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let sandboxKills = 0;
    const sandbox = makeSandbox({
      commands: {
        run: () => {
          notifyStarted();
          return new Promise<never>(() => {});
        },
      },
      kill: async () => {
        sandboxKills += 1;
        return true;
      },
    });

    const running = sandbox.runShell("sleep 60", { signal: controller.signal });
    await started;
    controller.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(sandboxKills).toBe(1);
  });

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
