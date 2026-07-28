/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import { SITE_REPORT, type ReportComponentScenario } from "./harness.ts";

export const attemptListScenarios: readonly ReportComponentScenario[] = [
  {
    name: "AttemptList · CLI 列出完整公开 locator",
    // 场景：用户从自定义报告浏览本次运行的全部 attempt。
    // Given：main 有两轮，deliberate-fail/error 各一轮。
    // When：用户用 show 打开 Attempts 页。
    // Then：四个公开 locator 全部可见。
    async run({ evidence }) {
      const out = sh(
        `pnpm exec niceeval show --report ${SITE_REPORT} --results ${evidence.resultsRoot} --page attempts`,
      );
      const attempts = [
        ...evidence.main.attempts,
        evidence.deliberateFail.attempt,
        evidence.deliberateError.attempt,
      ];
      for (const attempt of attempts) {
        assert.ok(out.includes(attempt.locator), `Attempts 页缺少 locator ${attempt.locator}`);
      }
    },
  },
  {
    name: "AttemptList · 用户按 eval id 过滤",
    // 场景：用户只想看 deliberate-fail。
    // Given：AttemptList 初始显示四个 attempt。
    // When：用户在过滤框输入 deliberate-fail。
    // Then：只剩一个匹配行，其余三行不可见。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Attempts" }).click();
        const panel = page.locator("#tab-page-attempts");
        await panel.locator(".niceeval-attempt").first().waitFor({ state: "visible", timeout: 10_000 });
        assert.equal(await panel.locator(".niceeval-attempt").count(), 4);
        const filter = panel.locator("input[data-niceeval-attempt-filter]");
        await filter.fill("deliberate-fail");
        await page.waitForTimeout(100);
        assert.equal(await panel.locator(".niceeval-attempt:not(.niceeval-row-hidden)").count(), 1);
        assert.equal(await panel.locator(".niceeval-attempt.niceeval-row-hidden").count(), 3);
      } finally {
        await page.close();
      }
    },
  },
];
