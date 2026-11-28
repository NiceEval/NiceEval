// 跨进程保证：进程终止与信号——场景命令超时后，运行摘要保留触发终止的原因
import { Effect, Fiber } from "effect";
import { execa } from "execa";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  OwnedProcessLive,
  ownedProcessLayer,
  runOwnedProcess,
  stopOwnedProcesses,
} from "../../packages/e2e-runner/src/owned-process.ts";
import { classifyFromReceipt } from "../../packages/e2e-runner/src/receipt.ts";

const testkit = new URL("../../packages/testkit/src/index.ts", import.meta.url);
const tsxModule = [process.execPath, "--conditions=niceeval-source", "--import", "tsx", "--input-type=module", "-e"];

test.each([
  { script: "setInterval(() => {}, 60_000)", timeoutMs: 300, timedOut: true },
  { script: "process.exit(143)", timeoutMs: 10_000, timedOut: false },
])("the summary attributes a timeout only when the runner enforced it ($timedOut)", async (example) => {
  const capture = await Effect.runPromise(
    runOwnedProcess([process.execPath, "-e", example.script], {
      cwd: process.cwd(),
      output: "capture",
      timeoutMs: example.timeoutMs,
    }).pipe(Effect.scoped, Effect.provide(OwnedProcessLive)),
  );
  expect(capture.timedOut).toBe(example.timedOut);
  expect(capture.cancelled).toBe(false);
  const failure = classifyFromReceipt(
    { stages: [{ stage: "test", ok: false, attempt: 1, detail: "test invocation 1 failed", capture }], detail: "" },
    example.timeoutMs / 60_000,
  );
  expect(failure).toEqual({
    category: "regression",
    detail: example.timedOut
      ? "test invocation 1 failed (exceeded project.json timeoutMinutes of 0.005 min)"
      : "test invocation 1 failed",
  });
});

// @spec docs/engineering/testing/README.md#scenario-run-cancellation
test.skipIf(process.platform !== "linux")("SIGINT reclaims a stopped Testkit process group", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "niceeval-testkit-group-"));
  const witness = join(scratch, "pid");
  let pid: number | undefined;
  const state = () => {
    try {
      return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1)?.[0];
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  };
  try {
    const capture = await Effect.runPromise(
      Effect.gen(function* () {
        const script = `
          import { startProcess } from ${JSON.stringify(testkit.href)};
          const child = startProcess([process.execPath, "-e", ${JSON.stringify(
            "process.kill(process.pid, 'SIGSTOP'); setInterval(() => {}, 60_000)",
          )}], { processGroup: true });
          child.done.catch(() => {});
          child.stdout?.on("data", () => {});
          const { writeFileSync } = await import("node:fs");
          writeFileSync(${JSON.stringify(witness)}, String(child.pid));
          await child.done;
        `;
        const child = yield* Effect.forkChild(
          runOwnedProcess([...tsxModule, script], {
            cwd: process.cwd(),
            output: "capture",
            timeoutMs: 3500,
          }),
        );
        yield* Effect.promise(async () => {
          for (let attempt = 0; attempt < 125; attempt++) {
            try {
              pid = Number(readFileSync(witness, "utf8"));
              if (state() === "T") return;
            } catch (error) {
              if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
            }
            await delay(20);
          }
          throw new Error("Testkit did not start a stopped process");
        });
        yield* stopOwnedProcesses("SIGINT");
        return yield* Fiber.join(child);
      }).pipe(Effect.scoped, Effect.provide(ownedProcessLayer({ graceMs: 120 }))),
    );
    expect(capture.cancelled).toBe(true);
    expect([undefined, "Z"]).toContain(state());
    expect(capture).toMatchObject({ resourceCleanup: { ok: true, residual: [] } });
  } finally {
    if (pid !== undefined && ![undefined, "Z", "X"].includes(state())) process.kill(-pid, "SIGKILL");
    rmSync(scratch, { recursive: true, force: true });
  }
});

// A local Docker CLI stand-in exercises label and receipt ownership without a daemon.
test.skipIf(process.platform === "win32").each([true, false])(
  "the Docker cleanup receipt reflects whether the labelled container remains (removed: %s)",
  async (removed) => {
    const scratch = mkdtempSync(join(tmpdir(), "niceeval-testkit-docker-"));
    const state = join(scratch, "state");
    try {
      writeFileSync(join(scratch, "docker"), `#!${process.execPath}
const fs = require("node:fs");
const [command, ...args] = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const id = "a".repeat(64);
if (command === "run") {
  const label = args[args.indexOf("--label") + 1];
  if (!/^dev\\.niceeval\\.e2e\\.owner=[0-9a-f-]{36}$/.test(label)) process.exit(2);
  fs.writeFileSync(state, label);
} else if (command === "ps") {
  if (fs.existsSync(state) && args.includes("label=" + fs.readFileSync(state, "utf8"))) console.log(id);
} else if (command === "rm") {
  if (args.length !== 2 || args[0] !== "--force" || args[1] !== id) process.exit(2);
  if (${removed}) fs.unlinkSync(state);
} else process.exit(2);
`, { mode: 0o700 });
      const capture = await Effect.runPromise(
        runOwnedProcess([...tsxModule, `
          import { runProcess } from ${JSON.stringify(testkit.href)};
          const result = await runProcess(["docker", "run", "--detach", "example"]);
          process.exitCode = result.exitCode ?? 1;
        `], {
          cwd: process.cwd(),
          env: { ...process.env, PATH: [scratch, process.env.PATH].join(delimiter) },
          output: "capture",
          timeoutMs: 3_500,
        }).pipe(Effect.scoped, Effect.provide(ownedProcessLayer({ graceMs: 700 }))),
      );
      expect(capture.exitCode).toBe(0);
      expect(existsSync(state)).toBe(!removed);
      expect(capture.resourceCleanup).toEqual({
        ok: removed,
        residual: removed ? [] : [`Docker containers still present: ${"a".repeat(64)}`],
        scenarioOwned: [],
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);

// @spec docs/engineering/testing/README.md#takeover-default-parallel
test("takeover rejects an explicitly serial selection before reading the candidate", async () => {
  const cli = fileURLToPath(new URL("../../packages/e2e-runner/src/cli.ts", import.meta.url));
  const result = await execa(process.execPath, [
    "--import", "tsx", cli, "takeover", "--candidate", "not-read.tgz", "--repo", "cli",
    "--selector", `e2e/cli/test/fixture.test.ts#neref_${"0".repeat(32)}`, "--", "--maxWorkers=1",
  ], { reject: false });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("default-parallel observation requires parallel capacity of at least two");
  expect(result.stderr).toContain("--maxWorkers=1 requests serial execution");
});
