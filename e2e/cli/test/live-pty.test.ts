// owner: docs/engineering/testing/e2e/cli.md#cli-live-pty
// regression: memory/active-progress-hides-user-and-tool-detail.md
// rerun: pnpm e2e test --repo cli -- --run test/live-pty.test.ts

import { withPty } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

const USER_SENTINEL = "pty-user-progress-sentinel";

test("TTY 在 Invocation 尚未结束时显示用户 progress，并以同一成功结果结束", async () => {
  await cliE2E.case("live-pty", async () => {
    await withPty(
      [...cliBinary, "exp", "pty-progress", "--rerun", "all"],
      { columns: 120, rows: 40, timeoutMs: 30_000 },
      async (pty) => {
        const active = await pty.waitForText(new RegExp(`user: .*${USER_SENTINEL}`), {
          timeoutMs: 15_000,
          whileRunning: true,
          label: "the user progress sentinel in the active TTY frame",
        });
        expect(active).toMatch(new RegExp(`user: .*${USER_SENTINEL}`));

        const receipt = await pty.wait();
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.signal, receipt.diagnostic()).toBeNull();
        expect(receipt.raw).toMatch(/\u001b\[/);
        expect(receipt.clean).toContain(USER_SENTINEL);
        expect(receipt.clean).not.toContain("\r");
        expect(receipt.cleanup).toEqual({
          candidateGroup: expect.stringMatching(/gone|terminal/),
          helperGroup: expect.stringMatching(/gone|terminal/),
          launcherGroup: expect.stringMatching(/gone|terminal/),
        });
      },
    );
  });
});
