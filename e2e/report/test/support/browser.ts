import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });
  expect(overflow.scrollWidth, `horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`).toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
}

export async function followVisibleLink(page: Page, name: string | RegExp): Promise<string> {
  const link = page.getByRole("link", { name }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href, `link ${String(name)} missing href`).toBeTruthy();
  const target = new URL(href!, page.url()).href;
  const response = await page.request.get(target);
  expect(response.status(), `GET ${target}`).toBe(200);
  await page.goto(target);
  return target;
}
