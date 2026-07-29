/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import { SITE_REPORT, type ReportComponentScenario } from "./harness.ts";

export const metricMatrixScenarios: readonly ReportComponentScenario[] = [
  {
    name: "MetricMatrix · CLI 给出稀疏矩阵下钻提示",
    // 场景：用户从稀疏矩阵继续调查缺失数据。
    // Given：真实 Evidence 的 deliberate-error 行存在缺格。
    // When：用户用 show 打开 overview。
    // Then：矩阵给出公开、可复制的下钻命令。
    async run({ evidence }) {
      const out = sh(`pnpm exec niceeval show --report ${SITE_REPORT} --record ${evidence.resultsRoot}`);
      assert.ok(
        out.includes("deliberate-error"),
        `稀疏矩阵应露出 deliberate-error eval；got:\n${out}`,
      );
    },
  },
  {
    name: "MetricMatrix · 浏览器呈现矩阵",
    // 场景：报告作者在 overview 放置 MetricMatrix。
    // Given：矩阵有真实实验与 eval 数据。
    // When：浏览器渲染 overview。
    // Then：用户能看到一张指标矩阵。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        assert.equal(await page.locator("#tab-page-overview .niceeval-metric-matrix").count(), 1);
      } finally {
        await page.close();
      }
    },
  },
];
