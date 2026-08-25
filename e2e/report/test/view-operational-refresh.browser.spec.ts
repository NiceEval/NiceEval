// owner: docs/engineering/testing/e2e/report.md#operational-revision-refresh
// rerun: pnpm e2e test --repo report -- --run test/view-operational-refresh.browser.spec.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "@playwright/test";
import {
  decodeViewLifecycle,
  expectLoopbackReadyUrl,
  reportCaseArtifacts,
  reportE2E,
  waitForViewReady,
} from "./support.ts";

test("project view 发现新封口 Run，并在用户确认后原子切换 revision", async ({ page }) => {
  await reportE2E.case(
    "view-operational-refresh",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const first = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(first.exitCode, first.diagnostic()).toBe(0);
      const firstRunId = only(first.expReceipt().runIds, () => true, first.diagnostic());

      const view = niceeval.start([
        "view",
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });

      let stopped = false;
      try {
        const ready = await waitForViewReady(view);
        await page.goto(expectLoopbackReadyUrl(ready.url).href);
        await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "Run" })).toBeVisible();
        await expect(page.getByText(firstRunId, { exact: false }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();

        const second = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(second.exitCode, second.diagnostic()).toBe(0);
        const secondRunId = only(second.expReceipt().runIds, () => true, second.diagnostic());
        expect(secondRunId).not.toBe(firstRunId);

        await expect(page.getByRole("status")).toContainText(/update|new run|refresh/i, {
          timeout: 15_000,
        });
        await expect(page.getByText(secondRunId, { exact: false })).toHaveCount(0);
        await page.getByRole("button", { name: /refresh/i }).click();
        await expect(page.getByText(secondRunId, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(firstRunId, { exact: false }).first()).toBeVisible();

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
