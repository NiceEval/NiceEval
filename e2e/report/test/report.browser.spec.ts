// feature: docs/engineering/testing/e2e/report.md
//
// 唯一浏览器代表：只用可见 role/entity 和页面实际 href 操作 custom report，
// 不拼 attempt 路径、不依赖 DOM class/id。

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

test("custom report 的可见导航与失败实体链接可达", async ({ page }) => {
  await withHttpServer(staticSiteHandler(join(process.cwd(), "site-export")), async ({ url }) => {
    await page.goto(`${url}/index.html`);
    // 外壳导航是可见 tab（view 外壳语义，非链接），按产品可访问身份操作。
    const attemptsTab = page.getByRole("tab", { name: "Attempts", exact: true });
    await expect(attemptsTab).toBeVisible();
    await attemptsTab.click();

    const failedRow = page.getByRole("row").filter({ hasText: "failed" }).first();
    await expect(failedRow).toBeVisible();
    const attemptLink = failedRow.getByRole("link").first();
    const attemptHref = await attemptLink.getAttribute("href");
    expect(attemptHref).toBeTruthy();

    const detailUrl = new URL(attemptHref!, page.url()).href;
    expect((await page.request.get(detailUrl)).status()).toBe(200);
    await page.goto(detailUrl);
    await expect(page.getByText("failed", { exact: true }).first()).toBeVisible();
  });
});

test("从 Attempts 表实际 href 下钻 tool-call attempt，assistant 对话证据可见", async ({ page }) => {
  await withHttpServer(staticSiteHandler(join(process.cwd(), "site-export")), async ({ url }) => {
    await page.goto(`${url}/index.html`);
    const attemptsTab = page.getByRole("tab", { name: "Attempts", exact: true });
    await expect(attemptsTab).toBeVisible();
    await attemptsTab.click();

    // tool-call 是实验里唯一 passed 的 attempt：用可见判定文本定位其表行，
    // 再沿行内实体链接的真实 href 进入详情，不拼 attempt 路径。
    const passedRow = page.getByRole("row").filter({ hasText: "passed" });
    await expect(passedRow).toBeVisible();
    const toolCallLink = passedRow.getByRole("link").first();
    const toolCallHref = await toolCallLink.getAttribute("href");
    expect(toolCallHref).toBeTruthy();

    const detailUrl = new URL(toolCallHref!, page.url()).href;
    expect((await page.request.get(detailUrl)).status()).toBe(200);
    await page.goto(detailUrl);

    // 判定之外还交付了对话证据：assistant 角色标签与消息正文可见
    // （tool-call 的 user 消息是带 loc 的开轮消息，正文即轮次标题，不重复渲染成条目）。
    await expect(page.getByText("Deterministic report fixture response.", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("assistant", { exact: true }).first()).toBeVisible();
  });
});

test("custom report 的 CopyBlock 标题与复制按钮可见，复制动作写入预期剪贴板", async ({ page }) => {
  await withHttpServer(staticSiteHandler(join(process.cwd(), "site-export")), async ({ url }) => {
    await page.goto(`${url}/index.html`);

    // 标题以可见 <summary>（DisclosureTriangle，非 button role）呈现；点开后才露出正文与 Copy 按钮。
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
  });
});
