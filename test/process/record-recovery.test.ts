// 跨进程保证：进程终止与信号——真实 niceeval 进程被 SIGKILL 后，已发布 Attempt 保留，后续 Invocation 只执行缺失 slot，owner 终结后才可恢复收口
import { copyFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { decodeRunDocument } from "niceeval/run";
import { runHost } from "niceeval/run/host";
import { invokeCli } from "../integration/fixtures/judge-harness/harness.ts";
import { createRecordProject, openGate, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const start = (cwd: string, args: readonly string[], nodeArgs: readonly string[] = []) =>
  execa(process.execPath, [...process.execArgv, ...nodeArgs, cli, ...args], {
    cwd,
    env: { NO_COLOR: "1" },
    extendEnv: true,
    reject: false,
  });

function pauseBeforeFirstRunWrite(cwd: string): readonly string[] {
  // begin-run is dispatched after writer admission commits. Pause the CLI
  // before it can send the batch or release its ticket on the way out.
  const preload = `
    import { writeFileSync } from "node:fs";
    import { Worker } from "node:worker_threads";
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.operation === "begin-run") {
        writeFileSync(${JSON.stringify(join(cwd, "gates/entered"))}, "1");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      return postMessage.call(this, message, ...args);
    };
  `;
  return ["--import", `data:text/javascript,${encodeURIComponent(preload)}`];
}

// @feature docs/feature/run/README.md#interrupt-recovery
test("after SIGKILL recovery closes the Session and preserves readable published Sources in a portable Record", {
  timeout: 60_000,
}, async () => {
  const cwd = await createRecordProject("niceeval-record-recovery-", { held: true });
  const list = async () => (await Effect.runPromise(runHost.list({ cwd }))).runs;
  const get = async (runId: string) => (await Effect.runPromise(runHost.get({ cwd, runId }))).run;
  const child = start(cwd, ["exp", "runs", "--rerun", "all", "--json"]);
  try {
    await Promise.race([
      waitForGate(cwd, "entered"),
      child.then((r) => {
        throw new Error(`exp exited early\n${r.stderr}`);
      }),
    ]);
    let originId = "";
    for (const deadline = Date.now() + 15_000; Date.now() < deadline; await setTimeout(20)) {
      const run = (await list())[0];
      if (run?.coverage.published === 1) {
        originId = run.runId;
        break;
      }
    }
    expect(originId).not.toBe("");
    const beforeRecovery = await get(originId);
    const published = beforeRecovery.slots.find((slot) => slot.publication.state === "published")!.publication;
    if (published.state !== "published") throw new Error("Expected publication");
    child.kill("SIGKILL");
    expect((await child).signal).toBe("SIGKILL");

    await Effect.runPromise(runHost.recover({ cwd, runId: originId }));
    const closed = await get(originId);
    expect(closed.state).toBe("interrupted");
    expect(closed.slots.find((slot) => slot.publication.state === "published")?.publication).toEqual(published);
    expect(closed.coverage).toEqual({ expected: 2, published: 1, missing: 1 });
    expect(closed.slots.find((slot) => slot.publication.state === "absent")?.publication).toMatchObject({
      reason: "interrupted-before-publication",
    });
    expect(closed.slots.map((slot) => slot.executionIdentityDigest)).toEqual(beforeRecovery.slots.map((slot) => slot.executionIdentityDigest));
    const portable = join(cwd, "portable.sqlite");
    await copyFile(join(cwd, ".niceeval/record.sqlite"), portable);
    const sourceAfter = await invokeCli(cwd, ["show", published.attemptLocator, "source", "--record", portable, "--json"]);
    expect(sourceAfter.code, sourceAfter.stderr || sourceAfter.stdout).toBe(0);
    expect(JSON.parse(sourceAfter.stdout)).toMatchObject({ sources: { state: "available", items: expect.arrayContaining([
      expect.objectContaining({ path: "evals/first.eval.ts", content: expect.objectContaining({ state: "available" }) }),
      expect.objectContaining({ path: "adapter.ts", content: expect.objectContaining({ state: "available" }) }),
    ]) } });
    const sourceFacts = JSON.parse(sourceAfter.stdout).sources;
    expect(sourceFacts.assertions.state).toBe("available");
    expect(sourceFacts.assertions.sourceSites.length).toBeGreaterThan(0);
    for (const site of sourceFacts.assertions.sourceSites) {
      expect(site.source.state).toBe("mapped");
      expect(sourceFacts.items).toContainEqual(expect.objectContaining({ sourceItemId: site.source.sourceItemId, sha256: site.source.sha256 }));
    }
    const invocationId = closed.invocationId;
    const { session } = await Effect.runPromise(
      experimentHost.invocationStatus.show({ cwd, invocationSelector: invocationId }),
    );
    expect(session).toMatchObject({ status: "interrupted", experiments: [{ runId: originId, lifecycle: "terminal" }] });


  } finally {
    child.kill("SIGKILL");
    await child;
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/run/README.md#interrupt-recovery
test.each(["during an Eval", "with an admitted writer"] as const)("exact Run recovery leaves sibling Runs active until the final Run closes their Session (%s)", {
  timeout: 30_000,
}, async (interruption) => {
  const cwd = await createRecordProject("niceeval-session-recovery-", { held: true });
  await copyFile(join(cwd, "experiments/runs.ts"), join(cwd, "experiments/sibling.ts"));
  const child = start(
    cwd,
    ["exp", "--experiment", "runs", "--experiment", "sibling", "--rerun", "all", "--json"],
    interruption === "with an admitted writer" ? pauseBeforeFirstRunWrite(cwd) : [],
  );
  try {
    await Promise.race([
      waitForGate(cwd, "entered"),
      child.then((result) => {
        throw new Error(`exp exited early\n${result.stderr}`);
      }),
    ]);
    const { runs } = await Effect.runPromise(runHost.list({ cwd }));
    expect(runs).toHaveLength(2);
    const [first, second] = runs;
    expect(first!.invocationId).toBe(second!.invocationId);
    const session = async () =>
      (await Effect.runPromise(experimentHost.invocationStatus.show({ cwd, invocationSelector: first!.invocationId })))
        .session;
    child.kill("SIGKILL");
    expect((await child).signal).toBe("SIGKILL");
    const siblingBefore = (await Effect.runPromise(runHost.get({ cwd, runId: second!.runId }))).run;
    await Effect.runPromise(runHost.recover({ cwd, runId: first!.runId }));
    expect((await Effect.runPromise(runHost.get({ cwd, runId: second!.runId }))).run).toMatchObject({
      ...siblingBefore, owner: { state: "gone" },
    });
    expect(await session()).toMatchObject({ status: "active" });
    await Effect.runPromise(runHost.recover({ cwd, runId: second!.runId }));
    expect(await session()).toMatchObject({
      status: "interrupted",
      experiments: expect.arrayContaining([
        expect.objectContaining({ runId: first!.runId, lifecycle: "terminal" }),
        expect.objectContaining({ runId: second!.runId, lifecycle: "terminal" }),
      ]),
    });
    const portable = join(cwd, "portable.sqlite");
    await copyFile(join(cwd, ".niceeval/record.sqlite"), portable);
    const portableRuns = await invokeCli(cwd, ["run", "list", "--record", portable, "--json"]);
    expect(portableRuns.code, portableRuns.stderr || portableRuns.stdout).toBe(0);
    expect(decodeRunDocument(JSON.parse(portableRuns.stdout))).toMatchObject({
      success: true,
      value: {
        operation: "run.list",
        runs: expect.arrayContaining([
          expect.objectContaining({ runId: first!.runId, state: "interrupted" }),
          expect.objectContaining({ runId: second!.runId, state: "interrupted" }),
        ]),
      },
    });
  } finally {
    child.kill("SIGKILL");
    await child;
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/run/README.md#interrupt-recovery
test("recover repairs an abandoned Session for a completed Run without changing its result or cutoff", {
  timeout: 30_000,
}, async () => {
  const cwd = await createRecordProject("niceeval-terminal-session-recovery-", { held: false });
  await writeFile(
    join(cwd, "niceeval.config.ts"),
    `
    import { defineConfig } from "niceeval";
    import { writeFileSync } from "node:fs";
    import { setTimeout } from "node:timers/promises";
    export default defineConfig({ reporters: [{ async onInvocationComplete() {
      writeFileSync(${JSON.stringify(join(cwd, "gates/entered"))}, "1");
      while (true) await setTimeout(1000);
    } }] });
  `,
  );
  const child = start(cwd, ["exp", "runs", "--json"]);
  try {
    await Promise.race([
      waitForGate(cwd, "entered"),
      child.then((result) => {
        throw new Error(`exp exited early\n${result.stderr}`);
      }),
    ]);
    const { runs } = await Effect.runPromise(runHost.list({ cwd }));
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    const before = await Effect.runPromise(runHost.get({ cwd, runId: run.runId }));
    expect(before.run.state).toBe("completed");
    child.kill("SIGKILL");
    expect((await child).signal).toBe("SIGKILL");
    const recovered = await invokeCli(cwd, ["run", "recover", run.runId, "--yes", "--json"]);
    expect(recovered.code, recovered.stderr || recovered.stdout).toBe(0);
    expect(decodeRunDocument(JSON.parse(recovered.stdout))).toEqual({
      success: true,
      value: { operation: "run.recover", runId: run.runId, state: "completed" },
    });
    expect(await Effect.runPromise(runHost.get({ cwd, runId: run.runId }))).toEqual(before);
    expect(
      (await Effect.runPromise(experimentHost.invocationStatus.show({ cwd, invocationSelector: run.invocationId })))
        .session,
    ).toMatchObject({ status: "interrupted" });
    const repeated = await Effect.runPromise(Effect.result(runHost.recover({ cwd, runId: run.runId })));
    expect(repeated).toMatchObject({ _tag: "Failure", failure: { code: "run-terminal" } });
  } finally {
    child.kill("SIGKILL");
    await child;
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/run/README.md#interrupt-recovery
test("a resumed Invocation carries the published slot after recovery releases abandoned case locks", { timeout: 30_000 }, async () => {
  const cwd = await createRecordProject("niceeval-carry-recovery-", { held: true });
  const child = start(cwd, ["exp", "runs", "--rerun", "all", "--json"]);
  try {
    await Promise.race([waitForGate(cwd, "entered"), child.then((r) => { throw new Error(r.stderr); })]);
    let run;
    for (let n = 0; n < 100; n++) {
      run = (await Effect.runPromise(runHost.list({ cwd }))).runs[0];
      if (run?.coverage.published === 1) break;
      await setTimeout(20);
    }
    expect(run?.coverage.published).toBe(1);
    child.kill("SIGKILL"); await child;
    await Effect.runPromise(runHost.recover({ cwd, runId: run!.runId }));
    await openGate(cwd, "release");
    const plan = await Effect.runPromise(experimentHost.invocation.plan({ cwd, experimentSelector: "runs", config: { maxConcurrency: 2 } }));
    if (plan.status !== "ready") throw new Error("Expected resume plan");
    const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: plan.plan }));
    const resumed = (await Effect.runPromise(runHost.get({ cwd, runId: receipt.createdRunIds[0]! }))).run;
    expect(resumed.coverage).toEqual({ expected: 2, published: 2, missing: 0 });
    expect(resumed.slots.map((slot) => [slot.evalId, slot.publication.state === "published" ? slot.publication.action : slot.publication.state]).sort())
      .toEqual([["first", "carried"], ["held", "executed"]]);
  } finally { child.kill("SIGKILL"); await child; await rm(cwd, { recursive: true, force: true }); }
});

// @feature docs/feature/run/README.md#interrupt-recovery
test("recovery refuses an exact owner that is still alive", { timeout: 15_000 }, async () => {
  const cwd = await createRecordProject("niceeval-live-recovery-", { held: true });
  const child = start(cwd, ["exp", "runs", "--json"]);
  try {
    await Promise.race([waitForGate(cwd, "entered"), child.then((r) => { throw new Error(r.stderr); })]);
    const run = (await Effect.runPromise(runHost.list({ cwd }))).runs[0]!;
    const refused = await Effect.runPromise(Effect.result(runHost.recover({ cwd, runId: run.runId })));
    expect(refused).toMatchObject({ _tag: "Failure", failure: { code: "run-owner-active" } });
  } finally { child.kill("SIGKILL"); await child; await rm(cwd, { recursive: true, force: true }); }
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
