// feature: docs/engineering/testing/e2e/report.md
//
// 唯一浏览器代表：一个连续 Journey 用可见 role/entity 和页面实际 href 操作
// custom report，不拼 attempt 路径、不依赖 DOM class/id。

import { withHttpServer } from "@niceeval/testkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// 与 reports/site.tsx 中 fixture CopyBlock 的正文字面量一致，浏览器验收复制结果。
const FIXTURE_COPY_TEXT = "niceeval report fixture copy text";

function staticSiteHandler(root: string) {
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const rawRelativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    // 导出文件名保留 locator 的百分号编码（attempt/%40<locator>.html 落盘同名文件），
    // 先按原样路径读，读不到再按解码后的路径读；两者都不允许目录穿越。
    const candidates = [rawRelativePath, decodeURIComponent(rawRelativePath)];
    for (const relativePath of candidates) {
      if (relativePath.includes("..")) continue;
      try {
        const body = await readFile(join(root, relativePath));
        const contentType = relativePath.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
        return new Response(body, { headers: { "content-type": contentType } });
      } catch {
        // fall through to the next candidate
      }
    }
    return new Response("not found", { status: 404 });
  };
}

test("custom report Journey：CopyBlock 复制、Attempts 表导航与实体证据下钻", async ({ page }) => {
  await withHttpServer(staticSiteHandler(join(process.cwd(), "site-export")), async ({ url }) => {
    // index：CopyBlock 标题（<summary> 以可见文本呈现，不臆造 button role）点开后
    // 正文与 Copy 按钮可见，复制动作写入预期剪贴板。
    await page.goto(`${url}/index.html`);
    const copyTitle = page.getByText("Fixture copy block", { exact: true });
    await expect(copyTitle).toBeVisible();
    await copyTitle.click();
    await expect(page.getByText(FIXTURE_COPY_TEXT, { exact: true }).first()).toBeVisible();
    const copyButton = page.getByRole("button", { name: "Copy", exact: true });
    await expect(copyButton).toBeVisible();

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
    await copyButton.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(FIXTURE_COPY_TEXT);

    // Attempts tab（外壳导航的真实可访问身份）→ 表格内 failed 实体链接的真实 href 下钻。
    const attemptsTab = page.getByRole("tab", { name: "Attempts", exact: true });
    await expect(attemptsTab).toBeVisible();
    await attemptsTab.click();

    const failedRow = page.getByRole("row").filter({ hasText: "failed" }).first();
    await expect(failedRow).toBeVisible();
    const failedLink = failedRow.getByRole("link").first();
    const failedHref = await failedLink.getAttribute("href");
    expect(failedHref).toBeTruthy();

    const failedUrl = new URL(failedHref!, page.url()).href;
    expect((await page.request.get(failedUrl)).status()).toBe(200);
    await page.goto(failedUrl);
    await expect(page.getByText("failed", { exact: true }).first()).toBeVisible();

    // 回到 index 再进 Attempts：passed（tool-call）实体链接的真实 href 下钻，
    // 验证判定之外的对话证据（assistant 角色标签与消息正文可见）。
    await page.goto(`${url}/index.html`);
    const attemptsTabAgain = page.getByRole("tab", { name: "Attempts", exact: true });
    await expect(attemptsTabAgain).toBeVisible();
    await attemptsTabAgain.click();

    const passedRow = page.getByRole("row").filter({ hasText: "passed" });
    await expect(passedRow).toBeVisible();
    const toolCallLink = passedRow.getByRole("link").first();
    const toolCallHref = await toolCallLink.getAttribute("href");
    expect(toolCallHref).toBeTruthy();

    const toolCallUrl = new URL(toolCallHref!, page.url()).href;
    expect((await page.request.get(toolCallUrl)).status()).toBe(200);
    await page.goto(toolCallUrl);
    await expect(page.getByText("Deterministic report fixture response.", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("assistant", { exact: true }).first()).toBeVisible();
  });
});
