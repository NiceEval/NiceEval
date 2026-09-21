// rerun: pnpm e2e test --repo cli -- --run test/live-pipe.test.ts

import { waitForOutput, withProcess } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

test.concurrent("非 TTY 在运行中显示有归属且合并去重的进度 [necase_M0SW6ZCJKN30HJNN]", async () => {
  await cliE2E.case("live-pipe", async ({ paths }) => {
    await withProcess(
      [...cliBinary, "exp", "pipe-progress", "--rerun", "all"],
      { cwd: paths.projectRoot, processGroup: true, timeoutMs: 30_000 },
      async (controlled) => {
        await waitForOutput(controlled, "stdout", /pipe-progress-ready/u, {
          timeoutMs: 15_000,
          label: "progress before releasing the active Eval",
        });
        await writeFile(join(paths.projectRoot, "pipe-progress-release"), "release");
        await waitForOutput(controlled, "stdout", /pipe-progress-latest/u, {
          timeoutMs: 5_000,
          label: "the latest coalesced progress while the Eval is still active",
        });
        // Keep reporting the same message across a throttle window: unchanged
        // detail must not create another line merely because time has elapsed.
        await new Promise<void>((resolve) => setTimeout(resolve, 1_200));
        await writeFile(join(paths.projectRoot, "pipe-progress-finish"), "finish");
        const receipt = await controlled.done;
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.stderr).toBe("");
        expect(receipt.stdout).not.toMatch(/[\x1b\x08\r]/u);
        const progress = receipt.stdout.split("\n").filter((line) => /pipe-progress-(ready|burst-\d+|latest)/u.test(line));
        expect(progress.filter((line) => line.includes("pipe-progress-ready"))).toHaveLength(1);
        expect(progress.filter((line) => line.includes("pipe-progress-latest"))).toHaveLength(1);
        expect(progress.filter((line) => line.includes("pipe-progress-burst-")).length).toBeLessThanOrEqual(1);
        for (const line of progress) {
          expect(line).toContain("pipe-progress");
          expect(line).toContain("pipe/progress");
          expect(line).toMatch(/attempt\s+1/u);
        }
        expect(receipt.stdout).toContain("PASSED");
      },
    );
  });
});
