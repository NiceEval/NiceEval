// cases: docs/engineering/testing/unit/reports.md
// 「Markdown 的解析与两面投影」:断言 AST 与两面输出字符串,不经浏览器。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTextContext, renderNodeToText } from "./tree.ts";
import {
  Markdown,
  detectMarkdownTable,
  markdownToText,
  markdownToWeb,
  parseMarkdown,
} from "./primitives/markdown.tsx";

describe("Markdown 解析", () => {
  it("产出 document 根与块级子节点", () => {
    const tree = parseMarkdown("# Title\n\nBody");
    expect(tree.type).toBe("root");
    expect(tree.children?.length).toBe(2);
    expect(tree.children?.[0]?.type).toBe("heading");
    expect(tree.children?.[1]?.type).toBe("paragraph");
  });

  it("表格语法按完整用户反馈拒绝并指引 Table", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(detectMarkdownTable(md)).toBe(true);
    expect(() => parseMarkdown(md)).toThrow(/Table/);
    expect(() => parseMarkdown(md)).toThrow(/stringWidth/);
  });

  it("裸 HTML 块与行内 HTML 转义,不进 web 原始标签", () => {
    const tree = parseMarkdown("<div>raw</div>\n\nInline <b>x</b> text");
    const html = renderToStaticMarkup(markdownToWeb(tree));
    expect(html).not.toMatch(/<div>raw<\/div>/);
    expect(html).toContain("&lt;div&gt;raw&lt;/div&gt;");
    expect(html).not.toMatch(/<b>x<\/b>/);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&lt;/b&gt;");
  });

  it("证据引用 @locator 当普通文本,不解析为深链", () => {
    const text = markdownToText(parseMarkdown("ref @1k2m9qrs here"), 40);
    expect(text).toBe("ref @1k2m9qrs here");
  });

  it("LocalizedText 按回退链选语言,缺语言不报错", () => {
    const text = renderNodeToText(
      <Markdown>{{ "zh-CN": "中文", en: "English" }}</Markdown>,
      createTextContext({ locale: "zh-CN", width: 40 }),
    );
    expect(text).toBe("中文");
    const fallback = renderNodeToText(
      <Markdown>{{ "zh-CN": "中文", en: "English" }}</Markdown>,
      createTextContext({ locale: "fr", width: 40 }),
    );
    expect(fallback).toBe("English");
  });
});

describe("Markdown text 面投影", () => {
  it("标题、段落段间空行", () => {
    const text = markdownToText(parseMarkdown("# H1\n\nPara one\n\nPara two"), 60);
    expect(text).toContain("H1");
    expect(text).toContain("Para one");
    expect(text).toContain("Para two");
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });

  it("无序列表前缀与嵌套缩进两格", () => {
    const text = markdownToText(
      parseMarkdown("- outer\n  - inner\n- tail"),
      60,
    );
    expect(text).toMatch(/^- outer/);
    expect(text).toMatch(/  - inner/);
    expect(text).toMatch(/- tail/);
  });

  it("有序列表与任务列表前缀", () => {
    const text = markdownToText(
      parseMarkdown("1. first\n2. second\n\n- [ ] todo\n- [x] done"),
      60,
    );
    expect(text).toContain("1. first");
    expect(text).toContain("2. second");
    expect(text).toContain("[ ] todo");
    expect(text).toContain("[x] done");
  });

  it("代码块缩进两格且不折行", () => {
    const long = "x".repeat(50);
    const text = markdownToText(parseMarkdown("```\n" + long + "\n```"), 20);
    const codeLine = text.split("\n").find((l) => l.includes(long));
    expect(codeLine).toBeDefined();
    expect(codeLine!.trimStart().startsWith(long)).toBe(true);
    expect(codeLine!.length).toBeGreaterThan(20);
  });

  it("块引用每行 > 前缀", () => {
    const text = markdownToText(parseMarkdown("> quote line\n> second"), 40);
    const contentLines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(contentLines.every((l) => l.startsWith("> "))).toBe(true);
    expect(text).toContain("> quote line");
    expect(text).toContain("> second");
  });

  it("链接与 autolink 投影为 文字 (url);相同只打一次", () => {
    const labeled = markdownToText(
      parseMarkdown("[docs](https://example.com/docs) and https://example.com"),
      80,
    );
    expect(labeled).toContain("docs (https://example.com/docs)");
    expect(labeled).toContain("https://example.com");
    const same = markdownToText(parseMarkdown("<https://same.io>"), 40);
    expect(same).toBe("https://same.io");
  });

  it("图片投影为 alt (url)", () => {
    const text = markdownToText(parseMarkdown("![alt text](https://img.test/a.png)"), 60);
    expect(text).toBe("alt text (https://img.test/a.png)");
  });

  it("分割线宽度取可用宽度", () => {
    const text = markdownToText(parseMarkdown("---"), 30);
    const hrLine = text.split("\n").find((l) => l.includes("─"));
    expect(hrLine?.replace(/─/g, "").trim().length).toBe(0);
    expect(hrLine?.length).toBe(30);
  });

  it("无 ANSI 时脱去强调标记只留文字", () => {
    const text = markdownToText(parseMarkdown("**bold** *em* ~~del~~"), 40, false);
    expect(text).toBe("bold em del");
    expect(text).not.toContain("**");
    expect(text).not.toContain("~~");
  });

  it("panelMode boxed 时标题与行内加 ANSI", () => {
    const text = renderNodeToText(
      <Markdown># Head\n\n**bold**</Markdown>,
      createTextContext({ width: 40, panelMode: "boxed" }),
    );
    expect(text).toContain("\u001b[1m");
    expect(text).toContain("Head");
    expect(text).toContain("bold");
  });

  it("中文正文折行按显示宽度不撕歪", () => {
    const text = markdownToText(parseMarkdown("每个配置跑三轮，取端到端通过率。"), 10);
    const lines = text.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const visual =
        [...line].reduce((w, ch) => {
          const cp = ch.codePointAt(0)!;
          return w + (cp > 0x4e00 && cp < 0x9fff ? 2 : 1);
        }, 0);
      expect(visual).toBeLessThanOrEqual(10);
    }
  });
});

describe("Markdown web 面投影", () => {
  it("语义标签与 niceeval-md 类", () => {
    const html = renderToStaticMarkup(
      markdownToWeb(parseMarkdown("## Sub\n\n**strong** ~~del~~ `code`")),
    );
    expect(html).toContain("<h2");
    expect(html).toContain("niceeval-md-h2");
    expect(html).toContain("<strong>");
    expect(html).toContain("<del>");
    expect(html).toContain("<code");
  });

  it("任务列表渲染复选框", () => {
    const html = renderToStaticMarkup(markdownToWeb(parseMarkdown("- [x] ok\n- [ ] no")));
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("checked");
  });
});
