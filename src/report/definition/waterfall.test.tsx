// cases: docs/engineering/testing/unit/reports.md
// 「Callouts / Waterfall / … 的两面投影与维度封闭性」——Waterfall 条目。
// 断言面是 Content 与两面输出字符串，不经浏览器。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AttemptLocator } from "../../record/locator.ts";
import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  ResolveMemo,
  type WebContext,
} from "./tree.ts";
import { buildReportMeta, defineReport } from "./report.ts";
import { Waterfall, type WaterfallContent } from "./primitives/waterfall.tsx";
import { defineSource } from "../source.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const locator = (s: string): AttemptLocator => s as AttemptLocator;

const content: WaterfallContent = [
  {
    key: "row-a",
    label: "Attempt A",
    durationMs: 1000,
    locator: locator("exp/a/0"),
    nodes: [
      {
        key: "n1",
        label: "agent",
        kind: "agent",
        startOffsetMs: 0,
        durationMs: 600,
      },
      {
        key: "n2",
        label: "tool",
        kind: "tool",
        startOffsetMs: 600,
        durationMs: null,
        failed: true,
        children: [
          {
            key: "n2a",
            label: "retry",
            kind: "tool",
            startOffsetMs: 0,
            durationMs: 200,
            failed: true,
          },
        ],
      },
    ],
  },
  {
    key: "row-b",
    label: "No trace",
    durationMs: null,
    nodes: [],
  },
];

async function resolve(node: React.ReactNode) {
  const scope = scopeOf([]);
  const { results } = emptyScopeAndResults();
  const definition = defineReport(node as never);
  const resolved = await resolveReportTree(node as never, {
    scope,
    results,
    report: buildReportMeta(definition, scope),
    page: { id: "main", input: "scope" },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved;
}

const webCtx: WebContext = {
  locale: "en",
  attemptHref: (loc) => `attempt/${encodeURIComponent(loc)}.html`,
  dimension: () => {
    throw new UndeclaredDimensionValueError("unbound", "_");
  },
};

describe("Waterfall", () => {
  it("两面投影:身份、总耗时、节点计数、失败标记与 attempt 链接", async () => {
    const tree = await resolve(<Waterfall data={content} />);
    const text = renderNodeToText(
      tree,
      createTextContext({
        width: 100,
        attemptCommand: (loc) => `niceeval show attempt ${loc}`,
      }),
    );
    expect(text).toContain("Attempt A");
    expect(text).toContain("1.0s");
    expect(text).toContain("3 nodes");
    expect(text).toContain("✗ 2 failed");
    expect(text).toContain("niceeval show attempt exp/a/0");
    expect(text).toContain("No trace");
    expect(text).toContain("—");

    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-waterfall");
    expect(html).toContain("Attempt A");
    expect(html).toContain('href="attempt/exp%2Fa%2F0.html"');
    expect(html).toContain("niceeval-waterfall-track");
    expect(html).toContain("niceeval-span-agent");
    expect(html).toContain("niceeval-waterfall-node--failed");
    expect(html).toContain("<details");
  });

  it("null duration 如实标注缺失,不绘分解条", async () => {
    const tree = await resolve(
      <Waterfall
        data={[
          {
            key: "missing",
            label: "Missing row",
            durationMs: null,
            nodes: [
              {
                key: "leaf",
                label: "span",
                kind: "model",
                startOffsetMs: 0,
                durationMs: null,
              },
            ],
          },
        ]}
      />,
    );
    const text = renderNodeToText(tree, createTextContext({ width: 80 }));
    expect(text).toContain("Missing row · —");
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).not.toContain("niceeval-waterfall-track");
    expect(html).toContain("niceeval-waterfall-node-dur");
    expect(html).toContain("—");
  });

  it("空数组与 null Content 零输出", async () => {
    const emptyTree = await resolve(<Waterfall data={[]} />);
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");

    const nullTree = await resolve(<Waterfall data={null} />);
    expect(renderNodeToText(nullTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(nullTree as never))).toBe("");
  });

  // 「Waterfall 的显著性折叠与区块头」类别的显著阈值:占比 1%,基准是行总时长。
  const foldRow = (nodes: WaterfallContent[number]["nodes"]): WaterfallContent => [
    { key: "r", label: "Row", durationMs: 100_000, nodes },
  ];

  it("连续短节点折成带 kind 计数与合计时长的摘要,留在原时间位置", async () => {
    const tree = await resolve(
      <Waterfall
        data={foldRow([
          { key: "big1", label: "sample", kind: "model", startOffsetMs: 0, durationMs: 22_000 },
          { key: "s1", label: "call-a", kind: "tool", startOffsetMs: 22_000, durationMs: 500 },
          { key: "s2", label: "call-b", kind: "tool", startOffsetMs: 22_500, durationMs: 300 },
          { key: "big2", label: "stream", kind: "model", startOffsetMs: 23_000, durationMs: 10_000 },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("tool ×2");
    expect(html).toContain("800ms total");
    expect(html).toContain("niceeval-waterfall-fold");
    // 摘要在两个显著节点之间(原时间位置),展开后逐条还原;
    // 色带条的 title 属性也含节点名,顺序断言收窄到清单区段
    const list = html.slice(html.indexOf("niceeval-waterfall-nodes"));
    expect(list.indexOf("sample")).toBeLessThan(list.indexOf("tool ×2"));
    expect(list.indexOf("tool ×2")).toBeLessThan(list.indexOf("stream"));
    expect(html).toContain("call-a");
    expect(html).toContain("call-b");
    // 色带分解条仍含全部节点
    expect(html.match(/niceeval-waterfall-bar/g)).toHaveLength(4);
  });

  it("区分力:把一个短节点抬到行总时长 1% 以上,只有它离开摘要", async () => {
    const tree = await resolve(
      <Waterfall
        data={foldRow([
          { key: "big", label: "sample", kind: "model", startOffsetMs: 0, durationMs: 22_000 },
          { key: "s1", label: "call-a", kind: "tool", startOffsetMs: 22_000, durationMs: 1_100 },
          { key: "s2", label: "call-b", kind: "tool", startOffsetMs: 23_100, durationMs: 300 },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    // 1_100ms ≥ 1% × 100_000ms,call-a 直接列出;call-b 仍在摘要里
    expect(html).toContain("tool ×1");
    expect(html).not.toContain("tool ×2");
  });

  it("failed 与 durationMs null 的节点不折;行总时长 null 整行不折", async () => {
    const tree = await resolve(
      <Waterfall
        data={foldRow([
          { key: "f", label: "boom", kind: "tool", startOffsetMs: 0, durationMs: 200, failed: true },
          { key: "m", label: "lost", kind: "tool", startOffsetMs: 200, durationMs: null },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).not.toContain("niceeval-waterfall-fold");

    const noBase = await resolve(
      <Waterfall
        data={[
          {
            key: "r",
            label: "Row",
            durationMs: null,
            nodes: [
              { key: "s1", label: "tiny-a", kind: "tool", startOffsetMs: 0, durationMs: 1 },
              { key: "s2", label: "tiny-b", kind: "tool", startOffsetMs: 1, durationMs: 1 },
            ],
          },
        ]}
      />,
    );
    const noBaseHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(noBase as never));
    expect(noBaseHtml).not.toContain("niceeval-waterfall-fold");
    expect(noBaseHtml).toContain("tiny-a");
    expect(noBaseHtml).toContain("tiny-b");
  });

  it("被折节点的 children 展开后原样还原;text 面节点计数仍计全部节点", async () => {
    const data = foldRow([
      { key: "big", label: "sample", kind: "model", startOffsetMs: 0, durationMs: 50_000 },
      {
        key: "s",
        label: "call",
        kind: "tool",
        startOffsetMs: 50_000,
        durationMs: 400,
        children: [{ key: "sc", label: "inner", kind: "tool", startOffsetMs: 50_000, durationMs: 100 }],
      },
    ]);
    const tree = await resolve(<Waterfall data={data} />);
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-waterfall-fold");
    expect(html).toContain("inner");
    const text = renderNodeToText(tree, createTextContext({ width: 100 }));
    expect(text).toContain("3 nodes");
  });

  it("open 标记的节点默认展开且不参与折叠", async () => {
    const tree = await resolve(
      <Waterfall
        data={foldRow([
          { key: "big", label: "sample", kind: "model", startOffsetMs: 0, durationMs: 50_000 },
          {
            key: "trunk",
            label: "turn-1",
            kind: "turn",
            startOffsetMs: 50_000,
            durationMs: 400, // 低于 1% 但带 open:主干不折
            open: true,
            children: [{ key: "leaf", label: "inner", kind: "tool", startOffsetMs: 50_100, durationMs: 5_000 }],
          },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).not.toContain("niceeval-waterfall-fold");
    // 默认展开:children 直接可见
    expect(html).toContain('<details open=""');
    expect(html).toContain("inner");
  });

  it("title 在两面渲染为区块头;Content 空时整块含标题不出现", async () => {
    const tree = await resolve(<Waterfall data={content} title={{ en: "Agent trace", "zh-CN": "Agent trace" }} />);
    const text = renderNodeToText(tree, createTextContext({ width: 100 }));
    expect(text.split("\n")[0]).toBe("Agent trace");
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-waterfall-title");
    expect(html).toContain("Agent trace");

    const emptyTree = await resolve(<Waterfall data={[]} title="Agent trace" />);
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
  });

  it("行头 label 与 locator 同文时只渲染 locator 一次", async () => {
    const same = await resolve(
      <Waterfall
        data={[{ key: "r", label: "@abc", durationMs: 100, locator: locator("@abc"), nodes: [] }]}
      />,
    );
    const sameHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(same as never));
    expect(sameHtml).not.toContain("niceeval-waterfall-label");
    // href 编码成 %40abc,可读文本里 @abc 只出现一次(链接文本)
    expect(sameHtml.match(/@abc/g)?.length).toBe(1);

    const diff = await resolve(
      <Waterfall
        data={[{ key: "r", label: "exp/eval", durationMs: 100, locator: locator("@abc"), nodes: [] }]}
      />,
    );
    const diffHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(diff as never));
    expect(diffHtml).toContain("niceeval-waterfall-label");
    expect(diffHtml).toContain("exp/eval");
  });

  it("source 与 data 等价", async () => {
    const source = defineSource({
      name: "wf",
      compute: async () => content,
    });
    const fromData = await resolve(<Waterfall data={content} />);
    const fromSource = await resolve(<Waterfall source={source} />);
    const textData = renderNodeToText(fromData, createTextContext({ width: 100 }));
    const textSource = renderNodeToText(fromSource, createTextContext({ width: 100 }));
    expect(textSource).toBe(textData);
  });
});
