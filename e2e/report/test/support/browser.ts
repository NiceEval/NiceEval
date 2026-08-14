import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export interface VisibleBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Public bounding box of a visible element. No computed style. */
export async function visibleBox(locator: Locator): Promise<VisibleBox> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "visible element must expose a bounding box").not.toBeNull();
  expect(box!.width, "visible box width").toBeGreaterThan(0);
  expect(box!.height, "visible box height").toBeGreaterThan(0);
  return box!;
}

export async function expectContained(inner: Locator, outer: Locator): Promise<void> {
  const child = await visibleBox(inner);
  const parent = await visibleBox(outer);
  expect(child.x, "contained left").toBeGreaterThanOrEqual(parent.x);
  expect(child.y, "contained top").toBeGreaterThanOrEqual(parent.y);
  expect(child.x + child.width, "contained right").toBeLessThanOrEqual(parent.x + parent.width);
  expect(child.y + child.height, "contained bottom").toBeLessThanOrEqual(parent.y + parent.height);
}

export async function expectLeftOf(left: Locator, right: Locator): Promise<void> {
  const earlier = await visibleBox(left);
  const later = await visibleBox(right);
  expect(earlier.x, "relative x order").toBeLessThan(later.x);
}

export async function expectAbove(upper: Locator, lower: Locator): Promise<void> {
  const top = await visibleBox(upper);
  const bottom = await visibleBox(lower);
  expect(top.y, "relative y order").toBeLessThan(bottom.y);
}

export async function expectSameRow(left: Locator, right: Locator): Promise<void> {
  const first = await visibleBox(left);
  const second = await visibleBox(right);
  const overlap = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  expect(overlap, "same-row vertical overlap").toBeGreaterThan(0);
  expect(first.x, "same-row distinct columns").not.toBe(second.x);
}

/** Two visible elements share the same horizontal center, within layout rounding. */
export async function expectHorizontallyCenteredWith(
  first: Locator,
  second: Locator,
  tolerancePx = 2,
): Promise<void> {
  const firstBox = await visibleBox(first);
  const secondBox = await visibleBox(second);
  const firstCenter = firstBox.x + firstBox.width / 2;
  const secondCenter = secondBox.x + secondBox.width / 2;
  expect(
    Math.abs(firstCenter - secondCenter),
    `horizontal centers differ: ${firstCenter} vs ${secondCenter}`,
  ).toBeLessThanOrEqual(tolerancePx);
}

export async function expectStacked(upper: Locator, lower: Locator): Promise<void> {
  const top = await visibleBox(upper);
  const bottom = await visibleBox(lower);
  expect(top.y + top.height, "stacked order").toBeLessThanOrEqual(bottom.y);
}

export async function expectWiderThan(wider: Locator, narrower: Locator): Promise<void> {
  const large = await visibleBox(wider);
  const small = await visibleBox(narrower);
  expect(large.width, "relative width").toBeGreaterThan(small.width);
}

export async function expectRootNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `root horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

/** The named surface, or its nearest ancestor scrollport, owns extra width. The page root does not. */
export async function expectLocalHorizontalScroll(locator: Locator): Promise<void> {
  const layout = await locator.evaluate((element) => {
    const root = document.scrollingElement ?? document.documentElement;
    let current: Element | null = element;
    let local: { scrollWidth: number; clientWidth: number; before: number; after: number } | null = null;
    while (current !== null && current !== document.body && current !== root) {
      if (current.scrollWidth > current.clientWidth) {
        const before = current.scrollLeft;
        current.scrollLeft = current.scrollWidth;
        const after = current.scrollLeft;
        current.scrollLeft = before;
        local = { scrollWidth: current.scrollWidth, clientWidth: current.clientWidth, before, after };
        break;
      }
      current = current.parentElement;
    }
    return {
      local,
      pageScrollWidth: root.scrollWidth,
      pageClientWidth: root.clientWidth,
    };
  });
  expect(layout.local, "named surface should own its extra width").not.toBeNull();
  expect(layout.local!.after, "local surface should actually scroll").toBeGreaterThan(layout.local!.before);
  expect(
    layout.pageScrollWidth,
    `page horizontal overflow ${layout.pageScrollWidth} > ${layout.pageClientWidth}`,
  ).toBeLessThanOrEqual(layout.pageClientWidth);
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
