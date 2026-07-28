// cases: docs/engineering/testing/unit/reports.md
// 「ResolvedPage 单次 resolve 多面投影」

import { describe, expect, it } from "vitest";

import type { Sample } from "../../record/index.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { Col } from "../definition/primitives.tsx";
import { buildReportMeta, defineReport } from "../definition/report.ts";
import { defineComponent } from "../definition/tree.ts";
import { defineSource, type Source } from "../source.ts";
import {
  renderResolvedPageText,
  renderResolvedPageWeb,
  resolvePage,
} from "./resolved-page.ts";

type SinkContent = { n: number };
type SinkProps =
  | { data: SinkContent; source?: never; input?: never }
  | { source: Source<Sample, SinkContent>; data?: never; input?: Sample };

const Sink = defineComponent<SinkProps, { data: SinkContent }>({
  dimensions: () => ({}),
  web: ({ data }) => <span data-n={data.n} />,
  text: ({ data }) => `n=${data.n}`,
});
Sink.displayName = "Sink";

describe("ResolvedPage 单次 resolve 多面投影", () => {
  it("resolve 一次后 text + web(en) + web(zh-CN) 都渲染,Source.compute 计数仍为 1", async () => {
    let calls = 0;
    const scope = scopeOf([]);
    const source = defineSource({
      name: "once",
      compute: async () => {
        calls += 1;
        return { n: calls };
      },
    });
    const tree = (
      <Col>
        <Sink source={source} />
      </Col>
    );
    const definition = defineReport(tree);
    const { results } = emptyScopeAndResults();
    const resolved = await resolvePage(tree, {
      scope,
      results,
      report: buildReportMeta(definition, scope),
      page: { id: "report", input: "scope" },
    });
    expect(calls).toBe(1);

    const text = renderResolvedPageText(resolved);
    const htmlEn = renderResolvedPageWeb(resolved, { locale: "en" });
    const htmlZh = renderResolvedPageWeb(resolved, { locale: "zh-CN" });

    expect(calls).toBe(1);
    expect(text).toContain("n=1");
    expect(htmlEn).toContain('data-n="1"');
    expect(htmlZh).toContain('data-n="1"');
  });

  it("并发投影多面仍不重复 compute", async () => {
    let calls = 0;
    const scope = scopeOf([]);
    const source = defineSource({
      name: "concurrent-faces",
      compute: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { n: 7 };
      },
    });
    const tree = (
      <Col>
        <Sink source={source} />
      </Col>
    );
    const definition = defineReport(tree);
    const { results } = emptyScopeAndResults();
    const resolved = await resolvePage(tree, {
      scope,
      results,
      report: buildReportMeta(definition, scope),
      page: { id: "report", input: "scope" },
    });
    expect(calls).toBe(1);

    const [text, htmlEn, htmlZh] = await Promise.all([
      Promise.resolve().then(() => renderResolvedPageText(resolved)),
      Promise.resolve().then(() => renderResolvedPageWeb(resolved, { locale: "en" })),
      Promise.resolve().then(() => renderResolvedPageWeb(resolved, { locale: "zh-CN" })),
    ]);

    expect(calls).toBe(1);
    expect(text).toContain("n=7");
    expect(htmlEn).toContain('data-n="7"');
    expect(htmlZh).toContain('data-n="7"');
  });
});
