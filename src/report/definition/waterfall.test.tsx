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
    expect(html).toContain("nre-waterfall");
    expect(html).toContain("Attempt A");
    expect(html).toContain('href="attempt/exp%2Fa%2F0.html"');
    expect(html).toContain("nre-waterfall-track");
    expect(html).toContain("nre-span-agent");
    expect(html).toContain("nre-waterfall-node--failed");
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
    expect(html).not.toContain("nre-waterfall-track");
    expect(html).toContain("nre-waterfall-node-dur");
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
