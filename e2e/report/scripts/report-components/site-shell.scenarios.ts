/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import {
  BRANDED_REPORT,
  SITE_REPORT,
  shRaw,
  type ReportComponentScenario,
} from "./harness.ts";

export const siteShellScenarios: readonly ReportComponentScenario[] = [
  {
    name: "Report shell · 复用 standard pages 保留页索引",
    // 场景：用户用 pages: standard.pages 叠加品牌 title。
    // Given：branded.tsx 只改 title / head，不重写 standard pages。
    // When：用户从 CLI 打开首页和 Attempts 页。
    // Then：两页都列出其它可导航页，且不把当前页重复列入。
    async run({ evidence }) {
      const root = evidence.resultsRoot;
      const bare = sh(`pnpm exec niceeval show --report ${BRANDED_REPORT} --record ${root}`);
      assert.ok(bare.includes(`niceeval show --record ${root} --report ${BRANDED_REPORT} --page attempts`));
      assert.ok(bare.includes(`niceeval show --record ${root} --report ${BRANDED_REPORT} --page traces`));
      assert.ok(!/--page report\b/.test(bare), "首页索引不应重复列出当前 report 页");

      const attempts = sh(`pnpm exec niceeval show --report ${BRANDED_REPORT} --record ${root} --page attempts`);
      assert.ok(attempts.includes(`niceeval show --record ${root} --report ${BRANDED_REPORT} --page report`));
      assert.ok(attempts.includes(`niceeval show --record ${root} --report ${BRANDED_REPORT} --page traces`));
    },
  },
  {
    name: "Report shell · 未知页面给出公开候选",
    // 场景：用户输错自定义报告的 page id。
    // Given：site.tsx 有三张导航页和一张 navigation:false 的 attempt page。
    // When：用户执行 --page bogus。
    // Then：命令失败且只列公开导航页，不泄漏隐藏的 review page。
    async run({ evidence }) {
      const bad = shRaw(`pnpm exec niceeval show --report ${SITE_REPORT} --record ${evidence.resultsRoot} --page bogus`);
      assert.notEqual(bad.status, 0, "--page bogus 应失败");
      assert.ok(
        bad.combined.includes("Available pages: overview, scoreboard, attempts"),
        `错误应只列公开导航页；got:\n${bad.combined}`,
      );
      assert.ok(!bad.combined.includes("review"), "隐藏的 attempt-input page 不应出现在候选列表");
    },
  },
  {
    name: "Report shell · 浏览器标题使用报告标题",
    // 场景：用户给报告声明品牌标题。
    // Given：branded.tsx 声明 title。
    // When：浏览器打开导出的 index.html。
    // Then：浏览器标题使用该公开字段。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        assert.equal(await page.title(), "Results E2E · Branded");
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · 复用 standard pages 保留浏览器导航",
    // 场景：用户只给 standard 报告叠加品牌 title。
    // Given：branded.tsx 没有重写 pages。
    // When：浏览器渲染顶部导航。
    // Then：三张继承页面按原顺序可见。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const topbar = page.locator("header.topbar");
        await topbar.waitFor({ state: "visible", timeout: 10_000 });
        assert.deepEqual(await topbar.getByRole("tab").allTextContents(), ["Report", "Attempts", "Traces"]);
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · head 注入站点级外链",
    // 场景：报告作者用 head 声明站点级外链（不再用 LEGACY links）。
    // Given：branded.tsx 的 head 含 GitHub href。
    // When：浏览器打开导出页。
    // Then：文档 head 含该 link。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const href = await page.locator('head link[href="https://github.com/niceeval/niceeval"]').getAttribute("href");
        assert.equal(href, "https://github.com/niceeval/niceeval");
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · 浏览器标题使用报告标题（无 LEGACY footer）",
    // 场景：外壳只保留 title / theme / dimensionPins / head / pages。
    // Given：branded.tsx 不声明 footer。
    // When：浏览器渲染页面。
    // Then：标题正确，且不再渲染 .site-footer 品牌脚注。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        assert.equal(await page.title(), "Results E2E · Branded");
        assert.equal(await page.locator(".site-footer .site-footer-text").count(), 0);
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · 自定义多页按声明顺序导航",
    // 场景：用户定义三张自定义导航页。
    // Given：site.tsx 的 review page 明确 navigation:false。
    // When：浏览器水合顶部导航。
    // Then：只出现 Overview、Scoreboard、Attempts，顺序与报告声明一致。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const topbar = page.locator("header.topbar");
        await topbar.waitFor({ state: "visible", timeout: 10_000 });
        assert.deepEqual(await topbar.getByRole("tab").allTextContents(), ["Overview", "Scoreboard", "Attempts"]);
      } finally {
        await page.close();
      }
    },
  },
];
