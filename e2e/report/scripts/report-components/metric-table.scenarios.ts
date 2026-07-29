/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import { SITE_REPORT, type ReportComponentScenario } from "./harness.ts";

export const metricTableScenarios: readonly ReportComponentScenario[] = [
  {
    name: "MetricTable · CLI 展示全部实验",
    // 场景：用户在终端对比三个实验。
    // Given：真实 Evidence 分别有 main、failed、errored 实验。
    // When：用户打开 scoreboard 页。
    // Then：Comparison 表包含全部实验。
    async run({ evidence }) {
      const out = sh(
        `pnpm exec niceeval show --report ${SITE_REPORT} --record ${evidence.resultsRoot} --page scoreboard`,
      );
      assert.ok(out.includes("Comparison"));
      for (const experimentId of ["main", "deliberate-error", "deliberate-fail"]) {
        assert.ok(out.includes(experimentId), `Comparison 应包含 experiment "${experimentId}"`);
      }
    },
  },
  {
    name: "MetricTable · 用户输入过滤词后收窄行",
    // 场景：用户在实验很多时过滤 MetricTable。
    // Given：表里初始有三个 experiment。
    // When：用户输入 main。
    // Then：可见行从三行收窄为唯一匹配行。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Scoreboard" }).click();
        const panel = page.locator("#tab-page-scoreboard");
        const filter = panel.locator("input[data-niceeval-filter]");
        await filter.waitFor({ state: "visible", timeout: 10_000 });
        assert.equal(await panel.locator(".niceeval-metric-table tbody tr:not(.niceeval-row-hidden)").count(), 3);
        await filter.fill("main");
        await page.waitForTimeout(100);
        assert.equal(await panel.locator(".niceeval-metric-table tbody tr:not(.niceeval-row-hidden)").count(), 1);
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "MetricTable · 多条指标证据默认紧凑且可展开下钻",
    // 场景：聚合指标携带多条 Attempt refs。
    // Given：scoreboard 的指标表由真实 Evidence 聚合而来。
    // When：用户查看指标格并展开证据入口。
    // Then：初始只显示一个带数量的入口，展开后每条证据仍是可下钻链接。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Scoreboard" }).click();
        const panel = page.locator("#tab-page-scoreboard");
        const disclosure = panel.locator("td details").first();
        await disclosure.waitFor({ state: "visible", timeout: 10_000 });
        assert.equal(await disclosure.getAttribute("open"), null);
        assert.match((await disclosure.locator("summary").textContent()) ?? "", /^\d+ attempts?$/);
        assert.equal(await disclosure.locator("a:visible").count(), 0, "收起时证据链接不应进入可见布局");

        await disclosure.locator("summary").click();
        assert.notEqual(await disclosure.getAttribute("open"), null);
        assert.ok((await disclosure.locator("a").count()) > 1, "展开后应保留每条 Attempt 下钻链接");
      } finally {
        await page.close();
      }
    },
  },
];
