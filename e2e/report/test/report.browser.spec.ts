// owner: docs/engineering/testing/e2e/report.md#report-browser-journey
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts
//
// The Journey uses only the installed candidate CLI, exported files, real HTTP,
// href navigation, and browser-visible content. It deliberately
// does not inspect renderer classes, layout, paint, CSS selectors, or Record files.

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

type DetailKind = "Source" | "Diff" | "Slot";

test("静态站与 view 对同一用户路由交付相同字节，且离线无 JavaScript 仍可浏览", async ({ browser }) => {
  test.setTimeout(120_000);

  await reportE2E.case(
    "browser-static-site",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const mainRun = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(mainRun.expReceipt(), mainRun.diagnostic()).toMatchObject({ completion: "completed" });
      const sourceRun = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(sourceRun.expReceipt(), sourceRun.diagnostic()).toMatchObject({ completion: "completed" });
      const slotCount = mainRun.expEvalEvents().length + sourceRun.expEvalEvents().length;
      expect(slotCount, mainRun.diagnostic()).toBeGreaterThan(0);

      const exported = await niceeval.run([
        "view",
        "--report",
        "./reports/site.tsx",
        "--out",
        "site-export",
        "--no-open",
      ]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const view = niceeval.start(
        [
          "view",
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
        label: "static-equivalent view URL",
      });
      const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(origin, startup).toBeDefined();
      await waitForHttp(origin!, "static-equivalent view readiness");

      const staticRoot = pathToFileURL(join(projectRoot, "site-export", "index.html"));
      await expectSameBody(staticRoot, new URL(origin!));

      const offline = await browser.newContext({ javaScriptEnabled: false });
      try {
        await offline.setOffline(true);
        const page = await offline.newPage();
        await page.goto(staticRoot.href);
        await expect(page.getByRole("heading", { name: "Fixture overview" })).toBeVisible();
        const staticSiteText = visibleText(page, "Report fixture static site");
        await expect(staticSiteText).toHaveCount(1);
        await expect(staticSiteText).toBeVisible();
        const overviewTabText = visibleText(page, "Fixture overview tab content");
        await expect(overviewTabText).toHaveCount(1);
        await expect(overviewTabText).toBeVisible();
        // Native disclosure: only the first tab is open without JavaScript.
        const fixtureDetailsTab = page.locator("details").filter({
          hasText: "Fixture details tab content",
        }).filter({ visible: true });
        await expect(fixtureDetailsTab).toHaveCount(1);
        await expect(visibleText(page, "Fixture details tab content")).toHaveCount(0);
        await fixtureDetailsTab.locator(":scope > summary").click();
        await expect(fixtureDetailsTab).toHaveAttribute("open", "");
        const expandedDetailsText = visibleText(page, "Fixture details tab content");
        await expect(expandedDetailsText).toHaveCount(1);
        await expect(expandedDetailsText).toBeVisible();

        const detailLinks = await Promise.all(
          (await page.getByRole("link", { name: /^(?:Source|Diff) detail$|^Slot detail / }).all()).map(async (link) => {
            const href = await link.getAttribute("href");
            if (href === null) throw new Error("a visible static detail link has no href");
            return { href, label: await link.innerText() };
          }),
        );
        expect(detailLinks.filter(({ label }) => detailKind(label) === "Slot")).toHaveLength(slotCount);
        expect([...new Set(detailLinks.map(({ label }) => detailKind(label)))].sort()).toEqual(
          ["Diff", "Slot", "Source"],
        );

        for (const detail of detailLinks) {
          const kind = detailKind(detail.label);
          const staticUrl = new URL(detail.href, staticRoot);
          const liveUrl = new URL(detail.href, origin!);
          await expectSameBody(staticUrl, liveUrl);

          // The href is a shareable exported location, not an in-memory router state.
          await page.goto(staticUrl.href);
          const heading = kind === "Slot"
            ? page.getByRole("heading", { name: /^Slot fixture detail slot-/ })
            : page.getByRole("heading", { name: new RegExp(`^${kind} fixture detail$`) });
          await expect(heading).toBeVisible();
          const sharedUrl = page.url();
          await page.reload();
          expect(page.url()).toBe(sharedUrl);
          await expect(heading).toBeVisible();
        }

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
        await expect(page.getByRole("heading", { name: "Fixture overview" })).toBeVisible();
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
        const slotDetail = page.getByRole("link", { name: /^Slot detail / }).first().filter({ visible: true });
        await expect(slotDetail).toBeVisible();
        await slotDetail.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: /^Slot fixture detail slot-/ })).toBeVisible();
        const nestedSource = dialog.getByRole("link", { name: "Source from slot detail" });
        const sourceUrl = new URL("/source/index.html", origin!).href;
        // This is a relative href in the fetched slot document. The dialog
        // must preserve that detail document as the base before insertion.
        await expect(nestedSource).toHaveAttribute("href", sourceUrl);
        await Promise.all([
          page.waitForURL(sourceUrl),
          nestedSource.click(),
        ]);
        await expect(page.getByRole("heading", { name: "Source fixture detail" })).toBeVisible();

        await page.goto(origin!);
        const initialCopy = visibleText(page, "niceeval report fixture copy text");
        await expect(initialCopy).toHaveCount(1);
        await expect(initialCopy).toBeVisible();
        const overviewTab = page.locator("details").filter({
          hasText: "Fixture overview tab content",
        }).filter({ visible: true });
        const detailsTab = page.locator("details").filter({
          hasText: "Fixture details tab content",
        }).filter({ visible: true });
        await expect(overviewTab).toHaveCount(1);
        await expect(overviewTab).toHaveAttribute("open", "");
        await expect(detailsTab).toHaveCount(1);
        await expect(detailsTab).not.toHaveAttribute("open", "");
        await detailsTab.locator(":scope > summary").click();
        await expect(detailsTab).toHaveAttribute("open", "");
        await expect(overviewTab).not.toHaveAttribute("open", "");
        const selectedDetailsText = visibleText(page, "Fixture details tab content");
        await expect(selectedDetailsText).toHaveCount(1);
        await expect(selectedDetailsText).toBeVisible();
        await expect(visibleText(page, "Fixture overview tab content")).toHaveCount(0);

        const componentPath = join(projectRoot, "reports", "site-copy-block.tsx");
        const component = await readFile(componentPath, "utf8");
        const refreshedMarker = "live view refresh marker 981";
        const refreshedComponent = component.replace("niceeval report fixture copy text", refreshedMarker);
        if (refreshedComponent === component) {
          throw new Error("the watched Report component no longer contains its refresh marker");
        }
        await writeFile(componentPath, refreshedComponent, "utf8");

        const refreshedCopy = visibleText(page, refreshedMarker);
        await expect(refreshedCopy).toHaveCount(1, { timeout: 15_000 });
        await expect(refreshedCopy).toBeVisible();
      } finally {
        await liveBrowser.close();
      }
    },
  );
});

test("经典 MemoryBench 报告支持筛选、原生展开、详情下钻与语言切换", async ({ browser }) => {
  test.setTimeout(180_000);

  await reportE2E.case(
    "browser-classic-surface",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      for (const experimentId of ["classic/baseline", "classic/memory-a", "classic/memory-b"] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      }

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
        { timeoutMs: 60_000 },
      );
      const startup = await waitForOutput(view, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
        timeoutMs: 30_000,
        label: "classic surface view URL",
      });
      const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(origin, startup).toBeDefined();
      await waitForHttp(origin!, "classic surface view readiness");

      const page = await browser.newPage();
      try {
        await page.goto(new URL("/overview", origin!).href);
        await expect(page.getByRole("heading", { name: "MemoryBench Classic" })).toBeVisible();

        const filter = page.getByRole("searchbox").filter({ visible: true });
        await expect(filter).toHaveCount(1);
        await expect(filter).toBeVisible();
        const experimentTable = filter.locator("..").getByRole("table");
        await expect(experimentTable).toHaveCount(1);
        await filter.fill("classic/memory-a");
        const memoryA = experimentTable.locator("summary").filter({
          hasText: "classic/memory-a",
        }).filter({ visible: true });
        await expect(memoryA).toHaveCount(1);
        await expect(memoryA).toBeVisible();
        const baseline = experimentTable.locator("summary").filter({
          hasText: "classic/baseline",
        }).filter({ visible: true });
        await expect(baseline).toHaveCount(0);
        await filter.fill("");

        const group = experimentTable.locator("details").filter({
          hasText: "classic/memory-a",
        }).filter({ visible: true });
        await expect(group).toHaveCount(1);
        await expect(group).toBeVisible();
        const groupSummary = group.locator(":scope > summary");
        await groupSummary.focus();
        await groupSummary.press("Space");
        await expect(group).toHaveAttribute("open", "");

        const evalGroupSummary = group.locator("summary").filter({
          hasText: "classic (8 evals)",
        }).filter({ visible: true });
        await expect(evalGroupSummary).toHaveCount(1);
        const evalGroup = evalGroupSummary.locator("..");
        await expect(evalGroup).toHaveCount(1);
        await expect(evalGroup).toBeVisible();
        await evalGroupSummary.focus();
        await evalGroupSummary.press("Space");
        await expect(evalGroup).toHaveAttribute("open", "");

        const evalRowSummary = evalGroup.locator("summary").filter({
          hasText: "recall-constraint",
        }).filter({ visible: true });
        await expect(evalRowSummary).toHaveCount(1);
        const evalRow = evalRowSummary.locator("..");
        await expect(evalRow).toHaveCount(1);
        await evalRowSummary.focus();
        await evalRowSummary.press("Space");
        await expect(evalRow).toHaveAttribute("open", "");

        const attemptLink = evalRow.getByRole("link").filter({
          visible: true,
        });
        await expect(attemptLink).toHaveCount(1);
        await expect(attemptLink).toBeVisible();
        const href = await attemptLink.getAttribute("href");
        if (href === null) throw new Error("an expanded attempt row has no detail href");
        const detail = new URL(href, page.url());
        expect(detail.pathname).toMatch(/^\/attempt\/a1[0-9a-hjkmnp-tv-z]{12}\/index\.html$/);

        // The JavaScript enhancement opens the Host-owned detail dialog around
        // the same href instead of leaving the overview page.
        await attemptLink.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/^@[0-9A-Z]+$/).first()).toBeVisible();
        await expect(dialog.getByText(/^source · execution · timing(?: · diff)?$/).filter({ visible: true })).toBeVisible();
        await expect(dialog.getByText("Assessment evidence", { exact: true })).toHaveCount(0);
        await expect(dialog.getByText(/^\{\"groupPath\":/)).toHaveCount(0);
        const sendLine = dialog.locator("details.niceeval-source-line--send").filter({ visible: true });
        await expect(sendLine).toHaveCount(1);
        await expect(sendLine).not.toHaveAttribute("open", "");
        await sendLine.locator(":scope > summary").click();
        await expect(sendLine).toHaveAttribute("open", "");
        await expect(sendLine.getByText("Duration", { exact: true })).toBeVisible();
        await expect(sendLine.getByText("Turns", { exact: true })).toBeVisible();
        await expect(sendLine.getByText("Calls", { exact: true })).toBeVisible();
        await expect(sendLine.locator(".niceeval-conversation-turn-head")).toBeVisible();
        const trace = sendLine.locator("[data-niceeval-turn-trace]");
        const traceRows = trace.locator("[data-niceeval-trace-event]");
        const firstTraceRow = traceRows.nth(0);
        const secondTraceRow = traceRows.nth(1);
        const thirdTraceRow = traceRows.nth(2);
        const firstTraceEvidence = firstTraceRow.locator("[data-niceeval-trace-evidence]");
        const secondTraceEvidence = secondTraceRow.locator("[data-niceeval-trace-evidence]");
        const thirdTraceEvidence = thirdTraceRow.locator("[data-niceeval-trace-evidence]");
        await expect(firstTraceEvidence).not.toHaveAttribute("open", "");
        await firstTraceRow.locator("[data-niceeval-trace-select]").click();
        await expect(firstTraceEvidence).toHaveAttribute("open", "");
        await expect(firstTraceRow.locator("[data-niceeval-trace-select]")).toHaveAttribute("aria-expanded", "true");
        await secondTraceRow.locator("[data-niceeval-trace-select]").click();
        await expect(firstTraceEvidence).not.toHaveAttribute("open", "");
        await expect(secondTraceEvidence).toHaveAttribute("open", "");
        await expect(secondTraceEvidence.locator("[data-tool-evidence-kind='command']")).toBeVisible();
        expect(await secondTraceEvidence.locator(".niceeval-tool-evidence-code").textContent()).toBe(
          "printf 'classic/recall-constraint: recalled=true\\n' > memory-note.txt",
        );
        await thirdTraceRow.locator("[data-niceeval-trace-select]").click();
        await expect(secondTraceEvidence).not.toHaveAttribute("open", "");
        await expect(thirdTraceEvidence).toHaveAttribute("open", "");
        await expect(thirdTraceRow.locator(".niceeval-trace-event-summary")).toHaveText("command_execution result");
        await expect(thirdTraceEvidence.locator("[data-tool-evidence-kind='terminal']")).toBeVisible();
        await expect(thirdTraceEvidence.getByText("Exit 0", { exact: true })).toBeVisible();
        expect(await thirdTraceEvidence.locator(".niceeval-tool-evidence-code").nth(0).textContent()).toBe(
          "wrote memory-note.txt\nclassic/recall-constraint: recalled=true\n",
        );
        expect(await thirdTraceEvidence.locator(".niceeval-tool-evidence-code").nth(1).textContent()).toBe(
          '{\n  "written": true,\n  "recalled": true\n}',
        );
        await thirdTraceEvidence.getByRole("tab", { name: "Raw" }).click();
        await expect(thirdTraceEvidence.getByRole("tab", { name: "Raw" })).toHaveAttribute("aria-selected", "true");
        await expect(thirdTraceEvidence.locator("[data-niceeval-trace-evidence-panel='raw']")).toBeVisible();
        expect(await thirdTraceEvidence.locator(".niceeval-trace-evidence-raw").textContent()).toBe(
          '{"output":"wrote memory-note.txt\\nclassic/recall-constraint: recalled=true\\n","exit_code":0,"written":true,"recalled":true}',
        );
        const deepLink = page.url();
        expect(new URL(deepLink).hash).toMatch(/^#\/attempt\/a1[0-9a-hjkmnp-tv-z]{12}$/);
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        expect(new URL(page.url()).hash).toBe("");

        // The legacy URL contract survives the new closed-site host: opening
        // its hash directly restores the same dialog, and reload keeps it.
        await page.goto(deepLink);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/^@[0-9A-Z]+$/).first()).toBeVisible();
        await page.reload();
        expect(page.url()).toBe(deepLink);
        await expect(dialog).toBeVisible();
        await page.goBack();
        await expect(dialog).not.toBeVisible();

        // The href stays a real standalone route: direct navigation reads the
        // same closed detail document.
        await page.goto(detail.href);
        await expect(page.getByText(/^@[0-9A-Z]+$/).first()).toBeVisible();
        await expect(page.getByText(/^source · execution · timing(?: · diff)?$/).filter({ visible: true })).toBeVisible();

        await page.goto(new URL("/overview", origin!).href);
        const scatter = page.getByRole("img", { name: "costUSD × passRate" }).filter({ visible: true });
        await expect(scatter).toHaveCount(1);
        await expect(scatter).toContainText("classic/memory-a");
        const zhButton = page.getByRole("button", { name: "中文" }).filter({ visible: true });
        await expect(zhButton).toHaveCount(1);
        await expect(zhButton).toBeVisible();
        await zhButton.click();
        await expect(page.getByText("总览", { exact: true })).toBeVisible();
        await expect(zhButton).toHaveAttribute("aria-pressed", "true");
      } finally {
        await page.close();
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
  const matched = /^(Source|Diff|Slot) detail(?: |$)/.exec(label);
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

function visibleText(page: import("@playwright/test").Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}
