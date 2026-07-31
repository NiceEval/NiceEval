// cases: docs/engineering/testing/unit/reports.md
// 「惰性 page render」

import { describe, expect, it, vi } from "vitest";

import type { Sample } from "../../record/index.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { Col, Text } from "../definition/primitives.tsx";
import { buildReportMeta, defineReport } from "../definition/report.ts";
import { renderResolvedPageText, renderResolvedPageWeb } from "./resolved-page.ts";
import { executePageRender, renderTarget, resolveDefinitionPage } from "./page-render.ts";
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
      page: { id: page.id, input: scope },
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

describe("装载期规则:params 声明的静态校验", () => {
  it("重复 id 按完整用户反馈拒绝", () => {
    expect(() =>
      defineReport({
        pages: [
          { id: "a", title: "A", render: () => null },
          { id: "a", title: "A2", render: () => null },
        ],
      }),
    ).toThrow(/"a" is declared twice/);
  });

  it("声明 params 但缺 load 按完整用户反馈拒绝", () => {
    expect(() =>
      defineReport({
        pages: [
          {
            id: "a",
            title: "A",
            navigation: false,
            params: { encode: (p: { k: string }) => p.k, decode: (k: string) => ({ k }), enumerate: () => [] },
            render: () => null,
          },
        ],
      } as never),
    ).toThrow(/declares params but no load/);
  });

  it("声明 params 但 navigation 不是显式 false 按完整用户反馈拒绝(省略与 true 都拒绝)", () => {
    const base = {
      params: { encode: (p: { k: string }) => p.k, decode: (k: string) => ({ k }), enumerate: () => [] },
      load: (_b: unknown, p: unknown) => p,
      render: () => null,
    };
    expect(() => defineReport({ pages: [{ id: "a", title: "A", ...base }] } as never)).toThrow(
      /declares params but not navigation: false/,
    );
    expect(() =>
      defineReport({ pages: [{ id: "a", title: "A", navigation: true, ...base }] } as never),
    ).toThrow(/declares params but not navigation: false/);
  });

  it("校验不执行任何 load 或 render", () => {
    const load = vi.fn();
    const render = vi.fn();
    expect(() =>
      defineReport({
        pages: [
          {
            id: "a",
            title: "A",
            navigation: false,
            params: { encode: (p: { k: string }) => p.k, decode: (k: string) => ({ k }), enumerate: () => [] },
            load,
            render,
          },
        ],
      }),
    ).not.toThrow();
    expect(load).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});

describe("renderTarget:单一分派路径", () => {
  it("params 目标与 plain-Sample 目标经同一个分派函数,行为等价(assert 在分派函数本身上)", async () => {
    const { results } = emptyScopeAndResults();
    const scope = scopeOf([]);
    const paramsPageRender = vi.fn(async (input: { doubled: number }) => (
      <Col>
        <Text>{`doubled=${String(input.doubled)}`}</Text>
      </Col>
    ));
    const plainPageRender = vi.fn(async (input: Sample) => (
      <Col>
        <Text>{`attempts=${String(input.attempts.length)}`}</Text>
      </Col>
    ));
    const definition = defineReport({
      pages: [
        { id: "plain", title: "Plain", render: plainPageRender },
        {
          id: "doubled",
          title: "Doubled",
          navigation: false,
          params: {
            encode: (p: { n: number }) => String(p.n),
            decode: (key: string) => ({ n: Number(key) }),
            enumerate: () => [],
          },
          load: (_base, params: { n: number }) => ({ doubled: params.n * 2 }),
          render: paramsPageRender,
        },
      ],
    });
    const meta = buildReportMeta(definition, scope);
    const ctx = { evidence: () => Promise.reject(new Error("not used")) };

    const plainResolved = await renderTarget(definition, { page: "plain" }, scope, ctx, { results, report: meta });
    expect(plainPageRender).toHaveBeenCalledTimes(1);
    expect(plainPageRender).toHaveBeenCalledWith(scope);
    expect(renderResolvedPageText(plainResolved)).toContain("attempts=0");

    const paramsResolved = await renderTarget(
      definition,
      { page: "doubled", params: { n: 21 } },
      scope,
      ctx,
      { results, report: meta },
    );
    expect(paramsPageRender).toHaveBeenCalledTimes(1);
    expect(paramsPageRender).toHaveBeenCalledWith({ doubled: 42 });
    expect(renderResolvedPageText(paramsResolved)).toContain("doubled=42");
  });

  it("目标页不存在抛 UnknownPageError", async () => {
    const { results } = emptyScopeAndResults();
    const scope = scopeOf([]);
    const definition = defineReport(() => null);
    const meta = buildReportMeta(definition, scope);
    const ctx = { evidence: () => Promise.reject(new Error("not used")) };
    await expect(
      renderTarget(definition, { page: "nope" }, scope, ctx, { results, report: meta }),
    ).rejects.toThrow(/No page with id "nope"/);
  });
});
