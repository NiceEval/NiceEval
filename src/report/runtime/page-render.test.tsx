// cases: docs/engineering/testing/unit/reports.md
// 「惰性 page render」

import { describe, expect, it, vi } from "vitest";

import type { Sample } from "../../record/index.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { Col, Text } from "../definition/primitives.tsx";
import { buildReportMeta, defineReport } from "../definition/report.ts";
import { renderResolvedPageText, renderResolvedPageWeb } from "./resolved-page.ts";
import { executePageRender, resolveDefinitionPage } from "./page-render.ts";
import { pickReportPage } from "./text.ts";

describe("惰性 page render", () => {
  it("装载 defineReport 不执行 render;只有被请求的 page 才调用 render", async () => {
    const chartRender = vi.fn(async (_sample: Sample) => (
      <Col>
        <Text>chart</Text>
      </Col>
    ));
    const tableRender = vi.fn(async (_sample: Sample) => (
      <Col>
        <Text>table</Text>
      </Col>
    ));
    const definition = defineReport({
      pages: [
        { id: "chart", title: "Chart", render: chartRender },
        { id: "table", title: "Table", render: tableRender },
      ],
    });
    expect(chartRender).not.toHaveBeenCalled();
    expect(tableRender).not.toHaveBeenCalled();

    const { results } = emptyScopeAndResults();
    const scope = scopeOf([]);
    const meta = buildReportMeta(definition, scope);
    const page = pickReportPage(definition, "chart");
    await resolveDefinitionPage(page, {
      scope,
      results,
      report: meta,
      page: { id: page.id, input: "sample" },
    });
    expect(chartRender).toHaveBeenCalledTimes(1);
    expect(tableRender).not.toHaveBeenCalled();
  });

  it("同一 page 实例的 text / web / 多 locale 投影只执行 render 一次", async () => {
    let renderCalls = 0;
    const definition = defineReport({
      pages: [
        {
          id: "report",
          title: "Report",
          render: async () => {
            renderCalls += 1;
            return (
              <Col>
                <Text>{`n=${String(renderCalls)}`}</Text>
              </Col>
            );
          },
        },
      ],
    });
    const { results } = emptyScopeAndResults();
    const scope = scopeOf([]);
    const page = definition.pages[0]!;
    const cache = new Map();
    const resolved = await resolveDefinitionPage(
      page,
      {
        scope,
        results,
        report: buildReportMeta(definition, scope),
        page: { id: page.id, input: "sample" },
      },
      { renderCache: cache },
    );

    const text = renderResolvedPageText(resolved);
    const htmlEn = renderResolvedPageWeb(resolved, { locale: "en" });
    const htmlZh = renderResolvedPageWeb(resolved, { locale: "zh-CN" });

    expect(renderCalls).toBe(1);
    expect(text).toContain("n=1");
    expect(htmlEn).toContain("n=1");
    expect(htmlZh).toContain("n=1");
  });

  it("executePageRender 对同一 page + 输入缓存 Promise", async () => {
    let calls = 0;
    const page = defineReport({
      pages: [
        {
          id: "report",
          title: "Report",
          render: async () => {
            calls += 1;
            await new Promise((r) => setTimeout(r, 5));
            return (
              <Col>
                <Text>ok</Text>
              </Col>
            );
          },
        },
      ],
    }).pages[0]!;
    const scope = scopeOf([]);
    const cache = new Map();
    const [a, b] = await Promise.all([
      executePageRender(page, scope, cache),
      executePageRender(page, scope, cache),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });
});
