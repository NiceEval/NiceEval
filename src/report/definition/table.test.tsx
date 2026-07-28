// cases: docs/engineering/testing/unit/reports.md
// 「Table 的 subRows 与 placeholder」「数据源选项归一」（Column）
// 断言面是 Content 与两面输出字符串，不经浏览器。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
import { Column, Table } from "./primitives.tsx";
import { defineSource } from "../source.ts";
import type { TableContent } from "./cell.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const content: TableContent = {
  columns: [
    { key: "name" },
    { key: "score", better: "higher" },
  ],
  rows: [
    {
      key: "parent",
      cells: {
        name: { kind: "text", text: "parent" },
        score: { kind: "score", earned: 3, possible: 5 },
      },
      subRows: [
        {
          key: "child",
          cells: {
            name: { kind: "text", text: "child" },
            score: { kind: "score", earned: 1, possible: 2 },
          },
        },
      ],
    },
    {
      key: "gap",
      variant: "placeholder",
      cells: {
        name: { kind: "missing", code: "not-run" },
        score: { kind: "notApplicable" },
      },
    },
  ],
};

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

describe("Table Content", () => {
  it("subRows 在 text 与 web 两面逐层渲染", async () => {
    const tree = await resolve(<Table data={content} />);
    const text = renderNodeToText(tree, createTextContext({ width: 80 }));
    expect(text).toContain("parent");
    expect(text).toMatch(/ {2}child/);
    expect(text).toContain("3 / 5");

    const webCtx: WebContext = {
      locale: "en",
      dimension: () => {
        throw new UndeclaredDimensionValueError("unbound", "_");
      },
    };
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("parent");
    expect(html).toContain("child");
    expect(html).toContain('data-depth="1"');
  });

  it("placeholder 行照常显示,不与普通行混淆", async () => {
    const tree = await resolve(<Table data={content} />);
    const text = renderNodeToText(tree, createTextContext({ width: 80 }));
    expect(text).toContain("not-run");
    expect(text).toContain("—");
    const webCtx: WebContext = {
      locale: "en",
      dimension: () => {
        throw new UndeclaredDimensionValueError("unbound", "_");
      },
    };
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
    expect(html).toContain("nre-row-placeholder");
    expect(html).toContain("not-run");
  });

  it("<Column> 整体替换默认列;source 与 data 等价", async () => {
    const source = defineSource({
      name: "t",
      compute: async () => content,
    });
    const withCols = await resolve(
      <Table data={content}>
        <Column dataKey="score" header="Score" align="right" />
      </Table>,
    );
    const fromSource = await resolve(<Table source={source} />);
    const textCols = renderNodeToText(withCols, createTextContext({ width: 80 }));
    const textSource = renderNodeToText(fromSource, createTextContext({ width: 80 }));
    expect(textCols).toContain("Score");
    expect(textCols).not.toContain("parent"); // 只有 score 列
    expect(textSource).toContain("parent");
    expect(textSource).toContain("child");
  });

  it("旧 columns/rows 字符串形态仍可用", () => {
    const text = renderNodeToText(
      <Table columns={[{ key: "a", header: "A" }]} rows={[{ key: "r", cells: { a: "x" } }]} />,
      createTextContext({ width: 40 }),
    );
    expect(text).toContain("A");
    expect(text).toContain("x");
  });
});
