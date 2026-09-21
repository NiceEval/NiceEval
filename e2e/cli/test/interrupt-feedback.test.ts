import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pollUntil, withProcess } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

test.concurrent("无 Sandbox 的中断反馈不虚构容器清理 [necase_D31DET9WE90ZY004]", async () => {
  await cliE2E.case("interrupt-feedback", async ({ paths }) => {
    await withProcess(
      [...cliBinary, "exp", "interrupt-feedback", "--rerun", "all"],
      { cwd: paths.projectRoot, processGroup: true, timeoutMs: 30_000 },
      async (controlled) => {
        await Promise.race([
          pollUntil(async () => {
            try {
              return await readFile(join(paths.projectRoot, "interrupt-feedback-ready"), "utf8") === "ready" ? true : undefined;
            } catch {
              return undefined;
            }
          }, { timeoutMs: 15_000, intervalMs: 50, label: "direct Eval ready for interruption" }),
          controlled.done.then((receipt) => { throw new Error(receipt.diagnostic()); }),
        ]);
        expect(controlled.signal("SIGINT")).toBe(true);
        const receipt = await controlled.done;
        expect(receipt.exitCode, receipt.diagnostic()).toBe(130);
        expect(receipt.stdout).toContain("INTERRUPTED");
        expect(receipt.stdout).toContain("interrupted: printing partial results completed so far.");
        expect(receipt.stdout).not.toContain("sandbox containers cleaned up");
      },
    );
  });
});
