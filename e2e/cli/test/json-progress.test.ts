import { waitForOutput, withProcess } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

// @use-case docs/feature/experiments/use-case/machine-output-ai-fix-loop.md
test.concurrent("JSON 心跳标识当前 Eval、Attempt 和执行阶段", async () => {
  await cliE2E.case("json-progress", async ({ paths }) => {
    await withProcess(
      [...cliBinary, "exp", "pipe-progress", "--rerun", "all", "--json"],
      { cwd: paths.projectRoot, processGroup: true, timeoutMs: 90_000 },
      async (controlled) => {
        await waitForOutput(controlled, "stdout", /"event":"progress"[^\n]*\n/u, {
          timeoutMs: 50_000,
          label: "JSON heartbeat while the Eval is waiting for release",
        });
        await writeFile(join(paths.projectRoot, "pipe-progress-release"), "release");
        await writeFile(join(paths.projectRoot, "pipe-progress-finish"), "finish");
        const receipt = await controlled.done;
        expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        expect(receipt.expReceipt().completion).toBe("completed");
        expect(receipt.stderr).toBe("");
        const heartbeats = receipt.expEvents().filter((event) => "event" in event && event.event === "progress");
        expect(heartbeats).toHaveLength(1);
        expect(heartbeats[0]).toMatchObject({
          running: 1,
          activeOmitted: 0,
          active: [
            {
              experimentId: "pipe-progress",
              evalId: "pipe/progress",
              attempt: 0,
              phase: "eval.run",
              elapsedMs: expect.any(Number),
            },
          ],
        });
      },
    );
  });
});
