// owner: docs/engineering/testing/e2e/cli.md#cli-sandbox-step-activity
// rerun: pnpm e2e test --repo cli -- --run test/sandbox-step-activity.test.ts

import { withPty } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

const SHELL_COMMAND = "printf 'sandbox-shell-ready\\n' > /tmp/sandbox-shell-ready && sleep 2";
test("TTY 在声明式 Sandbox step 执行时显示安全的具体动作 [necase_Q6TNRRPB791NM6SY]", async () => {
  await cliE2E.case("sandbox-step-activity", async () => {
    await withPty(
      [...cliBinary, "exp", "sandbox-step-activity", "--rerun", "all"],
      { columns: 240, rows: 48, timeoutMs: 60_000 },
      async (pty) => {
        const active = await pty.waitForText(/preparing sandbox/u, {
          timeoutMs: 30_000,
          whileRunning: true,
          label: "the running Sandbox preparation phase",
        });
        expect(active).toContain(SHELL_COMMAND);
        expect(active).not.toContain("/bin/sh -lc");

        const receipt = await pty.wait();
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.signal, receipt.diagnostic()).toBeNull();
        expect(receipt.raw).toContain(String.fromCharCode(27));
        expect(receipt.raw).toContain('exec "/bin/sh" "-c" "sleep 2" "activity-arg\\\\tvalue"');
        expect(receipt.raw).toContain('env keys=["ACTIVITY_VISIBLE_KEY"]');
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
