// 跨进程保证：进程终止与信号——终态 Run 保留已终止 owner 的 Session 恢复入口
import { copyFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { execa } from "execa";
import { experimentHost } from "niceeval/experiment/host";
import { decodeRunDocument } from "niceeval/run";
import { RunDeleteError, runHost } from "niceeval/run/host";
import { expect, test } from "vitest";
import { invokeCli } from "../integration/fixtures/judge-harness/harness.ts";
import { createRecordProject, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));

// @feature docs/feature/run/README.md#reference-deletion
test.each([1, 2])("deleting from a %i-Run Invocation preserves its final Session recovery entry", { timeout: 10_000 }, async (runCount) => {
  const cwd = await createRecordProject("niceeval-delete-session-", { held: false });
  try {
    const selectors = ["--experiment", "runs"];
    if (runCount === 2) {
      await copyFile(join(cwd, "experiments/runs.ts"), join(cwd, "experiments/sibling.ts"));
      selectors.push("--experiment", "sibling");
    }
    await writeFile(
      join(cwd, "niceeval.config.ts"),
      `import { defineConfig } from "niceeval";
      import { writeFileSync } from "node:fs";
      import { setTimeout } from "node:timers/promises";
      export default defineConfig({ reporters: [{ async onInvocationComplete() {
        writeFileSync(${JSON.stringify(join(cwd, "gates/entered"))}, "1");
        while (true) await setTimeout(1000);
      } }] });`,
    );
    const owner = execa(process.execPath, [...process.execArgv, cli, "exp", ...selectors, "--json"], {
      cwd,
      reject: false,
    });
    try {
      await Promise.race([
        waitForGate(cwd, "entered"),
        owner.then((result) => {
          throw new Error(`exp exited before reaching the reporter\n${result.stderr}`);
        }),
      ]);
      const listRuns = () => Effect.runPromise(runHost.list({ cwd }));
      const { runs } = await listRuns();
      expect(runs.map((run) => run.state)).toEqual(Array.from({ length: runCount }, () => "completed"));
      const [lastRun, sibling] = runs;
      if (lastRun === undefined) throw new Error("Expected a Run from the Invocation");
      const readSession = async () =>
        (await Effect.runPromise(experimentHost.invocationStatus.show({ cwd, invocationSelector: lastRun.invocationId })))
          .session;
      expect(await readSession()).toMatchObject({ status: "active" });
      if (sibling !== undefined) {
        expect(sibling.invocationId).toBe(lastRun.invocationId);
        expect(await Effect.runPromise(runHost.delete({ cwd, runId: sibling.runId }))).toEqual({
          runId: sibling.runId,
          state: "deleted",
        });
      }

      const request = { cwd, runId: lastRun.runId };
      const before = await Effect.runPromise(runHost.get(request));
      const refused = await Effect.runPromise(Effect.result(runHost.delete(request)));
      expect(refused).toMatchObject({ _tag: "Failure", failure: expect.any(RunDeleteError) });
      expect(refused).toMatchObject({ failure: { code: "run-session-recovery-required" } });
      expect(await Effect.runPromise(runHost.get(request))).toEqual(before);

      owner.kill("SIGKILL");
      expect((await owner).signal).toBe("SIGKILL");
      const cliRefused = await invokeCli(cwd, ["run", "delete", lastRun.runId, "--yes", "--json"]);
      expect(cliRefused.code).toBe(1);
      expect(cliRefused.stdout).toBe("");
      expect(cliRefused.stderr).toMatch(/^run-session-recovery-required: /);
      expect(await Effect.runPromise(runHost.get(request))).toEqual(before);
      expect((await listRuns()).runs.map((run) => run.runId)).toEqual([lastRun.runId]);
      expect(await readSession()).toMatchObject({ status: "active" });

      const recovered = await invokeCli(cwd, ["run", "recover", lastRun.runId, "--yes", "--json"]);
      expect(recovered.code, recovered.stderr).toBe(0);
      expect(decodeRunDocument(JSON.parse(recovered.stdout))).toEqual({
        success: true,
        value: { operation: "run.recover", runId: lastRun.runId, state: "completed" },
      });
      expect(await readSession()).toMatchObject({ status: "interrupted" });
      expect(await Effect.runPromise(runHost.delete(request))).toEqual({ runId: lastRun.runId, state: "deleted" });
      expect((await listRuns()).runs).toEqual([]);
    } finally {
      owner.kill("SIGKILL");
      await owner;
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
