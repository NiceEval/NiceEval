import { only } from "@niceeval/testkit";
import { expect, test } from "@playwright/test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expectLoopbackReadyUrl, insightCaseArtifacts, insightE2E, waitForViewReady } from "./support.ts";

// @feature docs/feature/insight/README.md
test("读者在 Attempt 详情查看独立 Notes，刷新后保留数值单位与空值", async ({ page }, testInfo) => {
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await insightE2E.case(
    "attempt-notes-browser",
    { artifacts: insightCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "classic/memory-a", "classic/recall-name", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const event = only(run.expEvalEvents(), (item) => item.evalId === "classic/recall-name", run.diagnostic());
      const locator = event.locator.startsWith("@") ? event.locator : `@${event.locator}`;
      const runId = only(run.expReceipt().createdRunIds, () => true, run.diagnostic());
      await rm(join(projectRoot, "niceeval.config.ts"));
      const view = niceeval.start(["view", `run:${runId}`, "--no-open", "--port", "0"], { timeoutMs: 90_000 });
      try {
        const ready = await waitForViewReady(view);
        await page.goto(expectLoopbackReadyUrl(ready.url).href);
        await expect(page.getByRole("heading", { name: "NiceEval Insight", exact: true })).toBeVisible();
        for (const name of [/^classic\/memory-a /u, /^classic\/recall-name/u]) {
          await page.locator("summary.niceeval-table-hierarchy-summary").filter({ hasText: name }).click();
        }
        await page.getByRole("link", { name: locator, exact: true }).click();
        const notes = page.getByRole("dialog").getByRole("region", { name: "Notes", exact: true });
        for (const value of [
          "Recall latency",
          "512 ms",
          '"topic":"recall-name"',
          "Missing observation",
          "unavailable",
        ]) {
          await expect(notes).toContainText(value);
        }
        await page.reload();
        await expect(notes).toContainText("512 ms");
        await testInfo.attach("attempt-notes", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        expect(errors).toEqual([]);
        await page.goto("about:blank");
      } finally {
        if (!view.settledExit) expect(view.signal("SIGTERM")).toBe(true);
        const closed = await view.done;
        expect(closed.exitCode, closed.diagnostic()).toBe(0);
        await view.dispose();
      }
    },
  );
});
