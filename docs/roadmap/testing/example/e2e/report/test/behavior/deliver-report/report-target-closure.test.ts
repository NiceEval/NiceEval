import { expect as expectWeb } from "@playwright/test";
import { reportTargetClosure } from "../../../behaviors/report-target-closure";
import { reportSite } from "../../../support/browser";
import { reportBehavior } from "../../../support/contracts";
import { expectObserved } from "../../../support/observed";

reportBehavior(reportTargetClosure, async ({ world, page }) => {
  expectObserved(world.siteExport("site").targetClosure()).toEqualValue({
    orphanLinks: [],
    orphanDocuments: [],
  });

  const site = reportSite(page, world);
  await site.open();

  for (const name of ["attempt", "experiment", "custom"] as const) {
    const target = world.target(name);
    await site.targetLink(name).click();
    await expectWeb(site.dialog()).toBeVisible();
    await expectWeb(site.dialog()).toHaveAttribute("data-page-id", target.pageId);
    await page.keyboard.press("Escape");
  }

  await site.targetLink("experiment").click();
  await site.dialog().getByRole("link", { name: "Failed attempt" }).click();
  await expectWeb(site.dialog()).toHaveAttribute("data-page-id", "attempt");

  expectObserved(world.browserEvidence().requestFailures()).toEqualSet([]);
  expectObserved(world.browserEvidence().consoleErrors()).toEqualSet([]);
});
