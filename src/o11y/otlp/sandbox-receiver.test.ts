// cases: docs/engineering/testing/unit/experiments-runner.md
// bug: memory/insandbox-otlp-port-wait-3s-no-retry.md
// 沙箱内 OTLP 采集器的启动韧性:这条路径外面没有任何重试兜底(命令执行不进 IO 重试、
// provision 重试只覆盖 create、runner 没有 attempt 级重试),起不来就是一条 errored attempt。
// 两层 fixture:
//   · 脚本化 fake sandbox —— 重试轮次、每轮换路径、重试前杀上一轮,确定性断言;
//   · 真实 /bin/sh 执行 —— 生成的 shell 脚本本身能跑(语法、算术、退出边),以及采集器进程
//     一起来就死时不空等满预算(观察实测耗时,不看脚本字节)。

import { mkdtemp, rm, writeFile, chmod, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Cause } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandResult, Sandbox } from "../../types.ts";
import { createInSandboxTraceReceiver } from "./sandbox-receiver.ts";

const notUsed = () => {
  throw new Error("not used by the in-sandbox receiver");
};

function baseSandbox(overrides: Partial<Sandbox>): Sandbox {
  return {
    workdir: "/work",
    sandboxId: "fake",
    otlpHost: null,
    runCommand: notUsed,
    runShell: notUsed,
    runCommandOrThrow: notUsed,
    runShellOrThrow: notUsed,
    readText: notUsed,
    writeText: async () => {},
    readBytes: notUsed,
    writeBytes: notUsed,
    pathExists: notUsed,
    uploadDirectory: notUsed,
    downloadDirectory: notUsed,
    downloadFile: notUsed,
    uploadFile: notUsed,
    stop: async () => {},
    ...overrides,
  } as Sandbox;
}

const isStart = (script: string) => script.includes("niceeval-otlp-collector") && script.includes("&");
const isKill = (script: string) => script.trimStart().startsWith("kill ");

/**
 * 启动脚本按轮次回放一条预置 stdout(`PID\n端口`,端口空表示这一轮没等到),日志读取回放
 * 固定内容,kill 一律成功。按脚本形态派发而不是按调用序号——被测实现每轮发几条命令是它自己
 * 的事,fixture 不该把这个数字焊死。
 */
function scriptedSandbox(startOutputs: string[], log = "") {
  const shells: string[] = [];
  const written: string[] = [];
  const sandbox = baseSandbox({
    writeText: async (path: string) => {
      written.push(path);
    },
    runShell: async (script: string): Promise<CommandResult> => {
      shells.push(script);
      const stdout = isStart(script) ? (startOutputs.shift() ?? "") : script.startsWith("cat ") ? log : "";
      return { stdout, stderr: "", exitCode: 0 };
    },
  });
  return { sandbox, shells, written };
}

/** 在 Sample 内取端点,并把「此刻为止发过的命令」快照出来——release 阶段的收尾 kill 不混进来。 */
async function receiverExit(sandbox: Sandbox, shells: string[] = []) {
  return Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const receiver = yield* createInSandboxTraceReceiver(sandbox);
        return { endpoint: receiver.endpoint(""), shells: [...shells] };
      }),
    ),
  );
}

describe("沙箱内 OTLP 采集器启动:脚本化 fixture", () => {
  it("第一轮拿不到端口时重试,换一套路径并先杀掉上一轮的进程", async () => {
    // 第一轮:拿到 PID 但端口行为空(采集器慢/死);第二轮:端口写回来了。
    const { sandbox, shells, written } = scriptedSandbox(["4242\n", "4243\n61000"]);

    const exit = await receiverExit(sandbox, shells);

    expect(Exit.isSuccess(exit) && exit.value.endpoint).toBe("http://127.0.0.1:61000/v1/traces");
    const sent = Exit.isSuccess(exit) ? exit.value.shells : [];
    expect(sent.filter(isStart)).toHaveLength(2);
    // 上一轮那个「慢但还活着」的采集器必须被杀掉:留着它会占内存,还会在重试之后才把端口
    // 写进它自己那份文件。
    expect(sent.filter(isKill)).toEqual([expect.stringContaining("kill 4242")]);
    // 每轮换一套带随机后缀的脚本路径:上一轮迟到的采集器写不进新一轮的端口 / spans 文件。
    expect(written).toHaveLength(2);
    expect(written[0]).not.toBe(written[1]);
  });

  it("首轮就拿到端口时只起一次,不杀任何进程", async () => {
    const { sandbox, shells } = scriptedSandbox(["4242\n61001"]);

    const exit = await receiverExit(sandbox, shells);

    expect(Exit.isSuccess(exit) && exit.value.endpoint).toBe("http://127.0.0.1:61001/v1/traces");
    const sent = Exit.isSuccess(exit) ? exit.value.shells : [];
    expect(sent.filter(isStart)).toHaveLength(1);
    expect(sent.filter(isKill)).toEqual([]);
  });

  it("重试用尽后抛错,带上预算、轮次与采集器自己的日志", async () => {
    const { sandbox, shells } = scriptedSandbox(["4242\n", "4243\n"], "node: not found");

    const exit = await receiverExit(sandbox, shells);

    expect(Exit.isFailure(exit)).toBe(true);
    const message = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
    expect(String(message)).toContain("within 20s");
    expect(String(message)).toContain("2 attempts");
    expect(String(message)).toContain("node: not found");
    expect(shells.filter(isStart)).toHaveLength(2);
  });
});

describe("沙箱内 OTLP 采集器:采集文件解码", () => {
  it("只把形状正确的 JSONL 信封归一为 TraceSpan", async () => {
    const otlp = JSON.stringify({
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId: "trace-1",
            spanId: "span-1",
            name: "model",
            startTimeUnixNano: "1000000",
            endTimeUnixNano: "2000000",
            attributes: [{ key: "gen_ai.system", value: { stringValue: "openai" } }],
          }, { name: "missing stable trace identity" }],
        }],
      }],
    });
    const raw = Buffer.from([
      JSON.stringify({ ct: 42, b: "not-a-string-content-type" }),
      JSON.stringify({ ct: "application/json", b: Buffer.from(otlp).toString("base64") }),
    ].join("\n"));
    const { sandbox } = scriptedSandbox(["4242\n61002"]);
    const readingSandbox = baseSandbox({
      writeText: sandbox.writeText.bind(sandbox),
      runShell: sandbox.runShell.bind(sandbox),
      readBytes: async () => raw,
    });

    const spans = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* createInSandboxTraceReceiver(readingSandbox);
          yield* Effect.promise(() => receiver.settle(1, 1));
          return receiver.collect();
        }),
      ),
    );

    expect(spans).toEqual([expect.objectContaining({
      traceId: "trace-1",
      spanId: "span-1",
      name: "model",
      startMs: 1,
      endMs: 2,
      attributes: { "gen_ai.system": "openai" },
    })]);
  });
});

describe("沙箱内 OTLP 采集器启动:真实 /bin/sh 执行", () => {
  const dirs: string[] = [];
  const pids: number[] = [];

  afterEach(async () => {
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid);
      } catch {
        // 已经退出
      }
    }
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
    // 本用例真的会往 /tmp 写采集器脚本 / 端口文件,跑完清掉自己那批。
    for (const name of await readdir(tmpdir())) {
      if (name.startsWith(".niceeval-otlp-")) await rm(join(tmpdir(), name), { force: true }).catch(() => {});
    }
  });

  /** runShell 真的交给 /bin/sh 跑,writeText 真的落盘——生成的脚本语法错误在这里现形。 */
  function shellSandbox(pathPrefix?: string) {
    return baseSandbox({
      writeText: (path: string, content: string) => writeFile(path, content),
      runShell: (script: string) =>
        new Promise<CommandResult>((resolve) => {
          const child = spawn("/bin/sh", ["-c", script], {
            env: { ...process.env, ...(pathPrefix ? { PATH: `${pathPrefix}:${process.env.PATH}` } : {}) },
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (c) => (stdout += c));
          child.stderr.on("data", (c) => (stderr += c));
          child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
        }),
    });
  }

  it("真实 shell 下起得来:端口写回宿主,采集器确实在监听", async () => {
    const sandbox = shellSandbox();

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* createInSandboxTraceReceiver(sandbox);
          const endpoint = receiver.endpoint("");
          const status = yield* Effect.promise(async () => {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            });
            return res.status;
          });
          return { endpoint, status };
        }),
      ),
    );

    expect(result.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/traces$/);
    expect(result.status).toBe(200);
  });

  it("采集器一起来就死时不空等满预算,错误里带着它的日志", async () => {
    const shimDir = await mkdtemp(join(tmpdir(), "niceeval-node-shim-"));
    dirs.push(shimDir);
    await writeFile(join(shimDir, "node"), '#!/bin/sh\necho "node: simulated crash" >&2\nexit 1\n');
    await chmod(join(shimDir, "node"), 0o755);

    const startedAt = Date.now();
    const exit = await receiverExit(shellSandbox(shimDir));
    const elapsed = Date.now() - startedAt;

    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Exit.isFailure(exit) ? Cause.squash(exit.cause) : "")).toContain("node: simulated crash");
    // 进程已死时循环立刻 break,两轮加起来也远小于一轮的等待预算(20s)。
    expect(elapsed).toBeLessThan(5_000);
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md
// 契约: docs/feature/sandbox/architecture.md「provider 的可写保证不止 workdir」——采集器落点是
// 系统临时目录,`/tmp` 不可写是**环境缺陷**:报错点名不可写的路径与修法,不透传 provider 的
// 原始错误串(e2b 把 EACCES 包成 500 响应,那串东西给不出任何下一步)。
describe("沙箱内 OTLP 采集器:系统临时目录不可写按环境缺陷报", () => {
  /** e2b envd 把沙箱内的 EACCES 包成 500 响应后 SDK 抛出的形状。 */
  const deniedByProvider = () =>
    Object.assign(new Error('500: {"code":500,"message":"open /tmp/x: permission denied"}'), { status: 500 });

  it("上传采集器脚本被拒:点名路径 + 说这是镜像环境缺陷 + 给修法,原始 500 串只留在 cause", async () => {
    const raw = deniedByProvider();
    const sandbox = baseSandbox({
      writeText: async () => {
        throw raw;
      },
    });

    const exit = await receiverExit(sandbox);

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit) ? (Cause.squash(exit.cause) as Error) : new Error("unreachable");
    expect(error.message).toMatch(/\/tmp\/\.niceeval-otlp-collector-[0-9a-f]{8}\.cjs/); // 哪个路径写不进去
    expect(error.message).toContain("chmod 1777 /tmp"); // 修法
    // 不透传原始串:它是「500 + 一串 JSON」,读到它的人无从下手。证据仍在 cause 上。
    expect(error.message).not.toContain("500");
    expect(error.cause).toBe(raw);
  });

  it("脚本上传得进去但采集器自己写不了端口文件(日志为空)时,探一次写权限并按环境缺陷报", async () => {
    // 采集器的写入被自己的 try/catch 吞掉:端口等不到、日志是空的,只报「等了 20s」等于让人
    // 对着空日志猜。这一格证明改成了探测写权限后点名路径与修法。
    const { sandbox, shells } = scriptedSandbox(["4242\n", "4243\n"], "");
    const denyingProbe = baseSandbox({
      writeText: sandbox.writeText.bind(sandbox),
      runShell: async (script: string): Promise<CommandResult> =>
        script.includes(".niceeval-write-probe-")
          ? { stdout: "denied\n", stderr: "", exitCode: 0 }
          : sandbox.runShell(script),
    });

    const exit = await receiverExit(denyingProbe, shells);

    expect(Exit.isFailure(exit)).toBe(true);
    const message = String(Exit.isFailure(exit) ? Cause.squash(exit.cause) : "");
    expect(message).toMatch(/\/tmp\/\.niceeval-otlp-port-[0-9a-f]{8}/);
    expect(message).toContain("chmod 1777 /tmp");
    // 环境缺陷替换掉「等不到端口」那条:两条同时报等于让人排两次错。
    expect(message).not.toContain("within 20s");
  });
});
