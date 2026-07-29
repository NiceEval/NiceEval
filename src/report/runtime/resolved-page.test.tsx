// cases: docs/engineering/testing/unit/reports.md
// 「ResolvedPage 单次 resolve 多面投影」

import { describe, expect, it } from "vitest";

import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { Col } from "../definition/primitives.tsx";
import { buildReportMeta, defineReport } from "../definition/report.ts";
import { defineComponent } from "../definition/tree.ts";
import {
  renderResolvedPageText,
  renderResolvedPageWeb,
  resolvePage,
} from "./resolved-page.ts";

type SinkContent = { n: number };

const Sink = defineComponent<{ data: SinkContent }, { data: SinkContent }>({
  dimensions: () => ({}),
  web: ({ data }) => <span data-n={data.n} />,
  text: ({ data }) => `n=${data.n}`,
});
Sink.displayName = "Sink";

describe("ResolvedPage 单次 resolve 多面投影", () => {
  it("resolve 一次后 text + web(en) + web(zh-CN) 都渲染,同一 data 不被改写", async () => {
    const scope = scopeOf([]);
    const tree = (
      <Col>
        <Sink data={{ n: 1 }} />
      </Col>
    );
    const definition = defineReport({
      pages: [{ id: "report", title: "Report", render: () => tree }],
    });
    const { results } = emptyScopeAndResults();
    const resolved = await resolvePage(tree, {
      scope,
      results,
      report: buildReportMeta(definition, scope),
      page: { id: "report", input: "sample" },
    });

    const text = renderResolvedPageText(resolved);
    const htmlEn = renderResolvedPageWeb(resolved, { locale: "en" });
    const htmlZh = renderResolvedPageWeb(resolved, { locale: "zh-CN" });

    expect(text).toContain("n=1");
    expect(htmlEn).toContain('data-n="1"');
    expect(htmlZh).toContain('data-n="1"');
  });

  it("并发投影多面仍共享同一份 ResolvedPage", async () => {
    const scope = scopeOf([]);
    const tree = (
      <Col>
        <Sink data={{ n: 7 }} />
      </Col>
    );
    const definition = defineReport({
      pages: [{ id: "report", title: "Report", render: () => tree }],
    });
    const { results } = emptyScopeAndResults();
    const resolved = await resolvePage(tree, {
      scope,
      results,
      report: buildReportMeta(definition, scope),
      page: { id: "report", input: "sample" },
    });

    const [text, htmlEn, htmlZh] = await Promise.all([
      Promise.resolve(renderResolvedPageText(resolved)),
      Promise.resolve(renderResolvedPageWeb(resolved, { locale: "en" })),
      Promise.resolve(renderResolvedPageWeb(resolved, { locale: "zh-CN" })),
    ]);

    expect(text).toContain("n=7");
    expect(htmlEn).toContain('data-n="7"');
    expect(htmlZh).toContain('data-n="7"');
  });
});
