// feature: docs/engineering/testing/e2e/report.md
//
// 唯一浏览器代表：只用可见 role/entity 和页面实际 href 操作 custom report，
// 不拼 attempt 路径、不依赖 DOM class/id。

import { withHttpServer } from "@niceeval/testkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

function staticSiteHandler(root: string) {
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    if (relativePath.includes("..")) return new Response("not found", { status: 404 });
    try {
      const body = await readFile(join(root, relativePath));
      const contentType = relativePath.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
      return new Response(body, { headers: { "content-type": contentType } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
}

test("custom report 的可见导航与失败实体链接可达", async ({ page }) => {
  await withHttpServer(staticSiteHandler(join(process.cwd(), "site-export")), async ({ url }) => {
    await page.goto(`${url}/index.html`);
    await expect(page.getByRole("link", { name: "Attempts", exact: true })).toBeVisible();

    const attemptsLink = page.getByRole("link", { name: "Attempts", exact: true });
    const attemptsHref = await attemptsLink.getAttribute("href");
    expect(attemptsHref).toBeTruthy();
    await page.goto(new URL(attemptsHref!, page.url()).href);

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
