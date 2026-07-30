// cases: docs/engineering/testing/unit/reports.md
// 分区「面板几何（panel.ts）」的接线部分:证明 Section 的 text 面按 ctx.panelMode 调用
// panel.ts 而非自行拼框字符——顶层完整框、嵌套降横隔、panelMode 缺省/plain 时不画框。
// panel.ts 自己的几何规则(截断优先级、宽度上限、CJK 量测……)由 panel.test.ts 覆盖,这里
// 只证明「Section 真的在用它」。

import { describe, expect, it } from "vitest";
import { createTextContext, renderNodeToText } from "./tree.ts";
import { Col, Grid, Row, Section, Tab, Tabs, Text } from "./primitives.tsx";

describe("Section text 面 — 接线到 panel.ts", () => {
  it("panelMode: \"boxed\" 时顶层 Section 画完整四边框(panel.ts 的产物,不是手拼字符)", () => {
    const ctx = createTextContext({ width: 82, panelMode: "boxed" });
    const text = renderNodeToText(
      <Section title="Overall" meta="6/6 完成">
        <Text>body</Text>
      </Section>,
      ctx,
    );
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^╭─ Overall .*6\/6 完成 ─╮$/);
    expect(lines.at(-1)).toMatch(/^╰─+╯$/);
    expect(lines.some((l) => /^│ body +│$/.test(l))).toBe(true);
  });

  it("嵌套 Section 降为横隔,不画自己的四边框;只有最外层一对 ╭…╮/╰…╯", () => {
    const ctx = createTextContext({ width: 82, panelMode: "boxed" });
    const text = renderNodeToText(
      <Section title="运行总览" meta="6/6 完成">
        <Text>顶层正文</Text>
        <Section title="Cost">
          <Text>嵌套正文</Text>
        </Section>
      </Section>,
      ctx,
    );
    const lines = text.split("\n");
    expect(lines.filter((l) => l.startsWith("╭")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("╰")).length).toBe(1);
    const divider = lines.find((l) => l.startsWith("├"));
    expect(divider).toMatch(/^├─ Cost ─+┤$/);
    expect(text).toContain("顶层正文");
    expect(text).toContain("嵌套正文");
  });

  it("嵌套 Section 通过任意中间层(Col)仍被识别为嵌套——判据是运行期调用栈深度,不是静态直接子节点", () => {
    const ctx = createTextContext({ width: 82, panelMode: "boxed" });
    const text = renderNodeToText(
      <Section title="Outer">
        <Col>
          <Section title="Inner">
            <Text>x</Text>
          </Section>
        </Col>
      </Section>,
      ctx,
    );
    const lines = text.split("\n");
    expect(lines.filter((l) => l.startsWith("╭")).length).toBe(1);
    expect(lines.some((l) => /^├─ Inner ─+┤$/.test(l))).toBe(true);
  });

  it("Row / Grid 内嵌套 Section 走带外横隔通道:不泄漏哨兵，且不再二次吞掉内容宽度", () => {
    const ctx = createTextContext({ width: 82, panelMode: "boxed" });
    const text = renderNodeToText(
      <Section title="Outer">
        <Row>
          <Section title="In row"><Text>{"x".repeat(78)}</Text></Section>
        </Row>
        <Grid>
          <Section title="In grid"><Text>{"y".repeat(78)}</Text></Section>
        </Grid>
      </Section>,
      ctx,
    );
    expect(text).not.toContain("niceeval-panel-divider");
    expect(text).not.toContain("\0");
    expect(text).toMatch(/├─ In row ─+┤/);
    expect(text).toMatch(/├─ In grid ─+┤/);
    expect(text.split("\n").some((line) => line.includes("x".repeat(78)))).toBe(true);
    // Grid 自己的 regular cell padding 留出 4 列；嵌套 Section 必须透传这 74 列，
    // 不能再扣成 70 列。
    expect(text.split("\n").some((line) => line.includes("y".repeat(74)))).toBe(true);
  });

  it("两个独立(非嵌套)的顶层 Section 各自画完整框——不会被上一个 Section 的深度计数误判成嵌套", () => {
    const ctx = createTextContext({ width: 82, panelMode: "boxed" });
    const a = renderNodeToText(
      <Section title="A">
        <Text>a</Text>
      </Section>,
      ctx,
    );
    const b = renderNodeToText(
      <Section title="B">
        <Text>b</Text>
      </Section>,
      ctx,
    );
    expect(a.split("\n")[0]).toMatch(/^╭─ A /);
    expect(b.split("\n")[0]).toMatch(/^╭─ B /);
  });

  it("panelMode 缺省(未声明能力)时降级为无框文本,不产生任何框字符", () => {
    const ctx = createTextContext({ width: 82 }); // 不传 panelMode
    const text = renderNodeToText(
      <Section title="Overall" meta="6/6 完成">
        <Text>body</Text>
      </Section>,
      ctx,
    );
    expect(text).not.toMatch(/[╭╮╰╯├┤]/);
    expect(text).toContain("Overall");
    expect(text).toContain("6/6 完成");
    expect(text).toContain("  body");
  });

  it("panelMode: \"plain\" 时嵌套 Section 不展开横隔,按递归缩进各自显示标题", () => {
    const ctx = createTextContext({ width: 82, panelMode: "plain" });
    const text = renderNodeToText(
      <Section title="Outer">
        <Section title="Inner">
          <Text>x</Text>
        </Section>
      </Section>,
      ctx,
    );
    expect(text).not.toMatch(/[╭╮╰╯├┤]/);
    expect(text).toContain("Outer");
    expect(text).toContain("Inner");
  });
});

// cases: docs/engineering/testing/unit/reports.md 分区「`Tabs` 的 text 面体裁」。
describe("Tabs text 面 — 隔条而非框", () => {
  it("每个 tab 起一条带位次的隔条,Tabs 自己不画框", () => {
    const ctx = createTextContext({ width: 82, panelMode: "boxed" });
    const text = renderNodeToText(
      <Tabs>
        <Tab title="概览">
          <Text>overview</Text>
        </Tab>
        <Tab title="成本">
          <Text>cost</Text>
        </Tab>
      </Tabs>,
      ctx,
    );
    const lines = text.split("\n");
    expect(lines[0]!.startsWith("── 概览 1/2 ─")).toBe(true);
    expect(lines.some((l) => l.startsWith("── 成本 2/2 ─"))).toBe(true);
    expect(text).not.toMatch(/[╭╮╰╯│├┤]/);
  });

  it("tab 正文不缩进:同一段内容在 tab 里与直接放在页上逐字相同", () => {
    const wide = "实验                       模型      Agent    通过率";
    const bare = renderNodeToText(<Text>{wide}</Text>, createTextContext({ width: 82, panelMode: "boxed" }));
    const inTab = renderNodeToText(
      <Tabs>
        <Tab title="概览">
          <Text>{wide}</Text>
        </Tab>
      </Tabs>,
      createTextContext({ width: 82, panelMode: "boxed" }),
    );
    expect(inTab.split("\n\n").at(-1)).toBe(bare);
  });

  it("tab 里放 Section 时框由那个 Section 画,输出里只有一层边框", () => {
    const ctx = createTextContext({ width: 82, panelMode: "boxed" });
    const text = renderNodeToText(
      <Tabs>
        <Tab title="诊断">
          <Section title="Assertions">
            <Text>body</Text>
          </Section>
        </Tab>
      </Tabs>,
      ctx,
    );
    const lines = text.split("\n");
    expect(lines[0]!.startsWith("── 诊断 1/1 ─")).toBe(true);
    expect(lines.filter((l) => l.startsWith("╭")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("╰")).length).toBe(1);
  });
});
