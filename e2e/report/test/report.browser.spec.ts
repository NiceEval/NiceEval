// owner: docs/engineering/testing/e2e/report.md#渲染面
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts
//
// 浏览器 owner 自己完成 exp → view --out → 真正的 niceeval view server → browser，
// 不消费 Vitest 预先生成的 site-export，也不用 Testkit 静态服务器冒充产品 server。

import { command, pollUntil, waitForOutput, withProcess, withProjectCopy } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

const FIXTURE_COPY_TEXT = "niceeval report fixture copy text";
const binary = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([binary]);

test("custom report Journey：本轮导出后在真实 view server 中导航证据", async ({ page }) => {
  test.setTimeout(120_000);

  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      const liveComponentPath = join(root, "reports", "site-copy-block.tsx");
      const liveComponent = await readFile(liveComponentPath, "utf8");
      expect(liveComponent).toContain("Fixture copy block");

      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const exported = await niceeval.run(
        [
          "view",
          "--record",
          ".niceeval",
          "--report",
          "./reports/site.tsx",
          "--out",
          "site-export",
          "--no-open",
        ],
        { cwd: root },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      expect(await readFile(join(root, "site-export", "index.html"), "utf8")).toContain("Report fixture");

      await withProcess(
        [
          binary,
          "view",
          "--record",
          ".niceeval",
          "--report",
          "./reports/site.tsx",
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--no-open",
        ],
        { cwd: root, timeoutMs: 60_000 },
        async (view) => {
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
          const copyTitle = page.getByText("Fixture copy block", { exact: true });
          await expect(copyTitle).toBeVisible();
          await copyTitle.click();
          await expect(page.getByText(FIXTURE_COPY_TEXT, { exact: true }).first()).toBeVisible();
          const copyButton = page.getByRole("button", { name: "Copy", exact: true });
          await expect(copyButton).toBeVisible();

          await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: origin! });
          await copyButton.click();
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe(FIXTURE_COPY_TEXT);

          const attemptsTab = page.getByRole("tab", { name: "Attempts", exact: true });
          await expect(attemptsTab).toBeVisible();
          await attemptsTab.click();

          const failedRow = page.getByRole("row").filter({ hasText: "failed" }).first();
          await expect(failedRow).toBeVisible();
          const failedLink = failedRow.getByRole("link").first();
          const failedHref = await failedLink.getAttribute("href");
          expect(failedHref).toBeTruthy();

          const failedUrl = new URL(failedHref!, page.url()).href;
          expect((await page.request.get(failedUrl)).status()).toBe(200);
          await page.goto(failedUrl);
          await expect(page.getByText("failed", { exact: true }).first()).toBeVisible();

          await page.goto(origin!);
          const attemptsTabAgain = page.getByRole("tab", { name: "Attempts", exact: true });
          await expect(attemptsTabAgain).toBeVisible();
          await attemptsTabAgain.click();

          const passedRow = page.getByRole("row").filter({ hasText: "passed" });
          await expect(passedRow).toBeVisible();
          const toolCallLink = passedRow.getByRole("link").first();
          const toolCallHref = await toolCallLink.getAttribute("href");
          expect(toolCallHref).toBeTruthy();

          const toolCallUrl = new URL(toolCallHref!, page.url()).href;
          expect((await page.request.get(toolCallUrl)).status()).toBe(200);
          await page.goto(toolCallUrl);
          await expect(page.getByText("Deterministic report fixture response.", { exact: true }).first()).toBeVisible();
          await expect(page.getByText("assistant", { exact: true }).first()).toBeVisible();

          await page.goto(origin!);
          await expect(page.getByText("Fixture copy block", { exact: true })).toBeVisible();
          const liveUrl = page.url();
          await page.evaluate(() => {
            (window as typeof window & { __niceevalE2eSentinel?: string }).__niceevalE2eSentinel = "kept";
          });
          await writeFile(
            liveComponentPath,
            liveComponent.replace("Fixture copy block", "Fixture copy block reloaded"),
            "utf8",
          );
          await expect(page.getByText("Fixture copy block reloaded", { exact: true })).toBeVisible({ timeout: 15_000 });
          expect(page.url()).toBe(liveUrl);
          expect(
            await page.evaluate(
              () => (window as typeof window & { __niceevalE2eSentinel?: string }).__niceevalE2eSentinel,
            ),
          ).toBe("kept");
        },
      );
    },
    reportArtifactStaging("browser", ["site-export"]),
  );
});
