// owner: docs/engineering/testing/e2e/report.md#report-browser-journey
// kill:
// - inverse = switchLocale early-return without advancing locale generation
// - inverse = custom metric formatters always receive "en" instead of Sample.locale
// - inverse = hierarchy parent cell omits ordinary <a> when descendants.length > 0
// - inverse = static locale document omits its document title, leaving title and body divergent
// - inverse = static templates omit English or apply only the article, leaving English nav
// - inverse = recorded-data fallback bypasses the semantic bilingual report shell
// - inverse = formatCellText renders verdict labels from raw status strings, ignoring locale
// - inverse = ranked-bar/scatter/tree-table headers stay English in zh-CN
// - inverse = static classic chrome omits visible fixed-page hrefs
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts
//
// 浏览器 owner 自己完成 exp → view --out → 真正的 niceeval view server → browser，
// 不消费 Vitest 预先生成的 site-export，也不用 Testkit 静态服务器冒充产品 server。

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type ElementHandle } from "@playwright/test";
import { holdMatchingRequests, reportCaseArtifacts, reportE2E } from "./support.ts";

test("Report browser Journey：经典界面与自定义报告共用固定执行、导航和热重载", async ({ page }) => {
  test.setTimeout(120_000);

  await reportE2E.case(
    "browser",
    { artifacts: reportCaseArtifacts(["site-export", "classic-export", "fallback-export"]) },
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

        // kill: inverse = parent cell omits ordinary <a> when descendants exist.
        // invoke: focus the Experiment parent link, GET its href, then click.
        // observe: live dialog shows that same already-generated detail route.
        const hierarchy = page.getByRole("table", { name: "Experiment hierarchy" });
        const experimentParentLink = hierarchy.getByRole("link", { name: "main", exact: true });
        await expect(experimentParentLink).toBeVisible();
        await experimentParentLink.focus();
        await expect(experimentParentLink).toBeFocused();
        const experimentHref = await experimentParentLink.getAttribute("href");
        expect(experimentHref).toBeTruthy();
        const experimentDetailUrl = new URL(experimentHref!, origin!).href;
        const experimentDetailPath = new URL(experimentHref!, origin!).pathname;
        expect((await page.request.get(experimentDetailUrl)).status()).toBe(200);
        await experimentParentLink.click();
        const experimentDialog = page.locator("dialog[open]");
        await expect(experimentDialog).toHaveAttribute("aria-label", "main");
        await expect(experimentDialog.getByRole("heading", { name: "main", level: 1 })).toBeVisible();
        await expect(experimentDialog.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();
        expect(page.url()).toBe(reportUrl);
        await experimentDialog.getByRole("button", { name: "Close" }).click();
        await expect(page.locator("dialog[open]")).toHaveCount(0);
        await expect(experimentParentLink).toBeFocused();

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
        await expect(page.getByRole("term").filter({ hasText: /^通过率$/ })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "实验", exact: true })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "平均耗时", exact: true })).toBeVisible();
        await expect(page.getByRole("img", { name: "costUSD 与 passRate" })).toBeVisible();
        expect(await page.getByRole("columnheader", { name: "点", exact: true }).count()).toBeGreaterThan(0);
        expect(await page.getByRole("columnheader", { name: "链接", exact: true }).count()).toBeGreaterThan(0);

        // kill: inverse = formatCellText renders verdict labels from raw status
        // strings, ignoring locale. invoke: read the zh-CN execution's
        // Experiment hierarchy record cells. observe: verdict single values and
        // counts read Chinese labels; URL, row identity href and numeric values
        // stay unchanged.
        const zhHierarchy = page.getByRole("table", { name: "实验层级" });
        await expect(zhHierarchy.getByRole("cell", { name: "1 通过 · 1 失败 · 1 出错", exact: true })).toBeVisible();
        await expect(zhHierarchy.getByRole("cell", { name: "1 通过", exact: true })).toBeVisible();
        await expect(zhHierarchy.getByRole("cell", { name: "1 失败", exact: true })).toBeVisible();
        await expect(zhHierarchy.getByRole("cell", { name: "1 出错", exact: true })).toBeVisible();
        await expect(zhHierarchy.getByRole("cell", { name: "通过", exact: true }).first()).toBeVisible();
        await expect(page.getByRole("link", { name: "main", exact: true }).first()).toHaveAttribute(
          "href",
          experimentHref!,
        );
        await expect(page.getByText("33.3%", { exact: true }).first()).toBeVisible();
        await page.getByRole("button", { name: "EN" }).click();
        await expect(page.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("tablist", { name: "Report pages" })).toBeVisible();
        const enHierarchy = page.getByRole("table", { name: "Experiment hierarchy" });
        await expect(enHierarchy.getByRole("cell", { name: "1 passed · 1 failed · 1 errored", exact: true })).toBeVisible();
        await expect(enHierarchy.getByRole("cell", { name: "通过", exact: true })).toHaveCount(0);
        await expect(page.getByRole("img", { name: "costUSD by passRate" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "点", exact: true })).toHaveCount(0);

        // kill: inverse = switchLocale returns on nextLocale === locale without
        // advancing the request generation. invoke: hold the public zh-CN
        // fragment headers, click EN, then release. observe: EN stays pressed;
        // the late fragment does not commit 「通过率」.
        const holdZhFragment = await holdMatchingRequests(page, (request) => {
          const headers = request.headers();
          return headers["x-niceeval-report-fragment"] !== undefined
            && headers["x-niceeval-report-locale"] === "zh-CN";
        });
        try {
          await page.getByRole("button", { name: "中文" }).click();
          await holdZhFragment.firstHeld;
          await page.getByRole("button", { name: "EN" }).click();
          holdZhFragment.release();
          await holdZhFragment.firstDelivered;
          await page.evaluate(() => new Promise<void>((resolve) => {
            setTimeout(() => setTimeout(resolve, 0), 0);
          }));
          expect(page.url()).toBe(reportUrl);
          await expect(page.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
          await expect(page.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "false");
          await expect(page.getByRole("tablist", { name: "Report pages" })).toBeVisible();
          await expect(page.getByText("Evaluation reports for AI agents.", { exact: true })).toBeVisible();
          await expect(page.getByText("通过率", { exact: true })).toHaveCount(0);
        } finally {
          await holdZhFragment.dispose();
        }

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
          const noJsIndex = pathToFileURL(index).href;
          await noJsPage.goto(noJsIndex);
          // kill: inverse = static classic chrome omits visible fixed-page hrefs.
          // invoke: open the exported index over file: with JavaScript disabled.
          // observe: Report pages nav exposes ordinary hrefs; following Attempts
          // then Report reaches those pages. PageFamily titles stay out of nav.
          const staticPages = noJsPage.getByRole("navigation", { name: "Report pages" });
          await expect(staticPages).toBeVisible();
          const attemptsNav = staticPages.getByRole("link", { name: "Attempts", exact: true });
          await expect(attemptsNav).toBeVisible();
          await expect(staticPages.getByRole("link", { name: "Traces", exact: true })).toBeVisible();
          await expect(staticPages.getByRole("link", { name: "Report", exact: true })).toBeVisible();
          await expect(staticPages.getByRole("link", { name: "main", exact: true })).toHaveCount(0);
          expect(await attemptsNav.getAttribute("href")).toBeTruthy();
          await attemptsNav.click();
          await expect(noJsPage.getByRole("heading", { name: "Attempts", level: 1 })).toBeVisible();
          const attemptsPages = noJsPage.getByRole("navigation", { name: "Report pages" });
          await expect(attemptsPages.getByRole("link", { name: "main", exact: true })).toHaveCount(0);
          const reportNav = attemptsPages.getByRole("link", { name: "Report", exact: true });
          expect(await reportNav.getAttribute("href")).toBeTruthy();
          await reportNav.click();
          await expect(noJsPage.getByRole("heading", { name: "NiceEval", level: 1 })).toBeVisible();
          await expect(noJsPage.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();
          const noJsHierarchy = noJsPage.getByRole("table", { name: "Experiment hierarchy" });
          const noJsExperimentLink = noJsHierarchy.getByRole("link", { name: "main", exact: true });
          await expect(noJsExperimentLink).toBeVisible();
          const noJsExperimentHref = await noJsExperimentLink.getAttribute("href");
          expect(noJsExperimentHref).toBeTruthy();
          const noJsExperimentUrl = new URL(noJsExperimentHref!, noJsIndex);
          expect(noJsExperimentUrl.pathname.endsWith(experimentDetailPath)).toBe(true);
          const noJsMain = noJsPage.getByRole("button", { name: "main" });
          await noJsMain.click();
          await expect(noJsPage.getByRole("button", { name: "tool-call" })).toBeVisible();
          await noJsExperimentLink.click();
          await expect(noJsPage.getByRole("heading", { name: "main", level: 1 })).toBeVisible();
          await expect(noJsPage.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();
          expect(new URL(noJsPage.url()).pathname.endsWith(experimentDetailPath)).toBe(true);
        } finally {
          await noJsContext.close();
        }

        // kill: inverse = static templates omit English, or apply only the
        // article and leave English nav. invoke: open the exported index over
        // file: and click 中文 then EN. observe: body and Report pages nav
        // switch together both ways.
        const fileIndex = pathToFileURL(index).href;
        await page.goto(fileIndex);
        await expect(page.getByRole("navigation", { name: "Report pages" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Report", exact: true })).toBeVisible();
        await expect(page.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();
        await page.getByRole("button", { name: "中文" }).click();
        await expect(page.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        await expect(page.getByRole("navigation", { name: "报告页面" })).toBeVisible();
        await expect(page.getByRole("link", { name: "报告", exact: true })).toBeVisible();
        await expect(page.getByRole("table", { name: "实验层级" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "实验", exact: true })).toBeVisible();
        await expect(page.getByRole("img", { name: "costUSD 与 passRate" })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Report pages" })).toHaveCount(0);
        await page.getByRole("button", { name: "EN" }).click();
        await expect(page.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.getByRole("navigation", { name: "Report pages" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Report", exact: true })).toBeVisible();
        await expect(page.getByRole("table", { name: "Experiment hierarchy" })).toBeVisible();
        await expect(page.getByRole("table", { name: "实验层级" })).toHaveCount(0);
        await expect(page.getByRole("navigation", { name: "报告页面" })).toHaveCount(0);
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

        // kill: inverse = a static alternate locale contains only article HTML.
        // invoke: follow the ordinary author-page href, then switch language.
        // observe: the Chinese semantic body and document title change together.
        const staticIndex = pathToFileURL(join(projectRoot, "site-export", "index.html")).href;
        await page.goto(staticIndex);
        const authorApiStaticLink = page.getByRole("link", { name: "Author API", exact: true });
        await expect(authorApiStaticLink).toBeVisible();
        expect(await authorApiStaticLink.getAttribute("href")).toBeTruthy();
        await authorApiStaticLink.click();
        await expect(page).toHaveTitle("Report fixture");
        await expect(page.getByText("Localized custom reading: 1.0", { exact: true }).first()).toBeVisible();
        await page.getByRole("button", { name: "中文" }).click();
        await expect(page).toHaveTitle("报告示例");
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        await expect(page.getByRole("group", { name: "语言" })).toBeVisible();
        await expect(page.getByText("本地化自定义读数：1.0", { exact: true }).first()).toBeVisible();
        expect(await page.getByRole("columnheader", { name: "标签", exact: true }).count()).toBeGreaterThan(0);
        expect(await page.getByRole("columnheader", { name: "覆盖", exact: true }).count()).toBeGreaterThan(0);
        await page.getByRole("button", { name: "EN" }).click();
        await expect(page).toHaveTitle("Report fixture");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.getByRole("group", { name: "Language" })).toBeVisible();
        await expect(page.getByText("Localized custom reading: 1.0", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("本地化自定义读数：1.0", { exact: true })).toHaveCount(0);

        const fallbackExported = await niceeval.run([
          "view",
          "--run",
          runId,
          "--report",
          "./reports/all-data-unavailable.ts",
          "--out",
          "fallback-export",
          "--no-open",
        ]);
        expect(fallbackExported.exitCode, fallbackExported.diagnostic()).toBe(0);
        const fallbackIndex = pathToFileURL(join(projectRoot, "fallback-export", "index.html")).href;

        // kill: inverse = no author page falls through to a text-only English page.
        // invoke: open the exported root and switch its closed fallback document.
        // observe: package language chrome, fallback title, and problem body all switch in place.
        await page.goto(fallbackIndex);
        await expect(page).toHaveTitle("Report data unavailable");
        await expect(page.getByRole("group", { name: "Language" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Report data unavailable", level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Report problems", level: 2 })).toBeVisible();
        await page.getByRole("button", { name: "中文" }).click();
        await expect(page).toHaveTitle("报告数据不可用");
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        await expect(page.getByRole("group", { name: "语言" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "报告数据不可用", level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { name: "报告问题", level: 2 })).toBeVisible();
        await page.getByRole("button", { name: "EN" }).click();
        await expect(page).toHaveTitle("Report data unavailable");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.getByRole("group", { name: "Language" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Report data unavailable", level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Report problems", level: 2 })).toBeVisible();

        const browser = page.context().browser();
        expect(browser).not.toBeNull();
        const noJsFallbackContext = await browser!.newContext({ javaScriptEnabled: false });
        try {
          const noJsFallbackPage = await noJsFallbackContext.newPage();
          await noJsFallbackPage.goto(fallbackIndex);
          await expect(noJsFallbackPage).toHaveTitle("Report data unavailable");
          await expect(noJsFallbackPage.getByRole("group", { name: "Language" })).toBeVisible();
          await expect(noJsFallbackPage.getByRole("heading", {
            name: "Report data unavailable",
            level: 1,
          })).toBeVisible();
          await expect(noJsFallbackPage.getByRole("heading", { name: "Report problems", level: 2 })).toBeVisible();
        } finally {
          await noJsFallbackContext.close();
        }

        const fallbackView = niceeval.start(
          [
            "view",
            "--run",
            runId,
            "--report",
            "./reports/all-data-unavailable.ts",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--no-open",
          ],
          { timeoutMs: 60_000 },
        );
        const fallbackStartup = await waitForOutput(
          fallbackView,
          "stdout",
          /http:\/\/127\.0\.0\.1:\d+\//,
          { timeoutMs: 30_000, label: "fallback report view URL" },
        );
        const fallbackOrigin = fallbackStartup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
        expect(fallbackOrigin, fallbackStartup).toBeDefined();
        await waitForHttp(fallbackOrigin!, "fallback report view readiness");
        await page.goto(fallbackOrigin!);
        const fallbackLiveUrl = page.url();
        await expect(page).toHaveTitle("Report data unavailable");
        await expect(page.getByRole("group", { name: "Language" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Report data unavailable", level: 1 })).toBeVisible();
        await page.getByRole("button", { name: "中文" }).click();
        expect(page.url()).toBe(fallbackLiveUrl);
        await expect(page).toHaveTitle("报告数据不可用");
        await expect(page.getByRole("group", { name: "语言" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "报告数据不可用", level: 1 })).toBeVisible();

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
        const primitiveChildren = ["primitive-alpha", "42", "primitive-omega"] as const;
        const primitiveHandles: ElementHandle<HTMLElement>[] = [];
        for (const text of primitiveChildren) {
          const child = page.getByText(text, { exact: true });
          await expect(child).toBeVisible();
          const handle = await child.elementHandle();
          if (handle === null) throw new Error(`primitive child ${text} disappeared before order check`);
          primitiveHandles.push(handle);
        }
        expect(await primitiveHandles[0]!.evaluate(
          (first, second) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          primitiveHandles[1]!,
        )).toBe(true);
        expect(await primitiveHandles[1]!.evaluate(
          (second, third) => (second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          primitiveHandles[2]!,
        )).toBe(true);
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
        const localeMetric = page.getByRole("figure", { name: /^fixtureLocaleMetric/ });
        await expect(localeMetric.getByText("Localized custom reading: 1.0", { exact: true }).first()).toBeVisible();
        await expect(localeMetric.getByRole("meter").first()).toHaveAttribute("aria-valuenow", "1");
        await page.getByRole("button", { name: "中文" }).click();
        await expect(page.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
        await expect(localeMetric.getByText("本地化自定义读数：1.0", { exact: true }).first()).toBeVisible();
        await expect(localeMetric.getByText("Localized custom reading: 1.0", { exact: true })).toHaveCount(0);
        await expect(localeMetric.getByRole("meter").first()).toHaveAttribute("aria-valuenow", "1");
        await page.getByRole("button", { name: "EN" }).click();
        await expect(page.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
        await expect(localeMetric.getByText("Localized custom reading: 1.0", { exact: true }).first()).toBeVisible();
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
