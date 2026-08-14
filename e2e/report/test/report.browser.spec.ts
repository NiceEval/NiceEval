// owner: docs/engineering/testing/e2e/report.md#report-browser-journey
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts
//
// 浏览器 owner 自己完成 exp → view --out → 真正的 niceeval view server → browser，
// 不消费 Vitest 预先生成的 site-export，也不用 Testkit 静态服务器冒充产品 server。

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

test("Report browser Journey：经典界面与自定义报告共用固定执行、导航和热重载", async ({ page }) => {
  test.setTimeout(120_000);

  await reportE2E.case(
    "browser",
    { artifacts: reportCaseArtifacts(["site-export", "classic-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.expReceipt()).toMatchObject({ completion: "completed" });
      expect(run.expReceipt().runIds).toHaveLength(1);
      const runId = run.expReceipt().runIds[0]!;

      await verifyClassicReport();
      await verifyCustomReport();

      async function verifyClassicReport(): Promise<void> {
        const exported = await niceeval.run([
          "view",
          "--report",
          "standard",
          "--out",
          "classic-export",
          "--no-open",
        ]);
        expect(exported.exitCode, exported.diagnostic()).toBe(0);
        const index = join(projectRoot, "classic-export", "index.html");
        const html = await readFile(index, "utf8");
        expect(html).toContain("Evaluation reports for AI agents.");
        expect(html).toContain("Experiment hierarchy");
        expect((await stat(join(projectRoot, "classic-export", "_niceeval", "complete"))).size).toBe(0);

        const view = niceeval.start(
          [
            "view",
            "--report",
            "standard",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--no-open",
          ],
          { timeoutMs: 60_000 },
        );
        const startup = await waitForOutput(
          view,
          "stdout",
          /http:\/\/127\.0\.0\.1:\d+\//,
          { timeoutMs: 30_000, label: "classic report view URL" },
        );
        const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
        expect(origin, startup).toBeDefined();
        await waitForHttp(origin!, "classic report readiness");

        await page.goto(origin!);
        const reportUrl = page.url();
        await expect(page.getByRole("tablist", { name: "Report pages" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Report" })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tab", { name: "Attempts" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Traces" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "NiceEval", level: 1 })).toBeVisible();
        await expect(page.getByText("Evaluation reports for AI agents.", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
          "href",
          "https://github.com/NiceEval/NiceEval",
        );
        await expect(page.getByText("33.3%", { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("figure", { name: "Experiments costUSD × passRate" })).toBeVisible();
        await expect(page.getByRole("table", { name: "Accessible values for Experiments" })).toBeVisible();
        await expect(page.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();

        await page.getByRole("tab", { name: "Attempts" }).click();
        await expect(page.getByRole("tab", { name: "Attempts" })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "Attempts", level: 1 })).toBeVisible();
        await page.getByRole("tab", { name: "Report" }).click();

        const mainDisclosure = page.getByRole("button", { name: "main" });
        await mainDisclosure.click();
        await expect(mainDisclosure).toHaveAttribute("aria-expanded", "true");
        const filter = page.getByRole("searchbox", { name: "Filter" });
        await filter.fill("tool-call");
        await expect(page.getByRole("button", { name: "tool-call" })).toBeVisible();
        await expect(page.getByRole("button", { name: "deliberate-fail" })).toBeHidden();
        await page.getByRole("button", { name: "Clear" }).click();
        await expect(page.getByRole("button", { name: "deliberate-fail" })).toBeVisible();

        await page.getByRole("button", { name: "tool-call" }).click();
        const attemptLink = page.getByRole("link", { name: /^@1/ });
        await expect(attemptLink).toBeVisible();
        const attemptHref = await attemptLink.getAttribute("href");
        expect(attemptHref).toBeTruthy();
        expect((await page.request.get(new URL(attemptHref!, origin!).href)).status()).toBe(200);
        const locator = await attemptLink.textContent();
        await attemptLink.click();
        const dialog = page.locator("dialog[open]");
        await expect(dialog).toHaveAttribute("aria-label", locator!);
        await expect(dialog.getByRole("table", { name: "Attempt" })).toBeVisible();
        expect(page.url()).toBe(reportUrl);
        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(page.locator("dialog[open]")).toHaveCount(0);
        await expect(attemptLink).toBeFocused();

        await page.getByRole("button", { name: "中文" }).click();
        expect(page.url()).toBe(reportUrl);
        await expect(page.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("tablist", { name: "报告页面" })).toBeVisible();
        await expect(page.getByText("通过率", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "EN" }).click();

        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        )).toBe(true);
        await page.setViewportSize({ width: 1280, height: 720 });

        const browser = page.context().browser();
        expect(browser).not.toBeNull();
        const noJsContext = await browser!.newContext({ javaScriptEnabled: false });
        try {
          const noJsPage = await noJsContext.newPage();
          await noJsPage.goto(pathToFileURL(index).href);
          await expect(noJsPage.getByRole("heading", { name: "NiceEval", level: 1 })).toBeVisible();
          await expect(noJsPage.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();
          const noJsMain = noJsPage.getByRole("button", { name: "main" });
          await noJsMain.click();
          await expect(noJsPage.getByRole("button", { name: "tool-call" })).toBeVisible();
        } finally {
          await noJsContext.close();
        }
      }

      async function verifyCustomReport(): Promise<void> {
        const liveModulePath = join(projectRoot, "reports", "site-copy-block.ts");
        const liveModule = await readFile(liveModulePath, "utf8");
        expect(liveModule).toContain("Fixture copy block");

        const exported = await niceeval.run([
          "view",
          "--run",
          runId,
          "--report",
          "./reports/site.tsx",
          "--out",
          "site-export",
          "--no-open",
        ]);
        expect(exported.exitCode, exported.diagnostic()).toBe(0);
        expect(await readFile(join(projectRoot, "site-export", "index.html"), "utf8")).toContain("Report fixture");
        expect((await stat(join(projectRoot, "site-export", "_niceeval", "complete"))).size).toBe(0);

        const view = niceeval.start(
          [
            "view",
            "--run",
            runId,
            "--report",
            "./reports/site.tsx",
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
        await waitForHttp(origin!, "report view readiness");

        await page.goto(origin!);
        await expect(page.getByText("Report fixture", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Fixture copy block", { exact: true }).first()).toBeVisible();
        const authorApi = page.getByRole("tab", { name: "Author API" });
        await expect(authorApi).toBeVisible();
        await authorApi.click();
        const authorHeading = page.getByRole("heading", { name: "Classic author surface", level: 1 });
        await expect(authorHeading).toBeVisible();
        const selectionNotice = page.getByRole("status").filter({
          hasText: "selection-profile-unavailable",
        });
        await expect(selectionNotice).toHaveCount(1);
        await expect(selectionNotice).toContainText(
          "this Report selection does not include a current project declaration profile",
        );
        const headingHandle = await authorHeading.elementHandle();
        if (headingHandle === null) throw new Error("classic author heading disappeared before notice placement check");
        expect(await selectionNotice.evaluate(
          (notice, heading) => (heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          headingHandle,
        )).toBe(true);
        await expect(page.getByRole("figure", { name: "Pass rate(%)" })).toBeVisible();
        await expect(page.getByRole("figure", { name: "Experiments costUSD × passRate" })).toBeVisible();
        await expect(page.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();
        await page.goto(origin!);

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
      }

      async function waitForHttp(origin: string, label: string): Promise<void> {
        await pollUntil(
          async () => {
            try {
              return (await page.request.get(origin)).status() === 200 ? true : undefined;
            } catch {
              return undefined;
            }
          },
          { timeoutMs: 15_000, intervalMs: 100, label },
        );
      }
    },
  );
});
