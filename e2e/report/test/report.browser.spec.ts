// owner: docs/engineering/testing/e2e/report.md#report-browser-journey
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts
//
// 浏览器 owner 自己完成 exp → view --out → 真正的 niceeval view server → browser，
// 不消费 Vitest 预先生成的 site-export，也不用 Testkit 静态服务器冒充产品 server。

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

test("custom report Journey：固定执行可导出、导航并热重载静态导入", async ({ page }) => {
  test.setTimeout(120_000);

  await reportE2E.case(
    "browser",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const liveModulePath = join(projectRoot, "reports", "site-copy-block.ts");
      const liveModule = await readFile(liveModulePath, "utf8");
      expect(liveModule).toContain("Fixture copy block");

      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const exported = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/site.ts",
          "--out",
          "site-export",
          "--no-open",
        ],
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      expect(await readFile(join(projectRoot, "site-export", "index.html"), "utf8")).toContain("Report fixture");
      expect((await stat(join(projectRoot, "site-export", "_niceeval", "complete"))).size).toBe(0);

      const view = niceeval.start(
        [
          "view",
          "--report",
          "./reports/site.ts",
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--no-open",
        ],
        { timeoutMs: 60_000 },
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

      await page.goto(origin!);
      await expect(page.getByText("Report fixture", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Fixture copy block", { exact: true }).first()).toBeVisible();

      const slotLink = page.locator("a").filter({ hasText: "Slot " }).first();
      await expect(slotLink).toBeVisible();
      const href = await slotLink.getAttribute("href");
      expect(href).toBeTruthy();
      const slotUrl = new URL(href!, page.url()).href;
      expect((await page.request.get(slotUrl)).status()).toBe(200);

      await page.goto(slotUrl);
      await expect(page.getByText("Report fixture slot", { exact: true }).first()).toBeVisible();

      await page.goto(origin!);
      const liveUrl = page.url();
      await writeFile(
        liveModulePath,
        liveModule.replace("Fixture copy block", "Fixture copy block reloaded"),
        "utf8",
      );
      await expect.poll(
        async () => {
          const response = await page.request.get(origin!);
          return response.status() === 200 ? response.text() : "";
        },
        { timeout: 15_000 },
      ).toContain("Fixture copy block reloaded");
      await page.reload();
      await expect(page.getByText("Fixture copy block reloaded", { exact: true }).first()).toBeVisible();
      expect(page.url()).toBe(liveUrl);
    },
  );
});
