// cases: docs/engineering/testing/unit/reports.md
// 分区「面板几何（panel.ts）」：区域框契约的纯函数实现,直接对 renderPanel 的返回行数组
// 断言,不经真实终端或 HTML(与 chart-math/grid-layout 同一类,见 grid-layout.test.ts)。

import { describe, expect, it } from "vitest";
import { panelContentWidth, renderPanel } from "./panel.ts";
import { stringWidth } from "./text-layout.ts";

describe("renderPanel — 顶层完整框", () => {
  it("boxed 模式画完整四边框,标题嵌上边框左侧、meta 嵌右侧,正文左右各留边框+padding", () => {
    const lines = renderPanel({
      title: "PLAN",
      rows: [{ kind: "line", text: "45 attempts · 9 evals × 5 configs" }],
      width: 82,
      mode: "boxed",
    });
    expect(lines[0]!.startsWith("╭─ PLAN ")).toBe(true);
    expect(lines[0]!.endsWith("╮")).toBe(true);
    expect(lines.at(-1)!.startsWith("╰")).toBe(true);
    expect(lines.at(-1)!.endsWith("╯")).toBe(true);
    expect(lines[1]!.startsWith("│ 45 attempts · 9 evals × 5 configs")).toBe(true);
    expect(lines[1]!.endsWith(" │")).toBe(true);
    // 每一行(含边框)显示宽度恒等于声明宽度
    for (const line of lines) expect(stringWidth(line)).toBe(82);
  });

  it("meta 嵌上边框右侧、footerCommand 嵌下边框右侧", () => {
    const lines = renderPanel({
      title: "niceeval exp compare",
      meta: "2m 14s",
      footerCommand: "$0.84",
      rows: [{ kind: "line", text: "45 total · 6 reused · 19 running · 12 queued · 8 completed" }],
      width: 82,
      mode: "boxed",
    });
    expect(lines[0]).toBe(
      "╭─ niceeval exp compare ──────────────────────────────────────────────── 2m 14s ─╮",
    );
    expect(lines.at(-1)).toBe(
      "╰──────────────────────────────────────────────────────────────────────── $0.84 ─╯",
    );
  });
});

describe("renderPanel — 嵌套 Section 降横隔", () => {
  it("divider 行渲染成贯穿框宽的 ├─ 标题 ─┤,不再画嵌套的四边框", () => {
    const lines = renderPanel({
      title: "运行总览",
      meta: "6/6 完成",
      rows: [
        { kind: "line", text: "…顶层正文…" },
        { kind: "divider", title: "Cost" },
        { kind: "line", text: "…嵌套 Section 的正文…" },
      ],
      width: 82,
      mode: "boxed",
    });
    const dividerLine = lines.find((l) => l.startsWith("├"));
    expect(dividerLine).toBeDefined();
    expect(dividerLine).toMatch(/^├─ Cost ─+┤$/);
    expect(stringWidth(dividerLine!)).toBe(82);
    // 只有一层框:整份输出只有一对 ╭…╮ / ╰…╯,没有第二个嵌套的完整边框
    expect(lines.filter((l) => l.startsWith("╭")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("╰")).length).toBe(1);
  });

  it("divider 的 meta 右对齐在同一条隔条上", () => {
    const lines = renderPanel({
      title: "outer",
      rows: [{ kind: "divider", title: "ACTIVE", meta: "3 running" }],
      width: 82,
      mode: "boxed",
    });
    const dividerLine = lines.find((l) => l.startsWith("├"))!;
    expect(dividerLine).toMatch(/^├─ ACTIVE ─+ 3 running ─┤$/);
  });

});

describe("renderPanel — 宽度上限与截断优先级", () => {
  it("宽度上限 100:更宽的可用宽度也不会把框撑过 100 显示列", () => {
    const lines = renderPanel({
      title: "PLAN",
      rows: [{ kind: "line", text: "x" }],
      width: 200,
      mode: "boxed",
    });
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(100);
    expect(stringWidth(lines[0]!)).toBe(100);
  });

  it("调用方声明 capWidth: false 时框宽豁免 100 上限、跟随传入宽度(动态面板形态)", () => {
    const lines = renderPanel({
      title: "niceeval exp compare",
      rows: [{ kind: "line", text: "x" }],
      width: 200,
      mode: "boxed",
      capWidth: false,
    });
    for (const line of lines) expect(stringWidth(line)).toBe(200);
  });

  it("省略 capWidth 时默认行为不变,仍然封顶 100(豁免是显式 opt-in,不是新默认值)", () => {
    const lines = renderPanel({
      title: "PLAN",
      rows: [{ kind: "line", text: "x" }],
      width: 200,
      mode: "boxed",
    });
    expect(stringWidth(lines[0]!)).toBe(100);
  });

  it("先缩横线到最短一段,标题/meta 仍完整时不截断内容", () => {
    const lines = renderPanel({
      title: "PLAN",
      meta: "1m 02s",
      rows: [],
      width: 60,
      mode: "boxed",
    });
    expect(lines[0]).toContain("PLAN");
    expect(lines[0]).toContain("1m 02s");
    expect(stringWidth(lines[0]!)).toBe(60);
  });

  it("横线缩到头仍放不下时,标题中段截断补 …,meta 保持完整", () => {
    const longTitle = "niceeval exp compare --very-long-flag-name-that-does-not-fit-in-a-narrow-box";
    const lines = renderPanel({
      title: longTitle,
      meta: "2m 14s",
      rows: [],
      width: 60,
      mode: "boxed",
    });
    const border = lines[0]!;
    expect(stringWidth(border)).toBe(60);
    expect(border).toContain("…"); // 标题被截断
    expect(border).toContain("2m 14s"); // meta 仍然完整保留
    // 保留标题的头部与尾部(「保留 niceeval exp 和末尾参数」同一条规则)
    expect(border).toContain("niceeval");
  });

  it("即使标题截到最短也放不下 meta 时,最后才放弃 meta——标题优先于 meta", () => {
    const longTitle = "a".repeat(80);
    const lines = renderPanel({
      title: longTitle,
      meta: "this metadata text is also fairly long",
      rows: [],
      width: 60,
      mode: "boxed",
    });
    const border = lines[0]!;
    expect(stringWidth(border)).toBe(60);
    expect(border).toContain(longTitle.slice(0, 3)); // 标题头部仍可辨认
  });
});

describe("renderPanel — 非 TTY / 窄终端降级为无框文本", () => {
  it("mode: \"plain\" 时不产生任何框字符,title 单独成行、meta 同行右侧、正文两格缩进", () => {
    const lines = renderPanel({
      title: "运行总览",
      meta: "6/6 完成",
      rows: [{ kind: "line", text: "body line" }],
      width: 82,
      mode: "plain",
    });
    expect(lines.join("\n")).not.toMatch(/[╭╮╰╯├┤]/);
    expect(lines[0]).toContain("运行总览");
    expect(lines[0]).toContain("6/6 完成");
    expect(lines[1]).toBe("  body line");
  });

  it("宽度窄于 60 列时,即便 mode: \"boxed\" 也整体降级为无框文本", () => {
    const lines = renderPanel({
      title: "PLAN",
      rows: [{ kind: "line", text: "x" }],
      width: 59,
      mode: "boxed",
    });
    expect(lines.join("\n")).not.toMatch(/[╭╮╰╯├┤]/);
  });

  it("plain 模式下 divider 行按与顶层相同的规则渲染标题(+meta),不画横隔字符", () => {
    const lines = renderPanel({
      rows: [{ kind: "divider", title: "RESULTS" }],
      width: 82,
      mode: "plain",
    });
    expect(lines.join("\n")).not.toMatch(/[├┤]/);
    expect(lines[0]).toContain("RESULTS");
  });

  it("内容与分节顺序在降级前后一字不变(框只是呈现层)", () => {
    const rows = [
      { kind: "line" as const, text: "first" },
      { kind: "divider" as const, title: "MID" },
      { kind: "line" as const, text: "second" },
    ];
    const boxed = renderPanel({ title: "T", rows, width: 82, mode: "boxed" });
    const plain = renderPanel({ title: "T", rows, width: 82, mode: "plain" });
    const strip = (s: string) => s.replace(/[│╭╮╰╯├┤─\s]/g, "");
    expect(boxed.map(strip).filter(Boolean)).toEqual(plain.map(strip).filter(Boolean));
  });
});

describe("renderPanel — CJK / ambiguous 宽度量测", () => {
  it("CJK 内容按 2 列量测,正文行仍严格对齐到声明宽度", () => {
    const lines = renderPanel({
      title: "运行总览",
      rows: [{ kind: "line", text: "中文内容测试" }], // 6 个汉字 = 12 列
      width: 82,
      mode: "boxed",
    });
    for (const line of lines) expect(stringWidth(line)).toBe(82);
  });

  it("East-Asian-Ambiguous 字符(· ● … × ✓ ✗)恒记 1 列,与 text-layout 的量测表一致", () => {
    const ambiguous = "· ● … × ✓ ✗";
    expect(stringWidth(ambiguous)).toBe(ambiguous.length);
    const lines = renderPanel({
      rows: [{ kind: "line", text: ambiguous }],
      width: 60,
      mode: "boxed",
    });
    for (const line of lines) expect(stringWidth(line)).toBe(60);
  });

  it("panelContentWidth 与实际内容行宽度一致:boxed 少 4 列、plain 少 2 列", () => {
    expect(panelContentWidth(82, "boxed")).toBe(78);
    expect(panelContentWidth(82, "plain")).toBe(80);
    // 宽度低于 60 时 boxed 请求同样按 plain 的算法折算(与 renderPanel 的降级判断一致)
    expect(panelContentWidth(50, "boxed")).toBe(48);
  });

  it("panelContentWidth 的 capWidth: false 豁免同一个 100 上限,内容宽仍是 width - 4", () => {
    expect(panelContentWidth(200, "boxed", false)).toBe(196);
    // 省略第三个参数时默认仍封顶 100,内容宽固定 96,不随 width 继续增长
    expect(panelContentWidth(200, "boxed")).toBe(96);
  });
});
