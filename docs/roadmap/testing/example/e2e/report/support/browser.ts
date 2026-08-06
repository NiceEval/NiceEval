import type { Page } from "@playwright/test";
import { locateTargetLink, type ReportWorld } from "./contracts";

export function reportSite(page: Page, world: ReportWorld) {
  return {
    async open() {
      await page.goto(world.hostingUrl("site", "clean-url-subpath"));
    },
    targetLink(name: "attempt" | "experiment" | "custom") {
      return locateTargetLink(page, world.target(name));
    },
    dialog() {
      return page.getByRole("dialog");
    },
    table(name: string) {
      return page.getByRole("table", { name });
    },
  };
}
