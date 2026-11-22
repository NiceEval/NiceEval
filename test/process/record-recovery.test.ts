// 跨进程保证：进程终止与信号——真实 niceeval 进程被 SIGKILL 后，已发布 Attempt 保留，后续 Invocation 只执行缺失 slot，owner 终结后才可恢复收口
import { createRequire } from "node:module";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { invokeCli } from "../integration/fixtures/judge-harness/harness.ts";
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

// @feature docs/feature/assertions/README.md
// @feature docs/feature/run/README.md#interrupt-recovery
test("each published Attempt can read newly captured Sources before its multi-Eval Run finishes", { timeout: 10_000 }, async () => {
  const cwd = await createRecordProject("niceeval-sources-publication-", { held: true });
  const helper = "export function check(t) { t.ready(); }\n";
  await writeFile(join(cwd, "shared-source.ts"), helper + "// first snapshot\n");
  await writeFile(join(cwd, "second-source.ts"), helper);
  await writeFile(join(cwd, "evals/first.eval.ts"), `import adapter from "../adapter.ts";
    import { check } from "../shared-source.ts";
    export default adapter.defineEval({ test(t) { check(t); } });`);
  await writeFile(join(cwd, "evals/second.eval.ts"), `import adapter from "../adapter.ts";
    import { existsSync } from "node:fs";
    import { setTimeout } from "node:timers/promises";
    import { check } from "../shared-source.ts";
    import { check as second } from "../second-source.ts";
    export default adapter.defineEval({ async test(t) {
      while (!existsSync(${JSON.stringify(join(cwd, "gates/second"))})) await setTimeout(10);
      check(t); second(t);
    } });`);
  await writeFile(join(cwd, "experiments/runs.ts"), `import { defineExperiment } from "niceeval";
    import adapter from "../adapter.ts";
    export default defineExperiment({ adapter, evals: ["first", "second", "held"], attempts: 1 });`);
  await writeFile(join(cwd, "niceeval.config.ts"), `import { defineConfig } from "niceeval";
    export default defineConfig({ maxConcurrency: 3, maxRetries: 0 });`);
  const child = start(cwd, ["exp", "runs", "--rerun", "all", "--json"]);
  const publishedRun = async (count: number) => {
    for (const deadline = Date.now() + 10_000; Date.now() < deadline; await setTimeout(20)) {
      const run = (await Effect.runPromise(runHost.list({ cwd }))).runs[0];
      if (run?.coverage.published === count) return (await Effect.runPromise(runHost.get({ cwd, runId: run.runId }))).run;
    }
    throw new Error(`Expected ${count} published Attempts`);
  };
  try {
    await waitForGate(cwd, "entered");
    const first = await publishedRun(1);
    await writeFile(join(cwd, "shared-source.ts"), helper + "// second snapshot\n");
    await writeFile(join(cwd, "gates/second"), "1");
    const second = await publishedRun(2);
    expect(second.state).toBe("active");
    // Capturing new snapshots must not change any already planned Eval identity.
    expect(second.slots.map((slot) => slot.executionIdentityDigest)).toEqual(first.slots.map((slot) => slot.executionIdentityDigest));
    const publication = second.slots.find((slot) => slot.evalId === "second")!.publication;
    if (publication.state !== "published") throw new Error("Expected second publication");
    const shown = await invokeCli(cwd, ["show", publication.attemptLocator, "source", "--json"]);
    expect(shown.code, shown.stderr || shown.stdout).toBe(0);
    const sources = JSON.parse(shown.stdout).sources;
    expect(sources).toMatchObject({ state: "available", items: expect.arrayContaining([
      expect.objectContaining({ path: "second-source.ts", content: { state: "available", text: helper } }),
    ]) });
    const snapshots = sources.items.filter((item: { path: string }) => item.path === "shared-source.ts");
    expect(sources.assertions.state).toBe("available");
    expect(sources.assertions.sourceSites.length).toBeGreaterThan(0);
    for (const site of sources.assertions.sourceSites) {
      expect(site.source.state).toBe("mapped");
      expect(sources.items).toContainEqual(expect.objectContaining({ sourceItemId: site.source.sourceItemId, sha256: site.source.sha256 }));
    }
    expect(snapshots).toHaveLength(2);
    expect(new Set(snapshots.map((item: { sha256: string }) => item.sha256)).size).toBe(2);
  } finally {
    child.kill("SIGKILL");
    await child;
    await rm(cwd, { recursive: true, force: true });
  }
});
