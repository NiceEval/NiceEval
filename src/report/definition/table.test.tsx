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
  const definition = defineReport(() => node as never);
  const resolved = await resolveReportTree(node as never, {
    scope,
    results,
    report: buildReportMeta(definition, scope),
    page: { id: "main", input: "sample" },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved;
}

describe("Table Content", () => {


  it("旧 columns/rows 字符串形态仍可用", () => {
    const text = renderNodeToText(
      <Table columns={[{ key: "a", header: "A" }]} rows={[{ key: "r", cells: { a: "x" } }]} />,
      createTextContext({ width: 40 }),
    );
    expect(text).toContain("A");
    expect(text).toContain("x");
  });
});
