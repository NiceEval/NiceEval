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
    // Given：branded.tsx 没有重写 standard 的参数化 attempt page。
    // When：用户用公开 locator 打开失败详情。
    // Then：内建详情仍把 locator、verdict 与失败源码行绑定在一起。
    async run({ evidence }) {
      const out = sh(
        `pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --report ${BRANDED_REPORT} --record ${evidence.resultsRoot}`,
      );
      assert.ok(out.includes(evidence.deliberateFail.attempt.locator));
      assert.ok(out.includes("failed"));
      assert.ok(out.includes("evals/deliberate-fail.eval.ts:13 [gate-fail]"));
    },
  },
  {
    name: "AttemptDetails · 自定义叶子组合呈现失败详情",
    // 场景：报告作者不用 AttemptDetails 成品，自己组合 Summary/Assessment/FixPrompt/Diagnostics。
    // Given：site.tsx 声明一张 navigation:false 的参数化 attempt page。
    // When：用户从 CLI 打开失败 locator。
    // Then：组合后的 AttemptAssessment 仍呈现真实失败源码身份。
    async run({ evidence }) {
      const out = sh(
        `pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --report ${SITE_REPORT} --record ${evidence.resultsRoot}`,
      );
      assert.ok(out.includes(evidence.deliberateFail.attempt.locator));
      assert.ok(out.includes("failed"));
      assert.ok(out.includes("evals/deliberate-fail.eval.ts:13 [gate-fail]"));
    },
  },
  {
    name: "AttemptDetails · locator 深链打开自定义 attempt page",
    // 场景：用户从过滤后的 AttemptList 点击失败 locator。
    // Given：site.tsx 的参数化 attempt page 是自定义叶子组合。
    // When：用户点击唯一可见的 deliberate-fail 深链。
    // Then：dialog 打开并显示 locator、verdict 与失败源码身份。
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
        assert.ok(text.includes(evidence.deliberateFail.attempt.locator));
        assert.ok(text.includes("failed"));
        assert.equal(await dialog.locator(".niceeval-source-block-path").innerText(), "evals/deliberate-fail.eval.ts");
        const failedLine = dialog.locator("details.niceeval-source-line--gate-fail");
        assert.equal(await failedLine.count(), 1);
        assert.equal(await failedLine.getAttribute("open"), "");
        assert.equal(await failedLine.locator(".niceeval-source-gutter-mark").getAttribute("aria-label"), "failed");
        assert.equal(await failedLine.locator(".niceeval-source-assertion").innerText(), "equals(3) · gate failed");
        assert.equal(await failedLine.locator(".niceeval-source-assertion-body").innerText(), "expected: 3\nreceived: 2");
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
    // Then：dialog 显示内建失败详情并保持 locator、verdict、源码身份关联。
    async run({ evidence, browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "Attempts" }).click();
        const panel = page.locator("#tab-page-attempts");
        const href = `attempt/${encodeURIComponent(evidence.deliberateFail.attempt.locator)}.html`;
        const link = panel.locator(`a.niceeval-locator[href="${href}"]`);
        const collapsedAncestors = link.locator("xpath=ancestor::details");
        for (let index = 0; index < (await collapsedAncestors.count()); index += 1) {
          const group = collapsedAncestors.nth(index);
          if ((await group.getAttribute("open")) === null) {
            await group.locator(":scope > summary").click();
          }
        }
        await link.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        const text = await dialog.innerText();
        assert.ok(text.includes(evidence.deliberateFail.attempt.locator));
        assert.ok(text.includes("failed"));
        assert.equal(await dialog.locator(".niceeval-source-block-path").innerText(), "evals/deliberate-fail.eval.ts");
        const failedLine = dialog.locator("details.niceeval-source-line--gate-fail");
        assert.equal(await failedLine.count(), 1);
        assert.equal(await failedLine.getAttribute("open"), "");
        assert.equal(await failedLine.locator(".niceeval-source-gutter-mark").getAttribute("aria-label"), "failed");
        assert.equal(await failedLine.locator(".niceeval-source-assertion").innerText(), "equals(3) · gate failed");
        assert.equal(await failedLine.locator(".niceeval-source-assertion-body").innerText(), "expected: 3\nreceived: 2");
      } finally {
        await page.close();
      }
    },
  },
];
