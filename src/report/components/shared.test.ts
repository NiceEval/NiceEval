// cases: docs/engineering/testing/unit/reports.md
// 「参数化页与下钻目标」—— targetOfRefs / ctx.href

import { describe, expect, it } from "vitest";

import type { AttemptLocator } from "../../record/locator.ts";
import { ATTEMPT_PAGE_ID, hrefForLocator, targetOfRefs } from "./shared.ts";
import type { WebContext } from "../definition/tree.ts";

const locator = (s: string): AttemptLocator => s as AttemptLocator;

describe("targetOfRefs", () => {
  it("恰好一个 ref 给 attempt 目标", () => {
    expect(targetOfRefs([locator("@a")])).toEqual({
      page: ATTEMPT_PAGE_ID,
      params: { locator: locator("@a") },
    });
  });

  it("零个 ref 给 undefined", () => {
    expect(targetOfRefs([])).toBeUndefined();
  });

  it("双 refs 行给 undefined —— 区分力场景:旧的「取 refs[0]」实现在这一格是唯一会绿的错误答案", () => {
    const target = targetOfRefs([locator("@a"), locator("@b")]);
    expect(target).toBeUndefined();
    // 一个只会做 refs[0] 的旧实现会在这里返回 { page: "attempt", params: { locator: "@a" } },
    // 与单 ref 场景产出同一种形状——新实现必须能区分"确定指向谁"和"压出一个可能错的猜测"。
  });
});

describe("ctx.href(target)", () => {
  const okCtx: WebContext = {
    href: (target) => (target.page === ATTEMPT_PAGE_ID ? `attempt/${(target.params as { locator: string }).locator}.html` : undefined),
    locale: "en",
    dimension: () => {
      throw new Error("not used");
    },
  };

  it("目标页存在时给出 URL", () => {
    const target = targetOfRefs([locator("@a")])!;
    expect(hrefForLocator(okCtx, locator("@a"))).toBe("attempt/@a.html");
    expect(okCtx.href(target)).toBe("attempt/@a.html");
  });

  it("目标页不存在时给 undefined", () => {
    const missingCtx: WebContext = {
      href: () => undefined,
      locale: "en",
      dimension: () => {
        throw new Error("not used");
      },
    };
    expect(hrefForLocator(missingCtx, locator("@a"))).toBeUndefined();
  });

  it("零/多 refs 时 hrefForLocator 的上游 targetOfRefs 已经是 undefined,不产出空 href", () => {
    expect(targetOfRefs([])).toBeUndefined();
    expect(targetOfRefs([locator("@a"), locator("@b")])).toBeUndefined();
  });
});
