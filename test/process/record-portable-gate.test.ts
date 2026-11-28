// 跨进程保证：运行环境——真实 niceeval 进程在 portable Record 校验失败时以非零状态退出，且不写最终 receipt
// 跨进程保证：文件与锁——后续 Invocation 开启新数据库代次时，前一个 Invocation 仍能取得完成回执
import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fc from "fast-check";
import { decodeExpTerminalEvent } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { createRecordProject, openGate, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));

function failPortableValidationOnce(marker: string): readonly string[] {
  const preload = `
    import { writeFileSync } from "node:fs";
    import { DatabaseSync } from "node:sqlite";
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function (sql) {
      if (sql.includes("SELECT barrier_state,portable_generation,portable_revision,storage_generation")) {
        DatabaseSync.prototype.prepare = prepare;
        writeFileSync(${JSON.stringify(marker)}, "1");
        return { get: () => undefined };
      }
      return prepare.call(this, sql);
    };
  `;
  return ["--import", `data:text/javascript,${encodeURIComponent(preload)}`];
}

function pauseAfterCheckpoint(cwd: string): readonly string[] {
  const preload = `
    import { existsSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { DatabaseSync } from "node:sqlite";
    const gates = join(${JSON.stringify(cwd)}, "gates");
    const exec = DatabaseSync.prototype.exec;
    const close = DatabaseSync.prototype.close;
    const checkpointed = new WeakSet();
    DatabaseSync.prototype.exec = function (sql) {
      const result = exec.call(this, sql);
      if (sql === "PRAGMA wal_checkpoint(TRUNCATE)") checkpointed.add(this);
      return result;
    };
    DatabaseSync.prototype.close = function () {
      close.call(this);
      if (!checkpointed.has(this)) return;
      writeFileSync(join(gates, "validating"), "1");
      const deadline = Date.now() + 10_000;
      const cell = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(join(gates, "entered"))) {
        if (Date.now() >= deadline) throw new Error("Successor did not enter its Eval");
        Atomics.wait(cell, 0, 0, 10);
      }
    };
  `;
  return ["--import", `data:text/javascript,${encodeURIComponent(preload)}`];
}

function readTerminalReceipt(stdout: string) {
  const events: unknown[] = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return events.find(
    (event) => typeof event === "object" && event !== null && "type" in event && event.type === "receipt",
  );
}

// @feature docs/feature/run/architecture/lifecycle.md#创建与执行
test("exp only succeeds with a terminal receipt after portable Record validation", { timeout: 30_000 }, async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (failValidation) => {
      const cwd = await createRecordProject("niceeval-portable-gate-", { held: false });
      try {
        const marker = join(cwd, "gates", "validation-failed");
        const nodeArgs = failValidation ? failPortableValidationOnce(marker) : [];
        const result = await execa(process.execPath, [...process.execArgv, ...nodeArgs, cli, "exp", "runs", "--json"], {
          cwd,
          env: { NO_COLOR: "1" },
          reject: false,
          timeout: 10_000,
        });
        const receipt = readTerminalReceipt(result.stdout);
        if (failValidation) {
          await access(marker);
          expect({ exitCode: result.exitCode, receipt }, result.stderr).toEqual({ exitCode: 1, receipt: undefined });
          expect(result.stderr).toContain("record-database-invalid");
        } else {
          expect(result.exitCode, result.stderr).toBe(0);
          const terminal = decodeExpTerminalEvent(receipt);
          expect(terminal.receipt.completion).toBe("completed");
          expect(terminal.summary.passed).toBe(1);
        }
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }),
    { numRuns: 2, seed: 20261124, examples: [[true], [false]] },
  );
});

// @feature docs/feature/run/architecture/lifecycle.md#创建与执行
test("a successor opening a new generation during portable validation preserves both Invocation receipts", async () => {
  const cwd = await createRecordProject("niceeval-portable-successor-", { held: false });
  try {
    await writeFile(
      join(cwd, "experiments", "successor.ts"),
      `import { defineExperiment } from "niceeval";
       import adapter from "../adapter.ts";
       export default defineExperiment({ adapter, evals: ["held"] });`,
    );
    const start = (name: string, nodeArgs: readonly string[] = []) =>
      execa(process.execPath, [...process.execArgv, ...nodeArgs, cli, "exp", name, "--json"], {
        cwd,
        reject: false,
        timeout: 15_000,
        env: { NO_COLOR: "1" },
      });
    const first = start("runs", pauseAfterCheckpoint(cwd));
    let successor: ReturnType<typeof start> | undefined;
    try {
      await Promise.race([
        waitForGate(cwd, "validating"),
        first.then(({ stderr }) => {
          throw new Error(`First Invocation exited before its checkpoint: ${stderr}`);
        }),
      ]);
      successor = start("successor");
      await Promise.race([
        waitForGate(cwd, "entered"),
        successor.then(({ stderr }) => {
          throw new Error(`Successor exited before entering its Eval: ${stderr}`);
        }),
      ]);
      const firstResult = await first;
      expect(firstResult.exitCode, firstResult.stderr).toBe(0);
      expect(decodeExpTerminalEvent(readTerminalReceipt(firstResult.stdout)).receipt.completion).toBe("completed");
      await openGate(cwd, "release");
      const successorResult = await successor;
      expect(successorResult.exitCode, successorResult.stderr).toBe(0);
      expect(decodeExpTerminalEvent(readTerminalReceipt(successorResult.stdout)).receipt.completion).toBe("completed");
    } finally {
      first.kill();
      successor?.kill();
      await Promise.allSettled([first, successor]);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 30_000);
