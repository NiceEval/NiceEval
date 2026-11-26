// 跨进程保证：进程终止与信号——集合恢复先关闭被强杀的精确 Run，再运行 after。
import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Effect, Result } from "effect";
import { execa } from "execa";
import { experimentHost } from "niceeval/experiment/host";
import { defineExperiment } from "niceeval";
import { runHost } from "niceeval/run/host";
import { expect, test } from "vitest";
import { createRecordProject, openGate, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const authorKey = "state-set-external";
const automaticKeys = ["state/" + "a".repeat(64), "state/" + "b".repeat(64)];

// The state planner will supply these keys once State bindings are implemented.
function startInvocation(
  cwd: string,
  experiment: string,
  keys: readonly string[],
  signalWaitKey?: string,
) {
  const planned = `agentRuns: state.runs.map(run => ({ ...run, stateLeaseKeys: ${JSON.stringify(keys)} })),`;
  const preload = `
    import { writeFileSync } from "node:fs";
    import { registerHooks } from "node:module";
    import { Worker } from "node:worker_threads";
    registerHooks({ load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!url.endsWith("/experiment/host/operations.ts")) return loaded;
      const source = Buffer.from(loaded.source).toString();
      const entry = "agentRuns: state.runs,";
      if (!source.includes(entry)) throw new Error("Missing Runner planning seam");
      return { ...loaded, source: source.replace(entry, ${JSON.stringify(planned)}) };
    } });
    const signalWaitKey = ${JSON.stringify(signalWaitKey)};
    if (signalWaitKey !== undefined) {
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(request, ...args) {
        if (request?.operation === "registry" && request.command._tag === "shared-list" &&
            request.command.key === signalWaitKey) {
          writeFileSync(${JSON.stringify(join(cwd, "gates", "waiter-reading"))}, "observed");
        }
        return send.call(this, request, ...args);
      };
    }
  `;
  return execa(process.execPath, [
    ...process.execArgv, "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    cli, "exp", experiment, "--rerun", "all", "--json",
  ], { cwd, reject: false, timeout: 20_000 });
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await delay(10);
    }
  }
  throw new Error(`Gate did not open: ${path}`);
}

async function inspectOwner(cwd: string, recoveryKey: string) {
  const inspection = await Effect.runPromise(experimentHost.after.inspect({
    cwd, experimentSelector: "runs", recoveryKey, currentHost: hostname(),
  }));
  if (inspection.status !== "ready" || !inspection.evidence) throw new Error("Missing owner evidence");
  return inspection.evidence;
}

// @feature docs/feature/state/README.md#shared-state-recovery
test("explicit recovery closes the exact Run before compensating and releasing the set", { timeout: 30_000 }, async () => {
  const cwd = await createRecordProject("niceeval-state-set-", { held: true });
  const callbacks = join(cwd, "gates", "after-calls");
  const target = { cwd, experimentSelector: "runs", recoveryKey: authorKey, currentHost: hostname() };
  try {
    await writeFile(join(cwd, "experiments", "runs.ts"), `
      import { appendFileSync, existsSync } from "node:fs";
      import { setTimeout } from "node:timers/promises";
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({
        adapter,
        evals: ["held"],
        sharedState: { key: ${JSON.stringify(authorKey)} },
        async after() {
          appendFileSync(${JSON.stringify(callbacks)}, "after\\n");
          while (!existsSync(${JSON.stringify(join(cwd, "gates", "release"))})) await setTimeout(10);
        },
      });
    `);
    const owner = startInvocation(cwd, "runs", automaticKeys);
    let runId: string;
    try {
      await Promise.race([waitForGate(cwd, "entered"), owner.then((r) => { throw new Error(r.stderr); })]);
      const listed = await Effect.runPromise(runHost.list({ cwd }));
      expect(listed.runs).toHaveLength(1);
      runId = listed.runs[0]!.runId;
    } finally {
      owner.kill("SIGKILL");
      await owner;
    }
    const { ownerToken } = await inspectOwner(cwd, authorKey);
    for (const key of automaticKeys) {
      expect((await inspectOwner(cwd, key)).ownerToken).toBe(ownerToken);
    }
    const regularAfter = await Effect.runPromise(experimentHost.after.run({
      cwd, experimentSelector: "runs", currentHost: hostname(),
    }));
    expect(regularAfter).toMatchObject({ status: "completed", experiments: [{ executions: 0 }] });

    const invocation = { ...target, recoveryKey: automaticKeys[1], ownerToken,
      confirmOwnerTerminated: true, confirmRemoteQuiesced: true };
    const recovery = Effect.runPromise(experimentHost.after.run(invocation));
    try {
      expect(await Promise.race([
        waitForFile(callbacks), recovery.then((result) => { throw new Error(JSON.stringify(result)); }),
      ])).toBe("after\n");
      expect((await Effect.runPromise(runHost.get({ cwd, runId }))).run.state).toBe("interrupted");
      const deletion = await Effect.runPromise(Effect.result(runHost.delete({ cwd, runId })));
      expect(Result.isFailure(deletion) && deletion.failure.code).toBe("run-lease-recovery-required");
    } finally {
      await openGate(cwd, "release");
      await recovery;
    }
    expect((await recovery).status).toBe("recovered");
    const retry = await Effect.runPromise(experimentHost.after.run({ ...invocation, recoveryKey: authorKey }));
    expect(retry.status).toBe("already-released");
    expect(await readFile(callbacks, "utf8")).toBe("after\n");
    expect((await Effect.runPromise(runHost.delete({ cwd, runId }))).state).toBe("deleted");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/state/README.md#shared-state-recovery
test("a canceled overlapping waiter leaves no key and a pure State set recovers without after", { timeout: 30_000 }, async () => {
  const cwd = await createRecordProject("niceeval-state-set-overlap-", { held: true });
  const [unused, shared] = automaticKeys;
  const ownerOnly = "state/" + "c".repeat(64);
  try {
    await writeFile(join(cwd, "experiments", "contender.ts"), `
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({ adapter, evals: ["first"] });
    `);
    const owner = startInvocation(cwd, "runs", [shared, ownerOnly]);
    let runId: string;
    try {
      await Promise.race([waitForGate(cwd, "entered"), owner.then((result) => { throw new Error(result.stderr); })]);
      const listed = await Effect.runPromise(runHost.list({ cwd }));
      runId = listed.runs[0]!.runId;
      const waiter = startInvocation(cwd, "contender", [unused, shared], shared);
      try {
        await Promise.race([
          waitForFile(join(cwd, "gates", "waiter-reading")),
          waiter.then((result) => { throw new Error(result.stderr); }),
        ]);
        const inspection = await Effect.runPromise(experimentHost.after.inspect({
          cwd, experimentSelector: "contender", currentHost: hostname(), recoveryKey: unused,
        }));
        expect(inspection.status).toBe("no-evidence");
      } finally {
        waiter.kill("SIGINT");
        await waiter;
      }
    } finally {
      owner.kill("SIGKILL");
      await owner;
    }
    const { ownerToken } = await inspectOwner(cwd, ownerOnly);
    expect((await inspectOwner(cwd, shared)).ownerToken).toBe(ownerToken);
    const recovered = await Effect.runPromise(experimentHost.after.run({
      cwd, experimentSelector: "runs", recoveryKey: ownerOnly, currentHost: hostname(), ownerToken,
      confirmOwnerTerminated: true, confirmRemoteQuiesced: true,
    }));
    expect(recovered.status).toBe("recovered");
    expect((await Effect.runPromise(runHost.get({ cwd, runId }))).run.state).toBe("interrupted");
    expect(await Effect.runPromise(experimentHost.after.inspect({
      cwd, experimentSelector: "contender", currentHost: hostname(), recoveryKey: unused,
    }))).toMatchObject({ status: "no-evidence" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/state/README.md#shared-state-recovery
test("an author key cannot use the automatic State prefix", () => {
  expect(() => defineExperiment({ evals: ["first"], sharedState: { key: automaticKeys[0] } }))
    .toThrow(/state\/ prefix is reserved/u);
});
