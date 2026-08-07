import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  DIAGNOSTIC_LIMIT,
  ProcessStartError,
  command,
  runProcess,
} from "../src/process.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/process/${name}`, import.meta.url));
}

describe("runProcess", () => {
  test("返回非零 exit 的完整收据", async () => {
    const receipt = await runProcess([process.execPath, fixture("early-exit.mjs")]);
    expect(receipt.exitCode).toBe(3);
    expect(receipt.signal).toBeNull();
    expect(receipt.timedOut).toBe(false);
    expect(receipt.stdout).toBe("EARLY-STDOUT\n");
    expect(receipt.stderr).toBe("EARLY-STDERR\n");
    expect(receipt.argv).toEqual([process.execPath, fixture("early-exit.mjs")]);
    expect(receipt.cwd).toBe(process.cwd());
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0);
    expect(receipt.diagnosticTruncation).toEqual({ stdout: false, stderr: false });
  });

  test("signal 结束返回 signal 收据且 exitCode 为 null", async () => {
    const receipt = await runProcess([process.execPath, fixture("self-kill.mjs")]);
    expect(receipt.exitCode).toBeNull();
    expect(receipt.signal).toBe("SIGKILL");
    expect(receipt.timedOut).toBe(false);
  });

  test("timeout 返回 timedOut 收据并终止进程", async () => {
    const receipt = await runProcess([process.execPath, fixture("forever.mjs")], {
      timeoutMs: 300,
    });
    expect(receipt.timedOut).toBe(true);
    expect(receipt.exitCode).toBeNull();
    expect(receipt.signal).toBe("SIGTERM");
    expect(receipt.durationMs).toBeGreaterThanOrEqual(300);
  });

  test("spawn 失败抛 ProcessStartError，携带 argv/cwd/cause", async () => {
    const argv = ["definitely-not-a-real-binary-testkit-xyz", "--flag"] as const;
    let error: ProcessStartError | undefined;
    try {
      await runProcess(argv);
    } catch (caught) {
      error = caught as ProcessStartError;
    }
    expect(error).toBeInstanceOf(ProcessStartError);
    expect(error!.name).toBe("ProcessStartError");
    expect(error!.argv).toEqual([...argv]);
    expect(error!.cwd).toBe(process.cwd());
    expect(error!.cause).toBeDefined();
    expect(error!.message).toContain(argv[0]);
  });

  test("env 合并进父进程变量集合", async () => {
    const noOverride = await runProcess([process.execPath, fixture("env-echo.mjs")]);
    expect(noOverride.stdout).toContain("ENV-ECHO:UNSET");
    expect(noOverride.stdout).toContain("HAS-PATH:yes");

    const overridden = await runProcess([process.execPath, fixture("env-echo.mjs")], {
      env: { NICE_TEST_VAR: "from-test" },
    });
    expect(overridden.stdout).toContain("ENV-ECHO:from-test");
  });

  test("env 键值不写入诊断", async () => {
    const receipt = await runProcess([process.execPath, fixture("json-ok.mjs")], {
      env: { NICE_SECRET: "s3cr3t-xyz" },
    });
    expect(receipt.diagnostic()).not.toContain("s3cr3t-xyz");
  });

  test("cwd 可指定并写入收据", async () => {
    const cwd = fileURLToPath(new URL("./fixtures", import.meta.url));
    const receipt = await runProcess([process.execPath, fixture("early-exit.mjs")], { cwd });
    expect(receipt.cwd).toBe(cwd);
  });

  test("stdout 与 stderr 各自按序收集", async () => {
    const receipt = await runProcess([process.execPath, fixture("interleave.mjs")]);
    expect(receipt.stdout).toBe("O1\nO2\n");
    expect(receipt.stderr).toBe("E1\nE2\n");
  });

  test("跨 chunk 的多字节 UTF-8 完整解码", async () => {
    const expected =
      "你好，世界！Hello, 世界。🎉🎊 Mixed 中英文 and some 中文末尾。";
    const receipt = await runProcess([process.execPath, fixture("utf8-chunks.mjs")]);
    expect(receipt.exitCode).toBe(0);
    expect(receipt.stdout).toContain(expected);
    expect(receipt.stdout).not.toContain("\uFFFD");
  });

  test("超长输出完整保留，诊断裁剪并标记", async () => {
    const receipt = await runProcess([process.execPath, fixture("flood.mjs")]);
    expect(receipt.exitCode).toBe(0);
    expect(receipt.stdout.length).toBeGreaterThan(DIAGNOSTIC_LIMIT);
    expect(receipt.stderr.length).toBeGreaterThan(DIAGNOSTIC_LIMIT);
    expect(receipt.stdout).toContain("FLOOD-STDOUT-END");
    expect(receipt.stderr).toContain("FLOOD-STDERR-END");
    expect(receipt.diagnosticTruncation).toEqual({ stdout: true, stderr: true });

    const diagnostic = receipt.diagnostic();
    expect(diagnostic).toContain("a".repeat(DIAGNOSTIC_LIMIT));
    expect(diagnostic).not.toContain("FLOOD-STDOUT-END");
    expect(diagnostic).not.toContain("FLOOD-STDERR-END");
    expect(diagnostic).toContain("stdout truncated");
    expect(diagnostic).toContain("stderr truncated");
  });

  test("diagnostic 包含命令、cwd、exit 与分节", async () => {
    const receipt = await runProcess([process.execPath, fixture("early-exit.mjs")]);
    const diagnostic = receipt.diagnostic();
    expect(diagnostic).toContain("$ ");
    expect(diagnostic).toContain(`(cwd: ${process.cwd()})`);
    expect(diagnostic).toContain("exit: 3");
    expect(diagnostic).toContain("--- stdout ---");
    expect(diagnostic).toContain("--- stderr ---");
    expect(diagnostic).toContain("EARLY-STDOUT");
    expect(diagnostic).toContain("EARLY-STDERR");
  });
});

describe("strict JSON / NDJSON", () => {
  test("json() 接受单个完整 JSON 文档", async () => {
    const receipt = await runProcess([process.execPath, fixture("json-ok.mjs")]);
    expect(receipt.json<{ ok: boolean; n: number }>()).toEqual({ ok: true, n: 3 });
  });

  test("json() 拒绝前后噪声", async () => {
    const receipt = await runProcess([process.execPath, fixture("json-noisy.mjs")]);
    expect(() => receipt.json()).toThrow(/line 1/);
    expect(() => receipt.json()).toThrow(/\$ /);
  });

  test("json() 拒绝截断文档", async () => {
    const receipt = await runProcess([process.execPath, fixture("json-truncated.mjs")]);
    expect(() => receipt.json()).toThrow();
  });

  test("ndjson() 接受逐行文档", async () => {
    const receipt = await runProcess([process.execPath, fixture("ndjson-good.mjs")]);
    expect(receipt.ndjson<{ a?: number; b?: number }>()).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("ndjson() 报告 malformed 行号", async () => {
    const receipt = await runProcess([process.execPath, fixture("ndjson-bad.mjs")]);
    expect(() => receipt.ndjson()).toThrow(/line 2/);
    expect(() => receipt.ndjson()).toThrow(/NOT-JSON/);
  });

  test("ndjson() 拒绝空白行", async () => {
    const receipt = await runProcess([process.execPath, fixture("ndjson-blank.mjs")]);
    expect(() => receipt.ndjson()).toThrow(/line 2/);
  });

  test("ndjson() 要求末尾换行", async () => {
    const receipt = await runProcess([process.execPath, fixture("ndjson-no-newline.mjs")]);
    expect(() => receipt.ndjson()).toThrow(/trailing newline/);
  });

  test("ndjson() 拒绝空输出", async () => {
    const receipt = await runProcess([process.execPath, fixture("quiet.mjs")]);
    expect(() => receipt.ndjson()).toThrow(/empty/);
  });
});

describe("command", () => {
  test("argv 等于前缀与参数逐项拼接", async () => {
    const run = command([process.execPath, fixture("argv.mjs")]);
    const receipt = await run.run(["x", "y z", "--flag"]);
    expect(receipt.argv).toEqual([
      process.execPath,
      fixture("argv.mjs"),
      "x",
      "y z",
      "--flag",
    ]);
    expect(receipt.json<string[]>()).toEqual(["x", "y z", "--flag"]);
  });

  test("command 透传 options", async () => {
    const run = command([process.execPath, fixture("early-exit.mjs")]);
    const receipt = await run.run([], { timeoutMs: 5000 });
    expect(receipt.exitCode).toBe(3);
  });
});
