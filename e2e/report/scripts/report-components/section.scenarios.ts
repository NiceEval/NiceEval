/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import { SITE_REPORT, type ReportComponentScenario } from "./harness.ts";

export const sectionScenarios: readonly ReportComponentScenario[] = [
  {
    name: "Section · CLI 呈现嵌套标题",
    // 场景：报告作者嵌套两个 Section。
    // Given：overview 声明 Run overview → Eval × agent。
    // When：用户用 show 打开 overview。
    // Then：两层标题都可见。
    async run({ evidence }) {
      const out = sh(`pnpm exec niceeval show --report ${SITE_REPORT} --results ${evidence.resultsRoot}`);
      assert.ok(out.includes("Run overview"), "外层 Section 标题应可见");
      assert.ok(out.includes("Eval × agent"), "嵌套 Section 标题应可见");
    },
  },
  {
    name: "Section · 浏览器保留嵌套结构",
    // 场景：用户在浏览器阅读嵌套 Section。
    // Given：overview 有两层命名区块。
    // When：浏览器渲染报告。
    // Then：两层标题各出现一次；不规定具体 CSS 布局机制。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const overview = page.locator("#tab-page-overview");
        assert.equal(await overview.locator(".niceeval-section-title", { hasText: "Run overview" }).count(), 1);
        assert.equal(await overview.locator(".niceeval-section-title", { hasText: "Eval × agent" }).count(), 1);
      } finally {
        await page.close();
      }
    },
  },
];
