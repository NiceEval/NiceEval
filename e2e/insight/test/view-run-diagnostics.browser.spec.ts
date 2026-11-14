import { only } from "@niceeval/testkit";
import { expect, test } from "@playwright/test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectLoopbackReadyUrl, insightCaseArtifacts, insightE2E, waitForViewReady } from "./support.ts";

test.describe.configure({ mode: "parallel" });

// @use-case docs/feature/insight/use-case/insight-review-run-adoption.md
// @regression memory/pre-dispatch-run-diagnostics.md
test("reader sees why a Run failed before its Attempts started", async ({ page }) => {
  await insightE2E.case(
    "view-run-diagnostics",
    { artifacts: insightCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(
        join(projectRoot, "experiments/run-before-error.ts"),
        `
import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";
export default defineExperiment({
  adapter: deterministicAgent(), sandbox: deterministicSandbox,
  evals: ["classic/recall-name"], attempts: 2,
  before: () => { throw new Error("Experiment before failed: request req_before_view_123"); },
});
`,
      );
      const failed = await niceeval.run(["exp", "run-before-error", "--rerun", "all", "--json"]);
      expect(failed.exitCode, failed.diagnostic()).toBe(1);
      const runId = only(failed.expReceipt().createdRunIds, () => true, failed.diagnostic());
      // Review persisted history without loading the failing project's current configuration.
      await rm(join(projectRoot, "niceeval.config.ts"));
      const view = niceeval.start(["view", `run:${runId}`, "--no-open", "--port", "0"], { timeoutMs: 90_000 });
      try {
        const ready = await waitForViewReady(view);
        await page.goto(expectLoopbackReadyUrl(ready.url).href);
        const runLink = page.getByRole("link", { name: "Open a historical Run", exact: true });
        await expect(runLink).toBeVisible();
        await expect(runLink).toHaveAttribute("href", new RegExp(runId));
        await runLink.click();
        await expect(page.getByRole("heading", { name: `Run membership · ${runId}`, exact: true })).toBeVisible();
        const errors = page.getByRole("region", { name: "Run errors", exact: true });
        await expect(errors).toBeVisible();
        await expect(errors).toContainText("Experiment before failed: request req_before_view_123");
        await expect(errors).toContainText("Attempts not started: 2");
        await expect(errors).toContainText("classic/recall-name");
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("zh-CN", { timeout: 10_000 });
        await page.getByRole("link", { name: "查看历史运行", exact: true }).click();
        const translated = page.getByRole("region", { name: "运行错误", exact: true });
        await expect(translated).toBeVisible();
        await expect(translated).toContainText("未启动的尝试：2");
        await expect(translated).toContainText("req_before_view_123");
      } finally {
        try {
          if (!page.isClosed()) await page.close();
        } finally {
          try {
            if (!view.settledExit) expect(view.signal("SIGTERM")).toBe(true);
            const closed = await view.done;
            expect(closed.exitCode, closed.diagnostic()).toBe(0);
          } finally {
            await view.dispose();
          }
        }
      }
    },
  );
});
