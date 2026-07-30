// cases: docs/engineering/testing/unit/reports.md
// 「Table 的 subRows 与 placeholder」(含行 key 按层级同层判重)「普通 rows props」
// 「表格行形状与列集同源」(断言面是校验错误对象)「表头长在列声明上」(断言面是两面输出字符串)。
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
import { Table, TableContentView } from "./primitives.tsx";
import type { TableContent } from "./cell.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";
import { stabilityMatrixContent } from "../slices/content.ts";
import { attemptAssertionsContent } from "../components/attempt-detail/content.tsx";

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
  it("公开 Table 直接消费普通 rows", () => {
    const text = renderNodeToText(
      <Table columns={[{ field: "answer", label: "Answer" }]} rows={[{ answer: "x" }]} />,
      createTextContext({ width: 40 }),
    );
    expect(text).toContain("Answer");
    expect(text).toContain("x");
  });

  it("内部富 Cell 适配保留 subRows 与 placeholder，两面读取同一 Content", async () => {
    const resolved = await resolve(<TableContentView data={content} />);
    const text = renderNodeToText(resolved, createTextContext({ width: 60 }));
    expect(text).toContain("parent");
    expect(text).toContain("child");
    const webCtx = {
      locale: "en",
      dimension: () => {
        throw new UndeclaredDimensionValueError("unexpected", "x");
      },
    } as WebContext;
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as never));
    expect(html).toContain("niceeval-row-placeholder");
    expect(html).toContain("child");
  });

  it("行 key 按层级同层判重：不同父行下的同名子行合法", async () => {
    // 复现场景：两个 Experiment 父行各带一个同名 eval 子行(install/gpt-researcher)。
    const twoParents: TableContent = {
      columns: [{ key: "name" }],
      rows: [
        {
          key: "install/canary",
          cells: { name: { kind: "text", text: "canary" } },
          subRows: [{ key: "install/gpt-researcher", cells: { name: { kind: "text", text: "gpt-researcher" } } }],
        },
        {
          key: "install/v0.11.0",
          cells: { name: { kind: "text", text: "v0.11.0" } },
          subRows: [{ key: "install/gpt-researcher", cells: { name: { kind: "text", text: "gpt-researcher" } } }],
        },
      ],
    };
    const resolved = await resolve(<TableContentView data={twoParents} />);
    const text = renderNodeToText(resolved, createTextContext({ width: 60 }));
    expect(text).toContain("gpt-researcher");
    const webCtx = {
      locale: "en",
      dimension: () => {
        throw new UndeclaredDimensionValueError("unexpected", "x");
      },
    } as WebContext;
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as never));
    expect(html).toContain("gpt-researcher");
  });

  it("判定格 web 面:计票逐票带语义 class,单判定带 verdictMark 判定符与语义 class", async () => {
    // cases: docs/engineering/testing/unit/reports.md「判定构成列每层都有值」的 web 面判据。
    const verdicts: TableContent = {
      columns: [{ key: "name" }, { key: "record" }],
      rows: [
        {
          key: "q",
          cells: {
            name: { kind: "text", text: "q" },
            record: { kind: "verdict", counts: { passed: 1, failed: 1, errored: 0, skipped: 0 } },
          },
          subRows: [
            {
              key: "q@0",
              cells: { name: { kind: "text", text: "q@0" }, record: { kind: "verdict", verdict: "errored" } },
            },
          ],
        },
      ],
    };
    const resolved = await resolve(<TableContentView data={verdicts} />);
    const webCtx = {
      locale: "zh-CN",
      dimension: () => {
        throw new UndeclaredDimensionValueError("unexpected", "x");
      },
    } as WebContext;
    const html = runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as never));
    expect(html).toContain("niceeval-verdict-passed");
    expect(html).toContain("niceeval-verdict-failed");
    expect(html).toContain("1 通过");
    expect(html).toContain("1 失败");
    // 单判定:判定符走 verdictMark 单源,errored 是 `!` 不并到 `✗`
    expect(html).toContain("niceeval-verdict-errored");
    expect(html).toContain("! 错误");
  });

  it("同层重复行 key 在两面都报完整错误", () => {
    const duplicated: TableContent = {
      columns: [{ key: "name" }],
      rows: [
        { key: "dup", cells: { name: { kind: "text", text: "a" } } },
        { key: "dup", cells: { name: { kind: "text", text: "b" } } },
      ],
    };
    expect(() =>
      renderNodeToText(<TableContentView data={duplicated} />, createTextContext({ width: 60 })),
    ).toThrow(/declared twice at the same level/);
  });
});

function webHtml(node: React.ReactNode, locale = "en"): string {
  const webCtx = {
    locale,
    dimension: () => {
      throw new UndeclaredDimensionValueError("unexpected", "x");
    },
  } as WebContext;
  return runWithWebContext(webCtx, () => renderToStaticMarkup(node as never));
}

function textOf(node: Parameters<typeof renderNodeToText>[0]): string {
  return renderNodeToText(node, createTextContext({ width: 110 }));
}

describe("表格行形状与列集同源", () => {
  // cases: docs/engineering/testing/unit/reports.md「表格行形状与列集同源」。
  // 断言面是校验错误对象。
  const shapeColumns: TableContent["columns"] = [{ key: "entity" }, { key: "record" }];
  const entityCell = { kind: "text" as const, text: "exp/a" };
  const recordCell = { kind: "notApplicable" as const };

  it("行写了列集外的 key:错误指到行 key 与那个列 key", () => {
    const extra: TableContent = {
      columns: shapeColumns,
      rows: [
        {
          key: "exp/a",
          // verdict 不在列集里:渲染面永远读不到它,不能悄悄丢掉
          cells: { entity: entityCell, record: recordCell, verdict: { kind: "verdict", verdict: "passed" } },
        },
      ],
    };
    expect(() => textOf(<TableContentView data={extra} />)).toThrow(
      /row "exp\/a" has a cell for "verdict", which is not a declared column/,
    );
    // 下一步写在报错里:要么丢格子,要么补列
    expect(() => textOf(<TableContentView data={extra} />)).toThrow(/Drop the cell, or declare a "verdict" column/);
  });

  it("行漏写一个声明列:错误指到行 key 与缺的列 key,并给出 notApplicable 的写法", () => {
    const missing: TableContent = {
      columns: shapeColumns,
      rows: [{ key: "exp/a", cells: { entity: entityCell } }],
    };
    expect(() => textOf(<TableContentView data={missing} />)).toThrow(
      /row "exp\/a" has no cell for column "record"/,
    );
    expect(() => textOf(<TableContentView data={missing} />)).toThrow(/kind: "notApplicable"/);
  });

  it("各层 subRows 同规则:漏列的是孙行时错误指到孙行的 key", () => {
    const nested: TableContent = {
      columns: shapeColumns,
      rows: [
        {
          key: "exp/a",
          cells: { entity: entityCell, record: recordCell },
          subRows: [
            {
              key: "exp/a:weather",
              cells: { entity: entityCell, record: recordCell },
              subRows: [{ key: "@1aaaaa01", cells: { entity: entityCell } }],
            },
          ],
        },
      ],
    };
    expect(() => textOf(<TableContentView data={nested} />)).toThrow(
      /row "@1aaaaa01" has no cell for column "record"/,
    );
  });

  it("placeholder 与 group 行同规则,不因为 variant 豁免", () => {
    const placeholder: TableContent = {
      columns: shapeColumns,
      rows: [{ key: "exp/a:gap:missing", variant: "placeholder", cells: { entity: entityCell } }],
    };
    expect(() => textOf(<TableContentView data={placeholder} />)).toThrow(
      /row "exp\/a:gap:missing" has no cell for column "record"/,
    );

    const group: TableContent = {
      columns: shapeColumns,
      rows: [
        {
          key: "group:weather",
          variant: "group",
          cells: { entity: entityCell, record: recordCell, tokens: { kind: "notApplicable" } },
          subRows: [{ key: "weather/tool", cells: { entity: entityCell, record: recordCell } }],
        },
      ],
    };
    expect(() => textOf(<TableContentView data={group} />)).toThrow(
      /row "group:weather" has a cell for "tokens", which is not a declared column/,
    );
  });

  it("公开 rows 形态产出的行天然满足:声明列都在,不会漏格", () => {
    const text = renderNodeToText(
      <Table columns={["agent", "costUSD"]} rows={[{ agent: "codex", costUSD: 0.5, tokens: 10 }]} />,
      createTextContext({ width: 60 }),
    );
    // 行上多出来的 tokens 字段不进列集,也就不进 cells——不触发行形状报错
    expect(text).toContain("codex");
    expect(text).not.toContain("tokens");
  });
});

describe("表头长在列声明上", () => {
  // cases: docs/engineering/testing/unit/reports.md「表头长在列声明上」。断言面是两面输出字符串。
  const declared: TableContent = {
    columns: [
      { key: "entity", header: { en: "Experiment", "zh-CN": "实验" } },
      { key: "passRate", better: "higher", header: { en: "Pass rate", "zh-CN": "通过率" } },
    ],
    rows: [
      {
        key: "exp/a",
        cells: { entity: { kind: "text", text: "exp/a" }, passRate: { kind: "notApplicable" } },
      },
    ],
  };

  it("声明了 header 的列在 text / web 两面按 locale 解析同一份表头", () => {
    const zhText = textOf(<TableContentView data={declared} locale="zh-CN" />);
    expect(zhText).toContain("实验");
    expect(zhText).toContain("通过率");
    // 区分力:表头不是 key 原样打出来的
    expect(zhText).not.toContain("passRate");

    const zhHtml = webHtml(<TableContentView data={declared} locale="zh-CN" />, "zh-CN");
    expect(zhHtml).toContain("实验");
    expect(zhHtml).toContain("通过率");
    // 表头文本不是 key(排序句柄 data-niceeval-sort 仍用 key,那是另一回事)
    expect(zhHtml).not.toMatch(/>passRate</);

    const enText = textOf(<TableContentView data={declared} locale="en" />);
    expect(enText).toContain("Pass rate");
    const enHtml = webHtml(<TableContentView data={declared} locale="en" />, "en");
    expect(enHtml).toContain("Pass rate");
  });

  it("未声明 header 的维度值列在两面原样显示 key", () => {
    // 条件名、实验 id 这类列:列名即数据,原语不认识它们,也不该翻译
    const dimensionValues: TableContent = {
      columns: [{ key: "memory" }, { key: "exp/codex@v2" }],
      rows: [
        {
          key: "weather/tool",
          cells: { memory: { kind: "text", text: "on" }, "exp/codex@v2": { kind: "notApplicable" } },
        },
      ],
    };
    for (const locale of ["en", "zh-CN"]) {
      expect(textOf(<TableContentView data={dimensionValues} locale={locale} />)).toContain("exp/codex@v2");
      expect(webHtml(<TableContentView data={dimensionValues} locale={locale} />, locale)).toContain("exp/codex@v2");
    }
  });

  it("同一个 key 在两份投影里各显各的 header,原语不携带列名词表", () => {
    const rowOf = (): TableContent["rows"] => [
      { key: "r", cells: { total: { kind: "score", earned: 3, possible: 5 } } },
    ];
    const scoreboard: TableContent = { columns: [{ key: "total", header: "总分" }], rows: rowOf() };
    const stability: TableContent = { columns: [{ key: "total", header: "合计" }], rows: rowOf() };
    expect(textOf(<TableContentView data={scoreboard} />)).toContain("总分");
    expect(textOf(<TableContentView data={scoreboard} />)).not.toContain("合计");
    expect(textOf(<TableContentView data={stability} />)).toContain("合计");
    expect(textOf(<TableContentView data={stability} />)).not.toContain("总分");
  });

  it("区分力:zh-CN 稳定性矩阵首列是「题目」,条件列仍是列名本身", () => {
    const content = stabilityMatrixContent({
      rowDimension: "eval",
      columnDimension: "experiment",
      rows: [{ evalId: "weather/tool", neverPassed: false }],
      columns: ["exp/codex"],
      cells: [
        {
          row: "weather/tool",
          column: "exp/codex",
          cell: { passed: 1, failed: 1, errored: 0, executions: 2 },
          refs: [],
        },
      ],
      totals: { "exp/codex": { passed: 1, failed: 1, errored: 0, executions: 2 } },
    });
    const zhText = textOf(<TableContentView data={content} locale="zh-CN" />);
    expect(zhText).toContain("题目");
    // 只有表头走列声明解析才区别于原样打出英文 key
    expect(zhText).not.toMatch(/^\s*eval\b/m);
    expect(zhText).toContain("exp/codex");
    const zhHtml = webHtml(<TableContentView data={content} locale="zh-CN" />, "zh-CN");
    expect(zhHtml).toContain("题目");
    expect(zhHtml).toContain("exp/codex");
  });

  it("区分力:zh-CN attempt 断言表四列都有中文表头", () => {
    const content = attemptAssertionsContent({
      attention: [
        { name: "calledTool(\"get_weather\")", severity: "gate", outcome: "failed", score: 0, detail: "0 tool calls" },
      ],
      passedGroups: [],
    })!;
    const zhText = textOf(<TableContentView data={content} locale="zh-CN" />);
    for (const header of ["断言", "严重度", "结果", "详情"]) expect(zhText).toContain(header);
    const zhHtml = webHtml(<TableContentView data={content} locale="zh-CN" />, "zh-CN");
    for (const header of ["断言", "严重度", "结果", "详情"]) expect(zhHtml).toContain(header);
    const enHtml = webHtml(<TableContentView data={content} locale="en" />, "en");
    for (const header of ["Assertion", "Severity", "Outcome", "Detail"]) expect(enHtml).toContain(header);
  });
});
