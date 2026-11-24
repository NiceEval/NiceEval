// 跨进程保证：运行环境——真实 niceeval 进程在 portable Record 校验失败时以非零状态退出，且不写最终 receipt
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fc from "fast-check";
import { decodeExpTerminalEvent } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { createRecordProject } from "../integration/fixtures/record-harness/project.ts";

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

// @feature docs/feature/run/architecture/lifecycle.md#创建与执行
// @issue docs/issues/portable-gate-failure-ignored.md
test("exp only succeeds with a terminal receipt after portable Record validation", { timeout: 30_000 }, async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (failValidation) => {
      const cwd = await createRecordProject("niceeval-portable-gate-", { held: false });
      try {
        const marker = join(cwd, "gates", "validation-failed");
        const nodeArgs = failValidation ? failPortableValidationOnce(marker) : [];
        const result = await execa(
          process.execPath,
          [...process.execArgv, ...nodeArgs, cli, "exp", "runs", "--json"],
          { cwd, env: { NO_COLOR: "1" }, reject: false, timeout: 10_000 },
        );
        const events: unknown[] = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
        const receipt = events.find(
          (event) => typeof event === "object" && event !== null && "type" in event && event.type === "receipt",
        );
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
