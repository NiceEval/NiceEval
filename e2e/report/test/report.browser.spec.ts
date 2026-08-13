// owner: e2e/report static + live browser Journey
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { expectNoHorizontalOverflow, followVisibleLink } from "./support/browser.ts";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

test("static Journey: live exp → view --out → exported documents", async ({ page }) => {
  test.setTimeout(180_000);
  await reportE2E.case(
    "browser-static",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
        env: PINNED_ENV,
        timeoutMs: 120_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);

      const exported = await niceeval.run(
        ["view", "--report", "./reports/classic.tsx", "--out", "site-export", "--no-open"],
        { env: PINNED_ENV, timeoutMs: 60_000 },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      const indexPath = join(projectRoot, "site-export", "index.html");
      expect(existsSync(indexPath)).toBe(true);
      expect(await readFile(indexPath, "utf8")).toContain("MemoryBench Classic");

      await page.setViewportSize(DESKTOP);
      await page.goto(pathToFileURL(indexPath).href);
      await expect(page.getByRole("heading", { name: /MemoryBench Classic/i }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "NiceEval" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const experimentLink = page.getByRole("link", { name: /classic\// }).first();
      await expect(experimentLink).toBeVisible();
      const href = await experimentLink.getAttribute("href");
      expect(href).toBeTruthy();
      const target = new URL(href!, page.url());
      if (target.protocol === "file:") {
        const exported = resolveExportedFile(join(projectRoot, "site-export"), href!);
        expect(existsSync(exported), `export target for ${href}`).toBe(true);
        expect(await readFile(exported, "utf8")).toMatch(/classic\//);
      } else if (target.hash.length > 0) {
        await page.goto(target.href);
        await expect(page.getByText(/classic\//).first()).toBeVisible();
      } else {
        expect((await page.request.get(target.href)).status()).toBe(200);
        await page.goto(target.href);
        await expect(page.getByText(/classic\//).first()).toBeVisible();
      }

      await page.setViewportSize(MOBILE);
      await page.goto(pathToFileURL(indexPath).href);
      await expectNoHorizontalOverflow(page);
      await expectAccessibleCollapse(page);
    },
  );
});

test("live Journey: live exp → view --out → real niceeval view server", async ({ page }) => {
  test.setTimeout(180_000);
  await reportE2E.case(
    "browser-live",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
        env: PINNED_ENV,
        timeoutMs: 120_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);

      const exported = await niceeval.run(
        ["view", "--report", "./reports/classic.tsx", "--out", "site-export", "--no-open"],
        { env: PINNED_ENV, timeoutMs: 60_000 },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      expect((await stat(join(projectRoot, "site-export", "index.html"))).isFile()).toBe(true);

      const view = niceeval.start(
        [
          "view",
          "--report",
          "./reports/classic.tsx",
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--no-open",
        ],
        { timeoutMs: 60_000, env: PINNED_ENV },
      );
      const startup = await waitForOutput(view, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
        timeoutMs: 30_000,
        label: "report view URL",
      });
      const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(origin, startup).toBeDefined();

      await pollUntil(
        async () => {
          try {
            return (await page.request.get(origin!)).status() === 200 ? true : undefined;
          } catch {
            return undefined;
          }
        },
        { timeoutMs: 15_000, intervalMs: 100, label: "report view readiness" },
      );

      await page.setViewportSize(DESKTOP);
      await page.goto(origin!);
      await expect(page.getByRole("heading", { name: /MemoryBench Classic/i }).first()).toBeVisible();
      await expect(page.getByRole("navigation").or(page.getByRole("link", { name: /Overview|Attempts|Traces/i })).first()).toBeVisible();
      await followVisibleLink(page, /classic\//);
      await expect(page.getByText(/classic\//).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto(origin!);
      await page.setViewportSize(MOBILE);
      await expectNoHorizontalOverflow(page);
      await expectAccessibleCollapse(page);
    },
  );
});

function resolveExportedFile(exportDir: string, href: string): string {
  const relative = href.split("#")[0] ?? href;
  return join(exportDir, relative.replace(/^\.\//, ""));
}

async function expectAccessibleCollapse(page: import("@playwright/test").Page): Promise<void> {
  const disclosure = page.getByRole("button").or(page.locator("summary")).first();
  if ((await disclosure.count()) === 0) return;
  if (await disclosure.isVisible()) {
    await disclosure.focus();
    await expect(disclosure).toBeFocused();
  }
}
