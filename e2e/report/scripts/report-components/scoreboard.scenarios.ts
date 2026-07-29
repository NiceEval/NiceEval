/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import { SITE_REPORT, type ReportComponentScenario } from "./harness.ts";

export const scoreboardScenarios: readonly ReportComponentScenario[] = [
  {
    name: "Scoreboard · CLI 展示声明题集",
    // 场景：报告作者用 Scoreboard 固定题集。
    // Given：Scoreboard 声明 fullMarks=100。
    // When：用户从 CLI 打开 scoreboard 页。
    // Then：题集标题和满分口径可见。
    async run({ evidence }) {
      const out = sh(
        `pnpm exec niceeval show --report ${SITE_REPORT} --record ${evidence.resultsRoot} --page scoreboard`,
      );
      assert.ok(out.includes("Exam"));
      assert.ok(out.includes("/100"), "Scoreboard 应按声明的 fullMarks=100 显示总分");
    },
  },
  {
    name: "Scoreboard · 浏览器显示全部实验",
    // 场景：用户切换到 Scoreboard 页查看实验成绩。
    // Given：真实 Evidence 有三个 experiment。
    // When：用户点击 Scoreboard tab。
    // Then：Scoreboard 显示三行实验，不丢失 failed/errored 条件。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Scoreboard" }).click();
        const panel = page.locator("#tab-page-scoreboard");
        await panel.locator(".niceeval-scoreboard-table").waitFor({ state: "visible", timeout: 10_000 });
        assert.equal(await panel.locator(".niceeval-scoreboard-table tbody tr").count(), 3);
      } finally {
        await page.close();
      }
    },
  },
];
