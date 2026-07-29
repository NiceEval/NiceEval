// cases: docs/engineering/testing/unit/reports.md
// 第 207 行:增强脚本拦截 locator 链接后,dialog 内容与直接打开该文档的内容是同一份
// server-rendered 字节/DOM 片段。
import { describe, expect, it } from "vitest";
import { attemptHrefFor, attemptLocatorFromHref, hashForAttempt, locatorFromHash, parseAttemptDocument } from "./attempt-dialog.ts";

describe("attemptHrefFor / attemptLocatorFromHref", () => {
  it("互为逆运算(编码/解码往返)", () => {
    const locator = "@1kijjdij";
    const href = attemptHrefFor(locator);
    expect(href).toBe("attempt/%401kijjdij.html");
    expect(attemptLocatorFromHref(href)).toBe(locator);
  });

  it("不是 attempt 文档链接或形状不对时返回 undefined", () => {
    expect(attemptLocatorFromHref("index.html")).toBeUndefined();
    expect(attemptLocatorFromHref("artifact/e/run/a0/events.json")).toBeUndefined();
    expect(attemptLocatorFromHref("attempt/not-a-locator.html")).toBeUndefined();
  });
});

describe("hashForAttempt / locatorFromHash", () => {
  it("互为逆运算", () => {
    expect(locatorFromHash(hashForAttempt("@abc123"))).toBe("@abc123");
  });

  it("非 attempt 路由或形状不对返回 undefined", () => {
    expect(locatorFromHash("#/page/report")).toBeUndefined();
    expect(locatorFromHash("#/attempt/not-valid")).toBeUndefined();
    expect(locatorFromHash("")).toBeUndefined();
  });
});

describe("parseAttemptDocument", () => {
  function fakeDocument(en: string, zh: string): string {
    return [
      "<!doctype html>",
      "<html><head></head><body>",
      `<div data-niceeval-locale="en">${en}</div>`,
      `<div data-niceeval-locale="zh-CN" hidden>${zh}</div>`,
      "<script>/* locale swap */</script>",
      "</body></html>",
    ].join("\n");
  }

  it("取出两种语言的内容片段,不含包裹的 div 标签本身", () => {
    const html = fakeDocument("<p>hello</p>", "<p>你好</p>");
    expect(parseAttemptDocument(html)).toEqual({ en: "<p>hello</p>", "zh-CN": "<p>你好</p>" });
  });

  it("内容里嵌套的 <div> 不会打断切分(现实里的 AttemptDetails 输出全是嵌套 div)", () => {
    const html = fakeDocument(
      '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">stuff</div></div>',
      '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">东西</div></div>',
    );
    expect(parseAttemptDocument(html)).toEqual({
      en: '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">stuff</div></div>',
      "zh-CN": '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">东西</div></div>',
    });
  });

  it("不是这份渲染器产出的文档(缺少标记)返回 null,不开空 dialog", () => {
    expect(parseAttemptDocument("<html><body>not an attempt document</body></html>")).toBeNull();
  });
});
