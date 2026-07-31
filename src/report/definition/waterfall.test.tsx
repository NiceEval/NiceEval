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
  const definition = defineReport(() => node as never);
  const resolved = await resolveReportTree(node as never, {
    scope,
    results,
    report: buildReportMeta(definition, scope),
    page: { id: "main", input: scope },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved;
}

function attemptLocatorOfTarget(target: { page: string; params?: unknown }): string | undefined {
  if (target.page !== "attempt") return undefined;
  const locator = (target.params as { locator?: unknown } | undefined)?.locator;
  return typeof locator === "string" ? locator : undefined;
}

const webCtx: WebContext = {
  locale: "en",
  href: (target) => {
    const locator = attemptLocatorOfTarget(target);
    return locator === undefined ? undefined : `attempt/${encodeURIComponent(locator)}.html`;
  },
  dimension: () => {
    throw new UndeclaredDimensionValueError("unbound", "_");
  },
};

describe("Waterfall", () => {
  it("两面投影:身份、总耗时、节点计数、失败标记与 attempt 链接", async () => {
    const tree = await resolve(<Waterfall nodes={content} />);
    const text = renderNodeToText(
      tree,
      createTextContext({
        width: 100,
        command: (target) => {
          const locator = attemptLocatorOfTarget(target);
          return locator === undefined ? undefined : `niceeval show attempt ${locator}`;
        },
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
    expect(html).toContain("niceeval-span-kind-");
    expect(html).toContain("niceeval-waterfall-node--failed");
    expect(html).toContain("<details");
  });

  it("null duration 如实标注缺失,不绘分解条", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={[
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
    const emptyTree = await resolve(<Waterfall nodes={[]} />);
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");

    const nullTree = await resolve(<Waterfall nodes={null} />);
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
        nodes={foldRow([
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
    // 折叠只作用于清单:条上的叶子一段不少
    expect(html.match(/niceeval-waterfall-bar/g)).toHaveLength(4);
  });

  it("区分力:把一个短节点抬到行总时长 1% 以上,只有它离开摘要", async () => {
    const withShort = (aMs: number) =>
      foldRow([
        { key: "big", label: "sample", kind: "model", startOffsetMs: 0, durationMs: 22_000 },
        { key: "s1", label: "call-a", kind: "tool", startOffsetMs: 22_000, durationMs: aMs },
        { key: "s2", label: "call-b", kind: "tool", startOffsetMs: 23_100, durationMs: 300 },
        { key: "s3", label: "call-c", kind: "tool", startOffsetMs: 23_400, durationMs: 300 },
      ]);
    const below = await resolve(<Waterfall nodes={withShort(500)} />);
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(below as never))).toContain("tool ×3");

    const above = await resolve(<Waterfall nodes={withShort(1_100)} />);
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(above as never));
    // 1_100ms ≥ 1% × 100_000ms,call-a 直接列出;call-b / call-c 仍在摘要里
    expect(html).toContain("tool ×2");
    expect(html).not.toContain("tool ×3");
    expect(html).toContain("call-a");
  });

  it("短节点摘要只收得到一条时不折,直接列出那个节点", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          { key: "big1", label: "sample", kind: "model", startOffsetMs: 0, durationMs: 22_000 },
          { key: "lone", label: "corepack", kind: "command", startOffsetMs: 22_000, durationMs: 300 },
          { key: "big2", label: "stream", kind: "model", startOffsetMs: 22_300, durationMs: 10_000 },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).not.toContain("command ×1");
    expect(html).not.toContain("niceeval-waterfall-fold");
    expect(html).toContain("corepack");
  });

  it("failed 与 durationMs null 的节点不折;行总时长 null 整行不折", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          { key: "f", label: "boom", kind: "tool", startOffsetMs: 0, durationMs: 200, failed: true },
          { key: "m", label: "lost", kind: "tool", startOffsetMs: 200, durationMs: null },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).not.toContain("niceeval-waterfall-fold");

    const noBase = await resolve(
      <Waterfall
        nodes={[
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
      { key: "s2", label: "call-b", kind: "tool", startOffsetMs: 50_400, durationMs: 400 },
    ]);
    const tree = await resolve(<Waterfall nodes={data} />);
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-waterfall-fold");
    expect(html).toContain("inner");
    const text = renderNodeToText(tree, createTextContext({ width: 100 }));
    expect(text).toContain("4 nodes");
  });

  it("open 标记的节点默认展开且不参与折叠", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
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
    const tree = await resolve(<Waterfall nodes={content} title={{ en: "Agent trace", "zh-CN": "Agent trace" }} />);
    const text = renderNodeToText(tree, createTextContext({ width: 100 }));
    expect(text.split("\n")[0]).toBe("Agent trace");
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("niceeval-waterfall-title");
    expect(html).toContain("Agent trace");

    const emptyTree = await resolve(<Waterfall nodes={[]} title="Agent trace" />);
    expect(runWithWebContext(webCtx, () => renderToStaticMarkup(emptyTree as never))).toBe("");
    expect(renderNodeToText(emptyTree, createTextContext({ width: 40 }))).toBe("");
  });

  it("行头 label 与 locator 同文时只渲染 locator 一次", async () => {
    const same = await resolve(
      <Waterfall
        nodes={[{ key: "r", label: "@abc", durationMs: 100, locator: locator("@abc"), nodes: [] }]}
      />,
    );
    const sameHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(same as never));
    expect(sameHtml).not.toContain("niceeval-waterfall-label");
    // href 编码成 %40abc,可读文本里 @abc 只出现一次(链接文本)
    expect(sameHtml.match(/@abc/g)?.length).toBe(1);

    const diff = await resolve(
      <Waterfall
        nodes={[{ key: "r", label: "exp/eval", durationMs: 100, locator: locator("@abc"), nodes: [] }]}
      />,
    );
    const diffHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(diff as never));
    expect(diffHtml).toContain("niceeval-waterfall-label");
    expect(diffHtml).toContain("exp/eval");
  });

  // 「Waterfall 的重复折叠」类别:连续、同 kind、label 同文的显著节点满三条起折。
  // 显著阈值仍是 1%,下面每个节点都是 5s / 100s,全部显著——收不住它们的是长度,不是短。
  const repeated = (n: number, label: string, from: number) =>
    Array.from({ length: n }, (_, i) => ({
      key: `${label}-${from + i}`,
      label,
      kind: "model",
      startOffsetMs: (from + i) * 5_000,
      durationMs: 5_000,
    }));

  it("连续同名的显著节点满三条折成一条,展开后逐条还原", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          ...repeated(2, "stream", 0),
          { key: "cut", label: "patch", kind: "tool", startOffsetMs: 10_000, durationMs: 5_000 },
          ...repeated(3, "stream", 3),
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    // 异名节点切断连续段:前两条摊开,后三条折成一条
    expect(html).toContain("stream ×3");
    expect(html).not.toContain("stream ×5");
    expect(html).toContain("niceeval-waterfall-fold");
    // 展开后逐条还原:6 个节点行(2 摊开 + 1 切断 + 3 在摘要里)
    expect(html.match(/niceeval-waterfall-node-name/g)).toHaveLength(7); // 6 节点 + 1 摘要行
  });

  it("区分力:同一批同名节点从三条减到两条就不折", async () => {
    const three = await resolve(<Waterfall nodes={foldRow(repeated(3, "stream", 0))} />);
    const threeHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(three as never));
    expect(threeHtml).toContain("stream ×3");

    const two = await resolve(<Waterfall nodes={foldRow(repeated(2, "stream", 0))} />);
    const twoHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(two as never));
    expect(twoHtml).not.toContain("niceeval-waterfall-fold");
    expect(twoHtml).not.toContain("stream ×2");
  });

  it("failed 与 open 的节点不参与重复折叠,即使与相邻节点同名", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          ...repeated(3, "stream", 0).map((node, i) =>
            i === 1 ? { ...node, failed: true } : i === 2 ? { ...node, open: true } : node,
          ),
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).not.toContain("niceeval-waterfall-fold");
    expect(html).not.toContain("stream ×");
  });

  it("短节点摘要与重复摘要各自成行,不合并成一条", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          { key: "t1", label: "tiny-a", kind: "tool", startOffsetMs: 0, durationMs: 100 },
          { key: "t2", label: "tiny-b", kind: "tool", startOffsetMs: 100, durationMs: 100 },
          ...repeated(3, "stream", 1),
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("tool ×2");
    expect(html).toContain("stream ×3");
    expect(html.match(/niceeval-waterfall-fold&quot;|class="niceeval-waterfall-fold"/g)).toHaveLength(2);
  });

  // 「Waterfall 的分解条取叶子」类别:条画树里没有 children 的节点,递归取。
  const bars = (html: string) => [...html.matchAll(/niceeval-waterfall-bar[^>]*title="([^"]*)"/g)].map((m) => m[1]!);

  it("条上的段数等于叶子数,父节点不出段", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          {
            key: "parent",
            label: "eval.run",
            kind: "phase",
            startOffsetMs: 0,
            durationMs: 100_000,
            open: true,
            children: [
              { key: "l1", label: "leaf-a", kind: "model", startOffsetMs: 0, durationMs: 40_000 },
              {
                key: "mid",
                label: "turn",
                kind: "turn",
                startOffsetMs: 40_000,
                durationMs: 60_000,
                open: true,
                children: [{ key: "l2", label: "leaf-b", kind: "tool", startOffsetMs: 40_000, durationMs: 60_000 }],
              },
            ],
          },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    // 4 个节点里只有两个叶子;占满全行的 eval.run 不出段,否则整条是一块实心
    expect(bars(html).map((t) => t.split(" ·")[0])).toEqual(["leaf-a", "leaf-b"]);
  });

  it("区分力:给叶子挂上子节点,段数不变而段换成子节点", async () => {
    const leaf = { key: "l", label: "leaf-a", kind: "model", startOffsetMs: 0, durationMs: 40_000 };
    const flat = await resolve(<Waterfall nodes={foldRow([leaf])} />);
    expect(bars(runWithWebContext(webCtx, () => renderToStaticMarkup(flat as never))).map((t) => t.split(" ·")[0])).toEqual(
      ["leaf-a"],
    );

    const nested = await resolve(
      <Waterfall
        nodes={foldRow([
          {
            ...leaf,
            open: true,
            children: [{ key: "inner", label: "leaf-inner", kind: "model", startOffsetMs: 0, durationMs: 40_000 }],
          },
        ])}
      />,
    );
    const nestedHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(nested as never));
    // 取的是叶子,不是顶层也不是全部节点:段数仍是 1,身份换成了子节点
    expect(bars(nestedHtml).map((t) => t.split(" ·")[0])).toEqual(["leaf-inner"]);
  });

  it("测不出时长的叶子不出段;全部叶子都缺时长时整条不画", async () => {
    const partial = await resolve(
      <Waterfall
        nodes={foldRow([
          { key: "ok", label: "leaf-a", kind: "model", startOffsetMs: 0, durationMs: 40_000 },
          { key: "lost", label: "leaf-b", kind: "model", startOffsetMs: 40_000, durationMs: null },
        ])}
      />,
    );
    const partialHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(partial as never));
    expect(bars(partialHtml).map((t) => t.split(" ·")[0])).toEqual(["leaf-a"]);
    expect(partialHtml).toContain("leaf-b"); // 清单里照常列,只是条上没有段

    const none = await resolve(
      <Waterfall
        nodes={foldRow([{ key: "lost", label: "leaf-b", kind: "model", startOffsetMs: 0, durationMs: null }])}
      />,
    );
    const noneHtml = runWithWebContext(webCtx, () => renderToStaticMarkup(none as never));
    expect(noneHtml).not.toContain("niceeval-waterfall-track");
    expect(noneHtml).toContain("leaf-b");
  });

  it("失败叶子的段带 negative 类,与它落的分类色槽无关", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          { key: "f", label: "apply_patch", kind: "tool", startOffsetMs: 0, durationMs: 40_000, failed: true },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toMatch(/niceeval-waterfall-bar niceeval-span-kind-\d niceeval-span-failed/);
  });

  // 「Waterfall 的类别着色不认词表」类别:色槽由 kind 字面稳定散列出来。
  const slotOf = (html: string, title: string): string => {
    const m = html.match(new RegExp(`niceeval-span-kind-(\\d)[^>]*title="${title} `));
    return m?.[1] ?? "none";
  };

  it("同一个 kind 恒落同一槽,与顺序、行和层级无关", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={[
          {
            key: "r1",
            label: "Row 1",
            durationMs: 100_000,
            nodes: [
              { key: "a", label: "top", kind: "model", startOffsetMs: 0, durationMs: 10_000 },
              { key: "b", label: "other", kind: "tool", startOffsetMs: 10_000, durationMs: 10_000 },
              {
                key: "c",
                label: "wrap",
                kind: "phase",
                startOffsetMs: 20_000,
                durationMs: 10_000,
                open: true,
                children: [{ key: "c1", label: "nested", kind: "model", startOffsetMs: 20_000, durationMs: 10_000 }],
              },
            ],
          },
          {
            key: "r2",
            label: "Row 2",
            durationMs: 100_000,
            nodes: [{ key: "d", label: "second-row", kind: "model", startOffsetMs: 0, durationMs: 10_000 }],
          },
        ]}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    const top = slotOf(html, "top");
    expect(top).not.toBe("none");
    expect(slotOf(html, "nested")).toBe(top);
    expect(slotOf(html, "second-row")).toBe(top);
  });

  it("区分力:没见过的 kind 照样落到五槽之一", async () => {
    const tree = await resolve(
      <Waterfall
        nodes={foldRow([
          { key: "u", label: "unknown-kind", kind: "sandbox.snapshot", startOffsetMs: 0, durationMs: 10_000 },
        ])}
      />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    // 色槽是散列出来的,不是查表查出来的:词表换一套,呈现不失效
    expect(["0", "1", "2", "3", "4"]).toContain(slotOf(html, "unknown-kind"));
  });

  it("清单里的类别列不带着色类", async () => {
    const tree = await resolve(
      <Waterfall nodes={foldRow([{ key: "a", label: "top", kind: "model", startOffsetMs: 0, durationMs: 10_000 }])} />,
    );
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain('<span class="niceeval-waterfall-node-kind">model</span>');
    // 着色只在条上:清单区段里一个色类都没有
    const list = html.slice(html.indexOf("niceeval-waterfall-nodes"));
    expect(list).not.toContain("niceeval-span-");
  });


});
