import { pathToFileURL } from "node:url";
import { chromium, expect as expectPage } from "@playwright/test";
import { expect, test } from "vitest";
import { runProcess } from "../support/process.ts";

// regression: d489dfd4（renderer 改了点的 class，enhance.js 仍监听旧 selector）
test("导出报告的图表点 hover 后显示系列、横轴和值", async () => {
  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "charts", "--rerun", "all", "--json",
  ]);
  expect(run.exitCode, run.diagnostic()).toBe(0);

  const exported = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "view", "--report", "reports/charts.tsx",
    "--out", "artifacts/site", "--no-open",
  ]);
  expect(exported.exitCode, exported.diagnostic()).toBe(0);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(`${process.cwd()}/artifacts/site/index.html`).href);

    // fixture 明确声明 main / task-a / 0.75；预期不从候选导出的点集合反推。
    const point = page.getByLabel("main · task-a · 0.75");
    await expectPage(point).toBeVisible();
    await point.hover();

    const tooltip = page.getByRole("tooltip");
    await expectPage(tooltip).toBeVisible();
    await expectPage(tooltip).toContainText("main");
    await expectPage(tooltip).toContainText("task-a");
    await expectPage(tooltip).toContainText("0.75");
  } finally {
    await browser.close();
  }
});
