// rerun: pnpm e2e test --candidate source --repo cli -- --run test/sandbox-retain-native.test.ts
import { command, withProcess, withPty } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

const docker = command(["docker"]);

// @use-case docs/feature/sandbox/use-case/sandbox-retain-outside-workdir.md
test.concurrent("失败现场的原生指引可直接进入并销毁容器", async () => {
  await cliE2E.case("sandbox-retain-native", async ({ paths, commands: { niceeval } }) => {
    await writeFile(
      join(paths.projectRoot, "experiments/retain-native.ts"),
      `
import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { sandboxStepActivityAgent } from "../agents/sandbox-step-activity.ts";
export default defineExperiment({
  adapter: sandboxStepActivityAgent,
  sandbox: dockerSandbox({
    source: { type: "image", image: "node@sha256:bde0dae02f2b12d2bce5ee72b2432f0e511767b7b2dc4dd3b064df11ae422fee" },
    user: "node",
  }),
  evals: ["retain-native"],
});
`,
    );
    await writeFile(
      join(paths.projectRoot, "evals/retain-native.eval.ts"),
      `
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({ async test(t) {
  await t.sandbox.writeText("/tmp/native-retain-evidence", "retained scene");
  t.check("actual", includes("missing"));
}});
`,
    );
    for (const json of [true, false]) {
      let ownerPid: number | undefined;
      try {
        await withProcess(
          [...cliBinary, "exp", "retain-native", "--keep-sandbox", ...(json ? ["--json"] : [])],
          { cwd: paths.projectRoot, timeoutMs: 120_000, processGroup: true },
          async (child) => {
            ownerPid = child.pid;
            const receipt = await child.done;
            expect(receipt.exitCode, receipt.diagnostic()).toBe(1);
            const containers = await docker.run(["ps", "-aq", "--filter", `label=niceeval.pid=${ownerPid}`]);
            expect(containers.exitCode, containers.diagnostic()).toBe(0);
            const ids = containers.stdout.trim().split(/\s+/u).filter(Boolean);
            expect(ids, receipt.diagnostic()).toHaveLength(1);
            const id = ids[0];
            const sandboxId = String(id);
            const nativeCommand = `docker start ${sandboxId} && docker exec -it ${sandboxId} /bin/bash`;
            const cleanCommand = `docker rm -f ${sandboxId}`;
            if (json) {
              const kept = receipt.expEvents().filter((event) => "event" in event && event.event === "kept");
              expect(kept, receipt.diagnostic()).toEqual([
                expect.objectContaining({
                  provider: "docker",
                  sandboxId,
                  evalId: "retain-native",
                  verdict: "failed",
                  nativeCommand,
                  cleanCommand,
                }),
              ]);
              expect(kept[0]).not.toHaveProperty("enter");
            } else {
              expect(receipt.stdout, receipt.diagnostic()).toContain("KEPT SANDBOXES");
              expect(receipt.stdout).toContain(`debug: ${nativeCommand}`);
              expect(receipt.stdout).toContain(`clean: ${cleanCommand}`);
            }
            const stopped = await docker.run(["inspect", "--format", "{{.State.Running}}", sandboxId]);
            expect(stopped.stdout.trim(), stopped.diagnostic()).toBe("false");
            await withPty(
              ["bash", "-c", `${nativeCommand} -lc 'cat /tmp/native-retain-evidence'`],
              { cwd: paths.projectRoot, columns: 240, rows: 24, timeoutMs: 20_000 },
              async (pty) => {
                const entered = await pty.wait();
                expect(entered.exitCode, entered.diagnostic()).toBe(0);
                expect(entered.clean).toContain("retained scene");
              },
            );
            const cleaned = await command(["bash", "-c", cleanCommand]).run([]);
            expect(cleaned.exitCode, cleaned.diagnostic()).toBe(0);
            const gone = await docker.run(["ps", "-aq", "--filter", `id=${sandboxId}`]);
            expect(gone.exitCode, gone.diagnostic()).toBe(0);
            expect(gone.stdout.trim()).toBe("");
          },
        );
      } finally {
        if (ownerPid !== undefined) {
          const remaining = await docker.run(["ps", "-aq", "--filter", `label=niceeval.pid=${ownerPid}`]);
          expect(remaining.exitCode, remaining.diagnostic()).toBe(0);
          const ids = remaining.stdout.trim().split(/\s+/u).filter(Boolean);
          if (ids.length > 0) {
            const cleaned = await docker.run(["rm", "-f", ...ids]);
            expect(cleaned.exitCode, cleaned.diagnostic()).toBe(0);
          }
          const gone = await docker.run(["ps", "-aq", "--filter", `label=niceeval.pid=${ownerPid}`]);
          expect(gone.stdout.trim(), gone.diagnostic()).toBe("");
        }
      }
    }
    for (const removed of ["list", "enter", "history", "diff", "stop", "prune"]) {
      const rejected = await niceeval.run(["sandbox", removed]);
      expect(rejected.exitCode, rejected.diagnostic()).not.toBe(0);
      expect(rejected.stderr).toContain(`unknown sandbox command "${removed}"`);
    }
  });
});
