// owner: docs/engineering/testing/architecture/e2e/cli.md#cli-sandbox-step-activity
// rerun: pnpm e2e test --repo cli -- --run test/sandbox-step-activity.test.ts

import { withPty } from "@niceeval/testkit";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    const experimentPath = join(paths.projectRoot, "experiments/sandbox-step-activity.ts");
    const experiment = await readFile(experimentPath, "utf8");
    await writeFile(experimentPath, 'import { writeFileSync } from "node:fs";\n' + experiment.replace(
      '  description:',
      '  before() { writeFileSync(new URL("../fixtures/sandbox-step-activity/prepare.sh", import.meta.url), "exit 91\\n"); },\n  description:',
    ));
    let attemptLocator: string | undefined;
    await withPty(
      [...cliBinary, "exp", "sandbox-step-activity", "--rerun", "all"],
      { cwd: paths.projectRoot, columns: 240, rows: 48, timeoutMs: 120_000 },
      async (pty) => {
        const active = await pty.waitForText(/Prepare runtime marker/u, {
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
        attemptLocator = /(@1[0-9A-HJKMNP-TV-Z]{12})/u.exec(receipt.clean)?.[1];

        expect(receipt.cleanup).toEqual({
          candidateGroup: expect.stringMatching(/gone|terminal/),
          helperGroup: expect.stringMatching(/gone|terminal/),
          launcherGroup: expect.stringMatching(/gone|terminal/),
        });
      },
    );
    // Actual command evidence is read through the public show surface, never storage files.
    expect(attemptLocator).toBeDefined();
    const execution = await niceeval.run(["show", attemptLocator!, "execution"]);
    expect(execution.exitCode, execution.diagnostic()).toBe(0);
    const commandIds = [...new Set(execution.stdout.match(/command_[a-z0-9]+/gu) ?? [])];
    expect(commandIds.length).toBeGreaterThan(0);
    let recordedScript = "";
    for (const commandId of commandIds) {
      const detail = await niceeval.run(["show", attemptLocator!, commandId]);
      expect(detail.exitCode, detail.diagnostic()).toBe(0);
      if (detail.stdout.includes("sandbox-shell-ready")) {
        recordedScript = detail.stdout;
        break;
      }
    }
    expect(recordedScript).toContain("sandbox-shell-ready");
  });
});

// @use-case docs/feature/sandbox/use-case/sandbox-ordered-preparation.md
test.concurrent.each(["both", "neither", "missing", "query", "fragment", "utf8", "nul", "symlink", "label-empty", "label-control", "label-long"] as const)(
  "脚本准备在创建 Sandbox 前拒绝无效声明：%s", async (invalid) => {
    await cliE2E.case(`sandbox-script-invalid-${invalid}`, async ({ paths, commands: { niceeval } }) => {
      const evalPath = join(paths.projectRoot, "evals/sandbox-step-activity/display.eval.ts");
      let source = await readFile(evalPath, "utf8");
      const scriptPath = join(paths.projectRoot, "fixtures/sandbox-step-activity/prepare.sh");
      const outside = await mkdtemp(join(tmpdir(), "niceeval-script-outside-"));
      try {
        if (invalid === "both") source = source.replace('      script:', '      command: "true",\n      script:');
        if (invalid === "neither") source = source.replace(/      script:.*\n/u, "");
        if (invalid === "missing") source = source.replace("prepare.sh", "missing.sh");
        if (invalid === "query") source = source.replace("prepare.sh", "prepare.sh?version=1");
        if (invalid === "fragment") source = source.replace("prepare.sh", "prepare.sh#version");
        if (invalid === "utf8") await writeFile(scriptPath, Buffer.from([0xff, 0xfe]));
        if (invalid === "nul") await writeFile(scriptPath, Buffer.from([0]));
        if (invalid === "symlink") {
          const target = join(outside, "outside.sh");
          await writeFile(target, "true\n");
          await rm(scriptPath);
          await symlink(target, scriptPath);
        }
        if (invalid.startsWith("label-")) source = source.replace('"Prepare runtime marker"', JSON.stringify(
          invalid === "label-empty" ? "" : invalid === "label-control" ? "bad\nlabel" : "😀".repeat(257),
        ));
        await writeFile(evalPath, source);
        const receipt = await niceeval.run(["debug", "sandbox-step-activity", "sandbox-step-activity/display", "--json"]);
        expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
        expect(receipt.stdout).toBe("");
        expect(receipt.stderr).toContain(invalid.startsWith("label-") ? ".label" : invalid === "both" || invalid === "neither" ? "exactly one" : "shell script");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  },
);

// @use-case docs/feature/sandbox/use-case/sandbox-ordered-preparation.md
test.concurrent("准备命令失败时，概览与执行页指向该命令完整保留的输出", async () => {
  await cliE2E.case("sandbox-step-failed-output", async ({ paths, commands: { niceeval } }) => {
    // The head marker lies far outside the bounded error tail; only the command record keeps it.
    await writeFile(
      join(paths.projectRoot, "fixtures/sandbox-step-activity/prepare.sh"),
      "printf 'FAILED-OUTPUT-HEAD %0400d\\n' 0 >&2\nprintf 'FAILED-OUTPUT-TAIL\\n' >&2\nexit 7\n",
    );
    const run = await niceeval.run(["exp", "sandbox-step-activity", "--rerun", "all", "--json"]);
    const event = run.expEvalEvents().find((item) => item.evalId === "sandbox-step-activity/display");
    expect(event?.verdict, run.diagnostic()).toBe("errored");
    const locator = event!.locator!;

    const overview = await niceeval.run(["show", locator]);
    expect(overview.exitCode, overview.diagnostic()).toBe(0);
    expect(overview.stdout).not.toContain("FAILED-OUTPUT-HEAD");
    expect(overview.stdout).toMatch(new RegExp(`Command output\\s+niceeval show ${locator} execution`, "u"));

    const execution = await niceeval.run(["show", locator, "execution"]);
    expect(execution.exitCode, execution.diagnostic()).toBe(0);
    expect(execution.stdout).toContain("exited; code 7");
    const expand = new RegExp(`niceeval show ${locator} (command_[a-z0-9]+)`, "u").exec(execution.stdout);
    expect(expand, execution.stdout).not.toBeNull();

    const detail = await niceeval.run(["show", locator, expand![1]!]);
    expect(detail.exitCode, detail.diagnostic()).toBe(0);
    expect(detail.stdout).toContain("FAILED-OUTPUT-HEAD");
    expect(detail.stdout).toContain("FAILED-OUTPUT-TAIL");
  });
});
