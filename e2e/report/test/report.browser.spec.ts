// owner: docs/engineering/testing/e2e/report.md#report-browser-journey
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts
//
// The Journey uses only the installed candidate CLI, exported files, real HTTP,
// href navigation, browser-visible content, and download bytes. It deliberately
// does not inspect renderer classes, layout, paint, CSS selectors, or Record files.

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  readonly event: string;
}

type DetailKind = "Source" | "Trace" | "Diff";

test("静态站与 view 对同一用户路由交付相同字节，且离线无 JavaScript 仍可浏览和下载", async ({ browser }) => {
  test.setTimeout(120_000);

  await reportE2E.case(
    "browser-static-site",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const slotCount = run.ndjson<ExpEvent>().filter((event) => event.event === "eval").length;
      expect(slotCount, run.diagnostic()).toBeGreaterThan(0);

      const exported = await niceeval.run([
        "view",
        "--report",
        "./reports/site.ts",
        "--out",
        "site-export",
        "--no-open",
      ]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

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
        label: "static-equivalent view URL",
      });
      const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(origin, startup).toBeDefined();
      await waitForHttp(origin!, "static-equivalent view readiness");

      const staticRoot = pathToFileURL(join(projectRoot, "site-export", "index.html"));
      await expectSameBody(staticRoot, new URL(origin!));

      const offline = await browser.newContext({ acceptDownloads: true, javaScriptEnabled: false });
      try {
        await offline.setOffline(true);
        const page = await offline.newPage();
        await page.goto(staticRoot.href);
        await expect(page.getByRole("heading", { name: "Report fixture", level: 1 })).toBeVisible();
        await expect(page.getByText("Fixture data download", { exact: true })).toBeVisible();
        const chart = page.getByRole("figure", { name: /Fixture model scores/ });
        await expect(chart.getByRole("img", { name: /Fixture model scores/ })).toBeVisible();
        const chartData = chart.getByRole("table");
        await expect(chartData).toBeVisible();
        await expect(chartData.getByRole("columnheader", { name: "model" })).toBeVisible();
        await expect(chartData.getByRole("columnheader", { name: "score" })).toBeVisible();
        await expect(chartData.getByRole("row", { name: /North.*72/ })).toBeVisible();
        await expect(chartData.getByRole("row", { name: /South.*91/ })).toBeVisible();
        await expect(page.getByText("Fixture overview tab content", { exact: true })).toBeVisible();
        await expect(page.getByText("Fixture details tab content", { exact: true })).toBeVisible();

        const detailLinks = await Promise.all(
          (await page.getByRole("link", { name: /^(Source|Trace|Diff) detail / }).all()).map(async (link) => {
            const href = await link.getAttribute("href");
            if (href === null) throw new Error("a visible static detail link has no href");
            return { href, label: await link.innerText() };
          }),
        );
        expect(detailLinks).toHaveLength(slotCount * 3);
        expect([...new Set(detailLinks.map(({ label }) => detailKind(label)))].sort()).toEqual(
          ["Diff", "Source", "Trace"],
        );

        for (const detail of detailLinks) {
          const kind = detailKind(detail.label);
          const staticUrl = new URL(detail.href, staticRoot);
          const liveUrl = new URL(detail.href, origin!);
          await expectSameBody(staticUrl, liveUrl);

          // The href is a shareable exported location, not an in-memory router state.
          await page.goto(staticUrl.href);
          await expect(page.getByRole("heading", { name: `${kind} fixture`, level: 1 })).toBeVisible();
          await expect(page.getByText(new RegExp(`^${kind} fixture detail `))).toBeVisible();
          const sharedUrl = page.url();
          await page.reload();
          expect(page.url()).toBe(sharedUrl);
          await expect(page.getByRole("heading", { name: `${kind} fixture`, level: 1 })).toBeVisible();
        }

        await page.goto(staticRoot.href);
        const downloadLink = page.getByRole("link", { name: /^Download fixture\.csv/ }).first();
        await expect(downloadLink).toBeVisible();
        const downloadHref = await downloadLink.getAttribute("href");
        if (downloadHref === null) throw new Error("the visible fixture download has no href");
        await expectSameBody(new URL(downloadHref, staticRoot), new URL(downloadHref, origin!));
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          downloadLink.click(),
        ]);
        expect(download.suggestedFilename()).toBe("fixture.csv");
        const stream = await download.createReadStream();
        expect(stream).not.toBeNull();
        const chunks: Buffer[] = [];
        for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString("utf8")).toBe("id,status\nfixture,ready\n");
      } finally {
        await offline.close();
      }

      // A static page must remain complete even if a view-only refresh or host-data
      // probe is unavailable. This context leaves JavaScript enabled and fails every
      // HTTP transport before opening the exported file, without naming a host route.
      const blockedTransport = await browser.newContext();
      try {
        await blockedTransport.route(/^https?:\/\//, (route) => route.abort("failed"));
        const page = await blockedTransport.newPage();
        await page.goto(staticRoot.href);
        await expect(page.getByRole("heading", { name: "Report fixture", level: 1 })).toBeVisible();
        await expect(page.getByText("Fixture data download", { exact: true })).toBeVisible();
      } finally {
        await blockedTransport.close();
      }

      // Open the JavaScript-enhanced live page before changing its watched
      // static import. The user does not reload: a successful new revision must
      // reach the already-open page through the host-owned refresh behavior.
      const liveBrowser = await browser.newContext();
      try {
        const page = await liveBrowser.newPage();
        await page.goto(origin!);
        await expect(page.getByText("niceeval report fixture copy text", { exact: true })).toBeVisible();
        const tablist = page.getByRole("tablist");
        await expect(tablist).toBeVisible();
        const overviewTab = tablist.getByRole("tab", { name: "Fixture overview", selected: true });
        const detailsTab = tablist.getByRole("tab", { name: "Fixture details" });
        await expect(overviewTab).toBeVisible();
        await detailsTab.click();
        await expect(tablist.getByRole("tab", { name: "Fixture details", selected: true })).toBeVisible();
        await expect(page.getByText("Fixture details tab content", { exact: true })).toBeVisible();
        await expect(page.getByText("Fixture overview tab content", { exact: true })).toBeHidden();
        await detailsTab.press("ArrowLeft");
        await expect(tablist.getByRole("tab", { name: "Fixture overview", selected: true })).toBeVisible();
        await expect(page.getByText("Fixture overview tab content", { exact: true })).toBeVisible();
        await expect(page.getByText("Fixture details tab content", { exact: true })).toBeHidden();

        const componentPath = join(projectRoot, "reports", "site-copy-block.ts");
        const component = await readFile(componentPath, "utf8");
        const refreshedMarker = "live view refresh marker 981";
        const refreshedComponent = component.replace("niceeval report fixture copy text", refreshedMarker);
        if (refreshedComponent === component) {
          throw new Error("the watched Report component no longer contains its refresh marker");
        }
        await writeFile(componentPath, refreshedComponent, "utf8");

        await expect(page.getByText(refreshedMarker, { exact: true })).toBeVisible({ timeout: 15_000 });
      } finally {
        await liveBrowser.close();
      }
    },
  );
});

async function expectSameBody(staticUrl: URL, liveUrl: URL): Promise<void> {
  const expected = await readFile(fileURLToPath(staticUrl));
  const response = await fetch(liveUrl);
  expect(response.status, `${liveUrl} should serve the exported body`).toBe(200);
  // Headers and a view-only refresh transport are intentionally outside this
  // oracle; the publicly delivered bytes must still be identical.
  expect(Buffer.from(await response.arrayBuffer()), `${liveUrl} body`).toEqual(expected);
}

function detailKind(label: string): DetailKind {
  const matched = /^(Source|Trace|Diff) detail /.exec(label);
  if (matched === null) throw new Error(`unexpected static detail link label: ${JSON.stringify(label)}`);
  return matched[1] as DetailKind;
}

async function waitForHttp(origin: string, label: string): Promise<void> {
  await pollUntil(
    async () => {
      try {
        return (await fetch(origin)).status === 200 ? true : undefined;
      } catch {
        return undefined;
      }
    },
    { timeoutMs: 15_000, intervalMs: 100, label },
  );
}
