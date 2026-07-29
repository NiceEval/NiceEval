/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import {
  BRANDED_REPORT,
  SITE_REPORT,
  type ReportComponentScenario,
} from "./harness.ts";

export const attemptDetailScenarios: readonly ReportComponentScenario[] = [
  {
    name: "AttemptDetails · extends 继承内建失败详情",
    // 场景：用户给 standard 报告加外壳后继续下钻失败 attempt。
    // Given：branded.tsx 没有重写 attempt-input page。
    // When：用户用公开 locator 打开失败详情。
    // Then：内建详情仍显示 expected/received。
    async run({ evidence }) {
      const out = sh(
        `pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --report ${BRANDED_REPORT} --record ${evidence.resultsRoot}`,
      );
      assert.ok(out.includes("expected: 3") && out.includes("received: 2"));
    },
  },
  {
    name: "AttemptDetails · 自定义叶子组合呈现失败详情",
    // 场景：报告作者不用 AttemptDetails 成品，自己组合 Summary/Assessment/FixPrompt/Diagnostics。
    // Given：site.tsx 声明一张 navigation:false 的 review page。
    // When：用户从 CLI 打开失败 locator。
    // Then：组合后的 AttemptAssessment 仍呈现真实失败细节。
    async run({ evidence }) {
      const out = sh(
        `pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --report ${SITE_REPORT} --record ${evidence.resultsRoot}`,
      );
      assert.ok(out.includes("expected: 3") && out.includes("received: 2"));
    },
  },
  {
    name: "AttemptDetails · locator 深链打开自定义 review",
    // 场景：用户从过滤后的 AttemptList 点击失败 locator。
    // Given：site.tsx 的 attempt-input page 是自定义叶子组合。
    // When：用户点击唯一可见的 deliberate-fail 深链。
    // Then：dialog 打开并显示 expected/received。
    async run({ evidence, browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Attempts" }).click();
        const panel = page.locator("#tab-page-attempts");
        const filter = panel.locator("input[data-niceeval-filter]");
        await filter.waitFor({ state: "visible", timeout: 10_000 });
        await filter.fill("deliberate-fail");
        await page.waitForTimeout(100);

        const href = `attempt/${encodeURIComponent(evidence.deliberateFail.attempt.locator)}.html`;
        const link = panel.locator(`a.niceeval-locator[href="${href}"]`);
        assert.equal(await link.count(), 1);
        await link.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        const text = await dialog.innerText();
        assert.ok(text.includes("expected: 3") && text.includes("received: 2"));
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "AttemptDetails · extends 的浏览器深链仍可达",
    // 场景：用户在 branded 报告的 Attempts 页点击失败 locator。
    // Given：branded.tsx 继承 standard AttemptList 与 attempt page。
    // When：用户点击 locator。
    // Then：dialog 显示内建失败详情。
    async run({ evidence, browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Attempts" }).click();
        const panel = page.locator("#tab-page-attempts");
        await panel.locator(".niceeval-locator").first().waitFor({ state: "visible", timeout: 10_000 });
        const href = `attempt/${encodeURIComponent(evidence.deliberateFail.attempt.locator)}.html`;
        await panel.locator(`a.niceeval-locator[href="${href}"]`).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        const text = await dialog.innerText();
        assert.ok(text.includes("expected: 3") && text.includes("received: 2"));
      } finally {
        await page.close();
      }
    },
  },
];
