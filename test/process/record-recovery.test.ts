// 跨进程保证：进程终止与信号——真实 niceeval 进程被 SIGKILL 后，已发布 Attempt 保留，后续 Invocation 只执行缺失 slot，owner 终结后才可恢复收口
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, test } from "vitest";
import { createRecordProject, openGate, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");

const start = (cwd: string, args: readonly string[]) =>
  execa(process.execPath, [...process.execArgv, cli, ...args], { cwd, env: { NO_COLOR: "1" }, extendEnv: true, reject: false });

// @feature docs/feature/run/README.md#interrupt-recovery
test("after SIGKILL published Attempts survive, only the missing slot reruns, and recover closes the old Run", { timeout: 60_000 }, async () => {
  const cwd = await createRecordProject("niceeval-record-recovery-", { held: true });
  const list = async () => (await Effect.runPromise(runHost.list({ cwd }))).runs;
  const get = async (runId: string) => (await Effect.runPromise(runHost.get({ cwd, runId }))).run;
  const child = start(cwd, ["exp", "runs", "--rerun", "all", "--json"]);
  try {
    await Promise.race([waitForGate(cwd, "entered"), child.then((r) => { throw new Error(`exp exited early\n${r.stderr}`); })]);
    let originId = "";
    for (const deadline = Date.now() + 15_000; Date.now() < deadline; await setTimeout(20)) {
      const run = (await list())[0];
      if (run?.coverage.published === 1) {
        originId = run.runId;
        break;
      }
    }
    expect(originId).not.toBe("");
    child.kill("SIGKILL");
    expect((await child).signal).toBe("SIGKILL");

    expect((await list())[0]).toMatchObject({ runId: originId, state: "active", coverage: { expected: 2, published: 1, missing: 1 } });

    await openGate(cwd, "release");
    const resumed = await start(cwd, ["exp", "runs", "--json"]);
    expect(resumed.exitCode, resumed.stderr).toBe(0);
    const resumedRun = await get((await list()).find((run) => run.runId !== originId)!.runId);
    expect(resumedRun.coverage).toEqual({ expected: 2, published: 2, missing: 0 });
    expect(
      resumedRun.slots.map((slot) => [slot.evalId, slot.publication.state === "published" ? slot.publication.action : slot.publication.state]).sort(),
    ).toEqual([["first", "carried"], ["held", "executed"]]);

    await Effect.runPromise(runHost.recover({ cwd, runId: originId }));
    const closed = await get(originId);
    expect(closed.state).toBe("interrupted");
    expect(closed.coverage).toEqual({ expected: 2, published: 1, missing: 1 });
    expect(closed.slots.find((slot) => slot.publication.state === "absent")?.publication).toMatchObject({
      reason: "interrupted-before-publication",
    });
  } finally {
    child.kill("SIGKILL");
    await child;
    await rm(cwd, { recursive: true, force: true });
  }
});
