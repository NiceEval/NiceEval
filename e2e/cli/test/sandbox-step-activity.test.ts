// owner: docs/engineering/testing/architecture/e2e/cli.md#cli-sandbox-step-activity
// rerun: pnpm e2e test --repo cli -- --run test/sandbox-step-activity.test.ts

import { withPty } from "@niceeval/testkit";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeDebugPlanDocument, type DebugPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

const SHELL_COMMAND = "printf 'sandbox-shell-ready\\n' > /tmp/sandbox-shell-ready && sleep 2";

// @use-case docs/feature/sandbox/use-case/sandbox-ordered-preparation.md

test.concurrent("脚本准备按冻结内容执行，TTY 显示动作名并保留完整命令供查询", async () => {
  await cliE2E.case("sandbox-step-activity", async ({ paths, commands: { niceeval } }) => {
    const debug = async () => {
      const receipt = await niceeval.run(["debug", "sandbox-step-activity", "sandbox-step-activity/display", "--json"]);
      expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
      return decodeDebugPlanDocument(receipt.json<unknown>());
    };
    const action = (plan: DebugPlanDocument) => {
      const steps = plan.commandPlan.experiments.flatMap((experiment) => experiment.lanes.flatMap((lane) => lane.slots.flatMap((slot) => slot.steps)));
      const step = steps.find((step) => step.action?.id === "activity-shell");
      expect(step?.action).toBeDefined();
      if (!step?.action || !("fingerprint" in step.action)) throw new Error("Missing public script action plan");
      return step.action;
    };
    const initial = action(await debug());
    const human = await niceeval.run(["debug", "sandbox-step-activity", "sandbox-step-activity/display"]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stdout).toContain("fixtures/sandbox-step-activity/prepare.sh");
    expect(human.stdout).toContain(SHELL_COMMAND);
    const evalPath = join(paths.projectRoot, "evals/sandbox-step-activity/display.eval.ts");
    const originalEval = await readFile(evalPath, "utf8");
    const scriptPath = join(paths.projectRoot, "fixtures/sandbox-step-activity/prepare.sh");
    const renamedPath = join(paths.projectRoot, "fixtures/sandbox-step-activity/renamed.sh");
    await rename(scriptPath, renamedPath);
    await writeFile(evalPath, originalEval.replace("prepare.sh", "renamed.sh").replace("Prepare runtime marker", "Renamed display label"));
    expect(action(await debug()).fingerprint).toEqual(initial.fingerprint);
    await writeFile(renamedPath, `${SHELL_COMMAND}\n# changed byte\n`);
    expect(action(await debug()).fingerprint).not.toEqual(initial.fingerprint);
    await writeFile(renamedPath, `${SHELL_COMMAND}\n`);
    await rename(renamedPath, scriptPath);
    await writeFile(evalPath, originalEval);
    await withPty(
      [...cliBinary, "exp", "sandbox-step-activity", "--rerun", "all"],
      { cwd: paths.projectRoot, columns: 240, rows: 48, timeoutMs: 120_000 },
      async (pty) => {
        const active = await pty.waitForText(/preparing sandbox/u, {
          timeoutMs: 90_000,
          whileRunning: true,
          label: "the running Sandbox preparation phase",
        });
        expect(active).toContain("Prepare runtime marker");
        expect(active).not.toContain(SHELL_COMMAND);
        expect(active).not.toContain("/bin/sh -lc");

        const receipt = await pty.wait();
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.signal, receipt.diagnostic()).toBeNull();
        expect(receipt.raw).toContain(String.fromCharCode(27));
        expect(receipt.raw).toContain("activity-exec");
        expect(receipt.raw).not.toContain('activity-arg');
        expect(receipt.raw).not.toContain("activity-env-private-value");
        expect(receipt.raw).not.toContain("sandbox-write-private-body");
        expect(receipt.raw).not.toContain("fixtures/sandbox-step-activity/upload.txt");
        expect(receipt.raw).not.toContain("host-upload-private-body");

        expect(receipt.cleanup).toEqual({
          candidateGroup: expect.stringMatching(/gone|terminal/),
          helperGroup: expect.stringMatching(/gone|terminal/),
          launcherGroup: expect.stringMatching(/gone|terminal/),
        });
      },
    );
  });
});
