// cases: docs/engineering/testing/unit/assertions.md
import { describe, expect, it } from "vitest";
import { hasSections, includesUrl } from "./index.ts";

describe("includesUrl", () => {
  it("scores 1 when the text contains a real http(s) link", async () => {
    const m = includesUrl();
    expect(await m.score("依据见 https://example.com/report 第 3 节")).toBe(1);
    expect(m.severity).toBe("gate");
  });

  it("scores 0 on no link, and bare domains without a protocol do not count", async () => {
    expect(await includesUrl().score("来源：example.com（官网）")).toBe(0);
    expect(await includesUrl().score("一段没有任何引用的回答")).toBe(0);
  });

  it("counts distinct URLs: the same link repeated is one", async () => {
    const twice = "见 https://a.dev/x 与 https://a.dev/x";
    expect(await includesUrl(2).score(twice)).toBe(0);
    expect(await includesUrl(2).score("见 https://a.dev/x 与 https://b.dev/y")).toBe(1);
  });
});

describe("hasSections", () => {
  it("scores 1 when the text has at least min markdown headings", async () => {
    const m = hasSections();
    expect(await m.score("# 概述\n正文\n## 结论\n正文")).toBe(1);
    expect(m.severity).toBe("gate");
  });

  it("scores 0 on flowing text without headings; a mid-line # does not count", async () => {
    expect(await hasSections().score("一整段没有结构的流水回答，写了很多但没有小节。")).toBe(0);
    expect(await hasSections(1).score("价格是 #1 的选择\n继续正文")).toBe(0);
  });

  it("counts a level-6 heading too", async () => {
    expect(await hasSections(1).score("###### 附录\n内容")).toBe(1);
  });
});
