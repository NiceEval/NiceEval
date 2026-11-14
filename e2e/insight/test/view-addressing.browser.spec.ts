// rerun: pnpm e2e test --candidate built --repo insight -- --run test/view-addressing.browser.spec.ts
import { only } from "@niceeval/testkit";
import { expect, test } from "@playwright/test";
import { expectLoopbackReadyUrl, insightCaseArtifacts, insightE2E, waitForViewReady } from "./support.ts";

// @feature docs/feature/insight/README.md
test("view opens the exact assertion selected by the shared object address", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await insightE2E.case("view-addressing", { artifacts: insightCaseArtifacts() }, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "classic/memory-a", "classic/recall-name", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), value => value.evalId === "classic/recall-name");
    const outline = await niceeval.run(["show", event.locator, "--json"]);
    expect(outline.exitCode, outline.diagnostic()).toBe(0);
    const entry = outline.inspectionSuccess("attempt.get").attempt.assertions.entries[0]!;
    const view = niceeval.start(["view", event.locator, entry.entryId, "--no-open", "--port", "0"], { timeoutMs: 90_000 });
    try {
      const ready = await waitForViewReady(view);
      await page.goto(expectLoopbackReadyUrl(ready.url).href);
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`aspect=assertions.*id=${entry.entryId}`));
      await expect(page.getByRole("dialog")).toContainText(event.locator);
      if (entry.display.label !== undefined) await expect(page.getByRole("dialog")).toContainText(entry.display.label);
      await page.reload();
      await expect(page.getByRole("dialog")).toContainText(event.locator);
      expect(errors).toEqual([]);
      await page.goto("about:blank");
    } finally {
      if (!view.settledExit) expect(view.signal("SIGTERM")).toBe(true);
      const closed = await view.done;
      expect(closed.exitCode, closed.diagnostic()).toBe(0);
      await view.dispose();
    }
  });
});
