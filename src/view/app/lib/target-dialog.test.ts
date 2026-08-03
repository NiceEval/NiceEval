// cases: docs/engineering/testing/unit/reports.md
// 第 207 行:增强脚本拦截参数化页链接后,dialog 内容与直接打开该文档的内容是同一份
// server-rendered 字节/DOM 片段。这里的机制对任意参数化页 id 通用——两组区分力 fixture
// (attempt 形态与 experiment 形态)证明拦截 / 路由不写死具体实体。
import { describe, expect, it } from "vitest";
import {
  createTargetRequestGate,
  hashForTarget,
  hrefForTarget,
  parseTargetDocument,
  targetFromHash,
  targetFromHref,
} from "./target-dialog.ts";

const PARAM_PAGE_IDS = ["attempt", "experiment"];

describe("target request gate", () => {
  it("旧响应不能覆盖新目标，关闭后最后一次响应也失效", () => {
    const gate = createTargetRequestGate();
    const old = gate.begin({ pageId: "attempt", key: "@old" });
    const latest = gate.begin({ pageId: "experiment", key: "agents/codex" });

    expect(gate.accepts(old)).toBe(false);
    expect(gate.accepts(latest)).toBe(true);
    gate.invalidate();
    expect(gate.accepts(latest)).toBe(false);
  });
});

describe("hrefForTarget / targetFromHref", () => {
  it("attempt 形态的 pageId 互为逆运算(编码/解码往返)", () => {
    const target = { pageId: "attempt", key: "@1kijjdij" };
    const href = hrefForTarget(target.pageId, target.key);
    expect(href).toBe("attempt/%401kijjdij.html");
    expect(targetFromHref(href, PARAM_PAGE_IDS)).toEqual(target);
  });

  it("experiment 形态的 pageId(key 含 /)同样互为逆运算——机制不是 attempt 专属", () => {
    const target = { pageId: "experiment", key: "agents/codex" };
    const href = hrefForTarget(target.pageId, target.key);
    expect(href).toBe("experiment/agents%2Fcodex.html");
    expect(targetFromHref(href, PARAM_PAGE_IDS)).toEqual(target);
  });

  it("不是参数化页文档链接、或 pageId 不在报告声明的参数化页全集里都返回 undefined", () => {
    expect(targetFromHref("index.html", PARAM_PAGE_IDS)).toBeUndefined();
    expect(targetFromHref("artifact/e/run/a0/events.json", PARAM_PAGE_IDS)).toBeUndefined();
    // "report" 不是参数化页 id(它是导航页),不该被当成参数化页目标拦截。
    expect(targetFromHref("report/x.html", PARAM_PAGE_IDS)).toBeUndefined();
  });
});

describe("hashForTarget / targetFromHash", () => {
  it("attempt 与 experiment 两种 pageId 都互为逆运算(证明路由机制通用,不是 attempt 专属)", () => {
    expect(targetFromHash(hashForTarget("attempt", "@abc123"), PARAM_PAGE_IDS)).toEqual({
      pageId: "attempt",
      key: "@abc123",
    });
    expect(targetFromHash(hashForTarget("experiment", "agents/codex"), PARAM_PAGE_IDS)).toEqual({
      pageId: "experiment",
      key: "agents/codex",
    });
  });

  it("非参数化页路由、pageId 不在全集里,或 key 为空都返回 undefined", () => {
    // `#/page/report` 是导航页路由,不是参数化页目标。
    expect(targetFromHash("#/page/report", PARAM_PAGE_IDS)).toBeUndefined();
    expect(targetFromHash("#/unknown-page/x", PARAM_PAGE_IDS)).toBeUndefined();
    expect(targetFromHash("#/attempt/", PARAM_PAGE_IDS)).toBeUndefined();
    expect(targetFromHash("", PARAM_PAGE_IDS)).toBeUndefined();
  });
});

describe("parseTargetDocument", () => {
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
    expect(parseTargetDocument(html)).toEqual({ en: "<p>hello</p>", "zh-CN": "<p>你好</p>" });
  });

  it("内容里嵌套的 <div> 不会打断切分(现实里的 AttemptDetails/ExperimentDetails 输出全是嵌套 div)", () => {
    const html = fakeDocument(
      '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">stuff</div></div>',
      '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">东西</div></div>',
    );
    expect(parseTargetDocument(html)).toEqual({
      en: '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">stuff</div></div>',
      "zh-CN": '<div class="niceeval-report niceeval-col"><div class="niceeval-attempt-summary">东西</div></div>',
    });
  });

  it("不是这份渲染器产出的文档(缺少标记)返回 null,不开空 dialog", () => {
    expect(parseTargetDocument("<html><body>not a target document</body></html>")).toBeNull();
  });
});
