/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import { SITE_REPORT, type ReportComponentScenario } from "./harness.ts";

export const gridStatScenarios: readonly ReportComponentScenario[] = [
  {
    name: "Grid/Stat · CLI 呈现统计标签",
    // 场景：报告作者把现算 ScopeSummary 放进 Grid/Stat。
    // Given：overview 声明四个统计格。
    // When：用户用 show 打开 overview。
    // Then：四个统计标签都可见。
    async run({ evidence }) {
      const out = sh(`pnpm exec niceeval show --report ${SITE_REPORT} --results ${evidence.resultsRoot}`);
      for (const label of ["Experiments", "Evals", "Attempts", "Pass rate"]) {
        assert.ok(out.includes(label), `Grid 应包含 Stat 标签 "${label}"`);
      }
    },
  },
  {
    name: "Grid/Stat · 浏览器显示现算值",
    // 场景：用户在浏览器阅读运行总览。
    // Given：Grid 的值来自 scopeSummaryData，而不是 fixture 文案。
    // When：浏览器打开 overview。
    // Then：四个统计值与真实 Evidence 的 3/3/4/33.3% 一致。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const stats = page.locator("#tab-page-overview .niceeval-stat");
        await stats.first().waitFor({ state: "visible", timeout: 10_000 });
        assert.equal(await stats.count(), 4);
        const values: Record<string, string> = {};
        for (let i = 0; i < (await stats.count()); i++) {
          const label = (await stats.nth(i).locator(".niceeval-stat-label").textContent())?.trim() ?? "";
          const value = (await stats.nth(i).locator(".niceeval-stat-value").textContent())?.trim() ?? "";
          values[label] = value;
        }
        assert.deepEqual(values, {
          Experiments: "3",
          Evals: "3",
          Attempts: "4",
          "Pass rate": "33.3%",
        });
      } finally {
        await page.close();
      }
    },
  },
];
