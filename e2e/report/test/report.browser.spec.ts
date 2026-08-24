// owner: docs/engineering/testing/e2e/report.md#report-browser-journey
// regression: memory/report-header-experiment-selector-regression.md
// rerun: pnpm e2e test --repo report -- --run test/report.browser.spec.ts
//
// This Journey observes only the installed candidate, exported files, HTTP,
// hash navigation, and browser-visible content. It never reads Record files.

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { createServer, type Server } from "node:http";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

test("静态站与 view 只交付 SPA shell；普通页面使用 hash 和 fragment，缺少 JavaScript 时明确报错", async ({ browser }) => {
  test.setTimeout(120_000);
  await reportE2E.case(
    "browser-static-spa-site",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      for (const id of ["main", "source"] as const) {
        const run = await niceeval.run(["exp", id, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      }
      const exported = await niceeval.run(["view", "--report", "./reports/site.tsx", "--out", "site-export", "--no-open"]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const exportRoot = join(projectRoot, "site-export");
      await expect(readFile(join(exportRoot, "index.html"), "utf8")).resolves.toContain('src="_niceeval/app.js"');
      expect(await htmlFiles(exportRoot)).toEqual(["index.html"]);

      const live = niceeval.start(
        ["view", "--report", "./reports/site.tsx", "--host", "127.0.0.1", "--port", "0", "--no-open"],
        { timeoutMs: 60_000 },
      );
      const startup = await waitForOutput(live, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
        timeoutMs: 30_000, label: "SPA view URL",
      });
      const liveOrigin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(liveOrigin, startup).toBeDefined();
      await waitForHttp(liveOrigin!, "SPA view readiness");
      await expectSameBody(new URL(liveOrigin!), pathToFileURL(join(exportRoot, "index.html")));

      // Exact-file-only HTTP: no /source rewrite exists or is needed for a hash route.
      const staticServer = await serveStaticDirectory(exportRoot);
      try {
        const page = await browser.newPage();
        try {
          await page.goto(new URL("index.html", staticServer.origin).href);
          await expect(page.getByRole("heading", { name: "Fixture overview" })).toBeVisible();
          await expect(page.getByRole("combobox", { name: "Experiments" })).toHaveCount(0);
          const fragment = page.waitForRequest((request) =>
            request.url() === new URL("_niceeval/fragments/source.json", staticServer.origin).href,
          );
          await page.getByRole("link", { name: "Source detail" }).click();
          await expect(page).toHaveURL(/#\/source$/);
          await fragment;
          await expect(page.getByRole("heading", { name: "Source fixture detail" })).toBeVisible();

          const copiedUrl = page.url();
          await page.reload();
          expect(page.url()).toBe(copiedUrl);
          await expect(page.getByRole("heading", { name: "Source fixture detail" })).toBeVisible();
        } finally {
          await page.close();
        }
        const offline = await browser.newContext({ javaScriptEnabled: false });
        try {
          const page = await offline.newPage();
          await page.goto(new URL("index.html#/source", staticServer.origin).href);
          await expect(page.getByRole("heading", { name: "JavaScript required" })).toBeVisible();
          await expect(page.getByRole("alert")).toContainText("Enable JavaScript to view this NiceEval report.");
          await expect(page.getByRole("heading", { name: "Source fixture detail" })).not.toBeVisible();
        } finally {
          await offline.close();
        }
      } finally {
        await staticServer.close();
      }
    },
  );
});

test("经典报告默认并切换实验组，Attempt 作为可分享、可关闭并保留历史的 overlay", async ({ browser }) => {
  test.setTimeout(180_000);
  await reportE2E.case(
    "browser-classic-attempt-overlay",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(
        join(projectRoot, "experiments", "classic.ts"),
        `import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

const agent = deterministicAgent("report-group-label-collision", 0.00002);

export default defineExperiment({
  description: "classic: root Experiment that shares a label with the classic/* named group",
  agent,
  model: "report-fixture-v1",
  evals: ["deliberate-fail"],
});
`,
        "utf8",
      );
      for (const id of [
        "classic/baseline",
        "classic/memory-a",
        "classic/incompatible",
      ] as const) {
        const run = await niceeval.run(["exp", id, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      }
      const view = niceeval.start(["view", "--host", "127.0.0.1", "--port", "0", "--no-open"], { timeoutMs: 60_000 });
      const startup = await waitForOutput(view, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
        timeoutMs: 30_000, label: "classic SPA view URL",
      });
      const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(origin, startup).toBeDefined();
      await waitForHttp(origin!, "classic SPA view readiness");

      const page = await browser.newPage();
      try {
        await page.goto(origin!);
        await expect(page).toHaveURL(/#\/group\/named\/classic$/);
        await expect(page.getByRole("heading", { name: "NiceEval overview" })).toBeVisible();

        // A single group is still the default comparison, without wasting
        // Header space on a one-option selector.
        await expect(page.getByRole("combobox", { name: "Experiments" })).toHaveCount(0);

        // Adding a root Experiment creates a legal label collision with the
        // classic/* named group. The live revision exposes two unambiguous,
        // stable options and keeps the current group selected.
        const collisionRun = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"]);
        expect(collisionRun.expReceipt(), collisionRun.diagnostic()).toMatchObject({ completion: "completed" });
        const experimentSelector = page.getByRole("combobox", { name: "Experiments" });
        await expect(experimentSelector).toBeVisible({ timeout: 15_000 });
        await expect(experimentSelector.getByRole("option")).toHaveText([
          "named/classic",
          "singleton/classic",
        ]);
        await expect(experimentSelector).toHaveValue("/group/named/classic");

        const comboboxes = page.getByRole("combobox");
        await expect(comboboxes).toHaveCount(2);
        await expect(comboboxes.nth(0)).toHaveAccessibleName("Experiments");
        await expect(comboboxes.nth(1)).toHaveAccessibleName("Language");

        const overview = page.getByRole("link", { name: "Overview" });
        await expect(overview).toHaveAttribute("href", "#/group/named/classic");
        await expect(overview).toHaveAttribute("aria-current", "page");

        await experimentSelector.selectOption("/group/singleton/classic");
        await expect(page).toHaveURL(/#\/group\/singleton\/classic$/);
        await expect(experimentSelector).toHaveValue("/group/singleton/classic");
        await expect(page.getByText("classic (1/1)", { exact: true })).toBeVisible();

        await page.goBack();
        await expect(page).toHaveURL(/#\/group\/named\/classic$/);
        await expect(experimentSelector).toHaveValue("/group/named/classic");
        await expect(page.getByText("classic/memory-a (9/9)", { exact: true })).toBeVisible();
        await page.goForward();
        await expect(page).toHaveURL(/#\/group\/singleton\/classic$/);
        await expect(experimentSelector).toHaveValue("/group/singleton/classic");

        await experimentSelector.selectOption("/group/named/classic");
        await expect(page).toHaveURL(/#\/group\/named\/classic$/);
        const englishRoute = page.url();
        const languageSelector = page.getByRole("combobox", { name: "Language" });
        await languageSelector.selectOption("zh-CN");
        expect(page.url()).toBe(englishRoute);
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        await expect(page.getByRole("combobox", { name: "实验" })).toHaveValue("/group/named/classic");
        await expect(page.getByRole("link", { name: "总览" })).toHaveAttribute("href", "#/group/named/classic");
        await languageSelector.selectOption("en");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");

        const experiment = page.locator('a[href^="#/experiment/"]').filter({
          has: page.locator("title").filter({ hasText: "classic/memory-a" }),
        });
        const experimentSummary = page.locator("summary").filter({
          has: page.getByText("classic/memory-a (9/9)", { exact: true }),
        });
        await expect(experimentSummary).toHaveCount(1);
        await expect(experimentSummary).toContainText("classic/memory-a (9/9)");
        expect((await experimentSummary.textContent())?.match(/9\/9/g)).toHaveLength(1);
        const expandedExperiment = experimentSummary.locator("..");
        await experimentSummary.click();
        await expect(expandedExperiment).toHaveAttribute("open", "");
        const dialog = page.getByRole("dialog");
        const scoreExperimentSummary = page.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^classic\/incompatible /,
        });
        await expect(scoreExperimentSummary).toHaveCount(1);
        await expect(scoreExperimentSummary).toContainText("classic/incompatible (1/1)");
        await expect(scoreExperimentSummary).toContainText("7");
        await expect(scoreExperimentSummary).not.toContainText("missed check");
        await expect(scoreExperimentSummary).not.toContainText("passed");

        await experiment.click();
        await expect(page).toHaveURL(/#\/experiment\//);
        await expect(dialog).toBeVisible();
        // regression: memory/react19-dangerously-set-inner-html-identity.md
        await expect(expandedExperiment).toHaveAttribute("open", "");

        const attempt = page.locator('a[href^="#/attempt/"]').filter({ visible: true }).first();
        await expect(attempt).toBeVisible();
        const href = await attempt.getAttribute("href");
        expect(href).toMatch(/^#\/attempt\/a1[0-9a-hjkmnp-tv-z]{12}$/);
        const route = href!.slice(1);
        const detail = new URL(`_niceeval/fragments${route}.json`, origin!);

        const overlayRequests: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.includes("/_niceeval/fragments/"))
            overlayRequests.push(request.url());
        });

        let detailRequested!: () => void;
        const requested = new Promise<void>((done) => { detailRequested = done; });
        let releaseDetail!: () => void;
        const released = new Promise<void>((done) => { releaseDetail = done; });
        let detailContinued!: () => void;
        const continued = new Promise<void>((done) => { detailContinued = done; });
        await page.route(detail.href, async (request) => {
          detailRequested();
          await released;
          await request.continue();
          detailContinued();
        });
        try {
          await attempt.click();
          await requested;
          await expect(page).toHaveURL(new RegExp(`#${route}$`));
          await expect(dialog).toBeVisible();
          await expect(dialog.getByRole("status")).toContainText("Loading details…");
          await expect(
            page.locator("h1", { hasText: "NiceEval overview" }),
          ).toBeVisible();
        } finally {
          releaseDetail();
          await continued;
          await page.unroute(detail.href);
        }
        await expect(dialog.getByText(/^@[0-9A-Z]+$/).first()).toBeVisible();

        const assertionLine = dialog.locator("summary").filter({ hasText: "t.check(t.reply" }).first();
        await assertionLine.click();
        const rootMatch = dialog.getByLabel(/^and\(includes.+: matched$/).first();
        await expect(rootMatch).toBeVisible();
        await rootMatch.click();
        const orMatch = dialog.getByLabel(/^or\(includes.+: matched$/).first();
        await expect(orMatch).toBeVisible();
        await orMatch.click();
        const orNode = orMatch.locator("xpath=..");
        await expect(orNode.getByLabel('includes("RECALL_OK"): matched')).toBeVisible();
        await expect(orNode.getByLabel('includes("NEVER_PRESENT"): mismatched')).toBeVisible();

        const copiedUrl = page.url();
        await page.getByRole("button", { name: "Close" }).click();
        await expect(dialog).not.toBeVisible();
        expect(new URL(page.url()).hash).toBe("#/group/named/classic");
        expect(overlayRequests).toEqual([detail.href]);

        await page.goForward();
        await expect(dialog).toBeVisible();
        await page.goBack();
        await expect(dialog).not.toBeVisible();
        await page.goForward();
        await expect(dialog).toBeVisible();
        await page.reload();
        expect(page.url()).toBe(copiedUrl);
        await expect(dialog).toBeVisible();

        // Pasting the copied hash restores an overlay over the report, never a
        // separate Attempt document.
        const shared = await browser.newPage();
        try {
          await shared.goto(copiedUrl);
          await expect(shared.getByRole("dialog")).toBeVisible();
          await expect(shared.getByRole("heading", { name: "NiceEval overview" })).toBeVisible();
          await shared.getByRole("button", { name: "Close" }).click();
          await expect(shared.getByRole("dialog")).not.toBeVisible();
          await expect(shared).toHaveURL(/#\/group\/named\/classic$/);
          const directSelector = shared.getByRole("combobox", { name: "Experiments" });
          await expect(directSelector).toHaveValue("/group/named/classic");
          await directSelector.selectOption("/group/singleton/classic");
          await expect(shared).toHaveURL(/#\/group\/singleton\/classic$/);
          await expect(shared.getByRole("dialog")).not.toBeVisible();
        } finally {
          await shared.close();
        }

        await page.mouse.click(5, 5);
        await expect(dialog).not.toBeVisible();
        expect(new URL(page.url()).hash).toBe("#/group/named/classic");

        const baselineSummary = page.locator("summary").filter({ hasText: /^classic\/baseline \(9\/9\)/ }).first();
        if (await baselineSummary.locator("xpath=..").getAttribute("open") === null) await baselineSummary.click();
        const classicSummary = page.locator("summary").filter({ hasText: /^classic \(8 evals\)/ }).first();
        if (await classicSummary.locator("xpath=..").getAttribute("open") === null) await classicSummary.click();
        const toolEvalSummary = page.locator("summary").filter({ hasText: /^tool-note/ }).first();
        if (await toolEvalSummary.locator("xpath=..").getAttribute("open") === null) await toolEvalSummary.click();
        const toolAttemptHref = await toolEvalSummary.locator("xpath=..").locator('a[href^="#/attempt/"]').first().getAttribute("href");
        expect(toolAttemptHref).toMatch(/^#\/attempt\//);
        await page.goto(new URL(toolAttemptHref!, origin!).href);
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        const toolAssertion = dialog.locator("summary").filter({ hasText: 'calledTool("write_note"' }).first();
        await expect(toolAssertion).toBeVisible({ timeout: 5_000 });
        if (await toolAssertion.locator("xpath=..").getAttribute("open") === null) await toolAssertion.click();
        const toolMatcher = dialog.getByLabel(/calledTool.+: mismatched$/).filter({ visible: true }).first();
        await expect(toolMatcher).toBeVisible({ timeout: 5_000 });
        await toolMatcher.click();
        await expect(dialog.getByRole("heading", { name: "Tool calls" })).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByText('exactly 1 × toolMatch("write_note")', { exact: true })).toBeVisible();
        await expect(dialog.getByText("0 definite matches", { exact: true })).toBeVisible();

        const commandAssertion = dialog.locator("summary").filter({ hasText: "t.check({" }).first();
        await expect(commandAssertion).toBeVisible({ timeout: 5_000 });
        if (await commandAssertion.locator("xpath=..").getAttribute("open") === null) await commandAssertion.click();
        const commandMatcher = dialog.getByLabel("commandSucceeded(): matched").filter({ visible: true });
        await expect(commandMatcher).toBeVisible({ timeout: 5_000 });
        await commandMatcher.click();
        await expect(dialog.getByRole("heading", { name: "Command result" })).toBeVisible();
        await expect(dialog.getByText("pnpm test", { exact: true })).toBeVisible();
        await expect(dialog.getByText("Exit code 0", { exact: true })).toBeVisible();
        await expect(dialog.getByText("PASS src/example.test.ts", { exact: true })).not.toBeVisible();

      } finally {
        await page.close();
      }
    },
  );
});

async function expectSameBody(liveUrl: URL, staticUrl: URL): Promise<void> {
  const expected = await readFile(staticUrl);
  const response = await fetch(liveUrl);
  expect(response.status, `${liveUrl} should serve the exported shell`).toBe(200);
  expect(Buffer.from(await response.arrayBuffer()), `${liveUrl} body`).toEqual(expected);
}

async function htmlFiles(root: string): Promise<readonly string[]> {
  const paths: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith(".html")) paths.push(relative(root, file));
    }
  }
  await visit(root);
  return paths.sort();
}

async function waitForHttp(origin: string, label: string): Promise<void> {
  await pollUntil(async () => {
    try {
      return (await fetch(origin)).status === 200 ? true : undefined;
    } catch {
      return undefined;
    }
  }, { timeoutMs: 15_000, intervalMs: 100, label });
}

async function serveStaticDirectory(root: string): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  const absoluteRoot = resolve(root);
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://static.invalid").pathname);
    const file = resolve(absoluteRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (file !== absoluteRoot && !file.startsWith(`${absoluteRoot}/`)) return void response.writeHead(403).end();
    try {
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      const mediaType = file.endsWith(".html") ? "text/html; charset=utf-8"
        : file.endsWith(".js") ? "text/javascript; charset=utf-8"
        : file.endsWith(".css") ? "text/css; charset=utf-8"
        : file.endsWith(".json") ? "application/json; charset=utf-8"
        : "application/octet-stream";
      response.writeHead(200, { "content-type": mediaType }).end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("static server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}/`, close: () => closeServer(server) };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((done, reject) => server.close((error) => error === undefined ? done() : reject(error)));
}
