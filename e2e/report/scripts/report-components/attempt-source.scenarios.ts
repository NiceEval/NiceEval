/// <reference lib="dom" />

import assert from "node:assert/strict";
import type { ReportComponentScenario } from "./harness.ts";

export const attemptSourceScenarios: readonly ReportComponentScenario[] = [
  {
    name: "AttemptSource · 失败行可收起并重新展开",
    // 场景：用户在 review dialog 中控制失败源码详情。
    // Given：唯一 gate-fail 行默认展开。
    // When：用户连续点击两次该行。
    // Then：第一次收起，第二次重新展开，失败内容始终可操作。
    async run({ evidence, browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Attempts" }).click();
        const href = `attempt/${encodeURIComponent(evidence.deliberateFail.attempt.locator)}.html`;
        await page.locator(`#tab-page-attempts a.niceeval-locator[href="${href}"]`).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        const badLine = dialog.locator("details.niceeval-source-line.niceeval-source-line--gate-fail");
        assert.equal(await badLine.count(), 1);
        assert.equal(await badLine.locator(".niceeval-source-gutter-mark").getAttribute("aria-label"), "failed");
        assert.equal(await badLine.getAttribute("open"), "");
        await badLine.locator(":scope > summary").click();
        assert.equal(await badLine.getAttribute("open"), null);
        await badLine.locator(":scope > summary").click();
        assert.equal(await badLine.getAttribute("open"), "");
      } finally {
        await page.close();
      }
    },
  },
];
