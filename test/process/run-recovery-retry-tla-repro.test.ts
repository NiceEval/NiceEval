// 跨进程保证：进程终止与信号——原 writer 已退出，同一存活 Host 能重试自己未提交终态的 recovery。
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { execa } from "execa";
import { runHost } from "niceeval/run/host";
import { expect, test } from "vitest";
import { createRecordProject, waitForGate } from "../integration/fixtures/record-harness/project.ts";

// @feature docs/feature/run/README.md#interrupt-recovery
test("the same Host retries its unfinished recovery after the terminal transaction rolls back", { timeout: 30_000 }, async () => {
  const cwd = await createRecordProject("niceeval-recover-retry-", { held: true });
  const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
  const owner = execa(process.execPath, [...process.execArgv, cli, "exp", "runs", "--json"], { cwd, reject: false });
  try {
    await Promise.race([waitForGate(cwd, "entered"), owner.then((r) => { throw new Error(r.stderr); })]);
    const { runs } = await Effect.runPromise(runHost.list({ cwd }));
    const request = { cwd, runId: runs[0]!.runId };
    owner.kill("SIGKILL");
    await owner;

    const once = join(cwd, "gates", "fail-close");
    const preload = join(cwd, "inject-fault.mjs");
    await writeFile(once, "");
    await writeFile(preload, `
      import { existsSync, unlinkSync } from "node:fs";
      import { DatabaseSync } from "node:sqlite";
      const prepare = DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare = function (sql) {
        if (sql.includes("UPDATE ne19_run_resources SET terminal_state='interrupted'") && existsSync(${JSON.stringify(once)})) {
          unlinkSync(${JSON.stringify(once)});
          throw new Error("test: close temporarily unavailable");
        }
        return prepare.call(this, sql);
      };
    `);
    const probe = `
      import { Effect, Result } from "effect";
      import { runHost } from "niceeval/run/host";
      import { spawnSync } from "node:child_process";
      const request = ${JSON.stringify(request)};
      const recover = async () => {
        const result = await Effect.runPromise(Effect.result(runHost.recover(request)));
        return Result.isSuccess(result) ? result.success.state : result.failure.code;
      };
      const first = await recover();
      const afterFirst = (await Effect.runPromise(runHost.get(request))).run.state;
      const other = spawnSync(process.execPath, [...${JSON.stringify(process.execArgv)}, ${JSON.stringify(cli)}, "run", "recover", request.runId, "--yes", "--json"], { cwd: request.cwd, encoding: "utf8" });
      const second = await Promise.all([recover(), recover()]);
      console.log(JSON.stringify({first, afterFirst, other: other.stderr + other.stdout, second}));
    `;
    const host = await execa(process.execPath, [...process.execArgv, "--input-type=module", "-e", probe], {
      env: { NODE_OPTIONS: [process.env.NODE_OPTIONS, "--import=" + preload].filter(Boolean).join(" ") },
    });
    const result = JSON.parse(host.stdout);
    expect(result.first).toBe("run-recover-failed");
    expect(result.afterFirst).toBe("recovering");
    expect(result.other).toContain("run-owner-active");
    expect(result.second.filter((state: string) => state === "interrupted")).toHaveLength(1);
    expect(result.second.some((state: string) => state === "run-owner-active" || state === "run-terminal")).toBe(true);
    expect((await Effect.runPromise(runHost.get(request))).run.state).toBe("interrupted");
  } finally {
    owner.kill("SIGKILL");
    await owner;
    await rm(cwd, { recursive: true, force: true });
  }
});
