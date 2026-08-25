// owner: docs/engineering/testing/e2e/report.md#snapshot-browser-journey
// rerun: pnpm e2e test --repo report -- --run test/view-snapshot.browser.spec.ts

import { only } from "@niceeval/testkit";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  decodeViewLifecycle,
  expectLoopbackReadyUrl,
  reportCaseArtifacts,
  reportE2E,
  waitForViewReady,
} from "./support.ts";

test("读者从正式 Record snapshot 打开精选 Run，并始终读取同一 sealed cutoff", async ({ page }) => {
  await reportE2E.case(
    "view-snapshot-browser",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      expect(produced.expReceipt(), produced.diagnostic()).toMatchObject({ completion: "completed" });
      const runId = only(produced.expReceipt().runIds, () => true, produced.diagnostic());
      const attempt = only(
        produced.expEvalEvents(),
        (event) => event.evalId === "inspection",
        produced.diagnostic(),
      );
      expect(attempt).toMatchObject({ verdict: "passed" });
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const snapshot = join(projectRoot, "inspection.record-snapshot.sqlite");
      const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const view = niceeval.start([
        "view",
        "--record",
        snapshot,
        "--run",
        runId,
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });

      let stopped = false;
      try {
        const ready = await waitForViewReady(view);
        const readyUrl = expectLoopbackReadyUrl(ready.url);
        await page.goto(readyUrl.href);
        await expect(page.getByText(runId, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(locator, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(/passed/i).first()).toBeVisible();

        // A Snapshot view has no project watcher or refresh path. A later
        // operational Run must remain outside its sealed cutoff, even reload.
        const later = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(later.exitCode, later.diagnostic()).toBe(0);
        const laterRunId = only(later.expReceipt().runIds, () => true, later.diagnostic());
        expect(laterRunId).not.toBe(runId);
        await page.reload();
        await expect(page.getByText(runId, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(laterRunId, { exact: false })).toHaveCount(0);

        expect(view.signal("SIGTERM")).toBe(true);
        const closed = await view.done;
        stopped = true;
        expect(closed.exitCode, closed.diagnostic()).toBe(0);
        expect(decodeViewLifecycle(closed.stdout).at(-1)?.event).toBe("closed");
      } finally {
        if (!stopped && !view.settledExit) view.signal("SIGTERM");
        await view.dispose();
      }
    },
  );
});
