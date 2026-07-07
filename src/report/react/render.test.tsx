// 「不 hydrate 也完整」的验收测试:每个组件过 renderToStaticMarkup,
// 断言纯静态 HTML 里就有全部关键内容——数字、覆盖率角标、缺数据文案、
// 散点的 SVG 与系列名、truncated 行、attemptHref 链接。
// 另外锁两条契约:源码零 hooks;维度键跨组件同色。

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CaseList,
  DeltaTable,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  RunOverview,
  Scoreboard,
} from "./index.tsx";
import { NRE_PALETTE, colorClassForKey, colorIndexForKey } from "./colors.ts";
import {
  caseListData,
  deltaData,
  matrixData,
  overviewData,
  overviewWithCost,
  scatterData,
  scoreboardData,
  tableData,
} from "./fixtures.ts";

const attemptHref = (ref: { run: string; result: number }) => `/attempts/${ref.run}/${ref.result}`;

describe("RunOverview", () => {
  const html = renderToStaticMarkup(<RunOverview data={overviewData} />);

  it("KPI 条:快照数、题数、attempts、通过率、耗时", () => {
    expect(html).toContain("nre-overview");
    expect(html).toContain("<dd>12</dd>"); // 题目
    expect(html).toContain("<dd>48</dd>"); // attempts
    expect(html).toContain("78%"); // 36 / (36+8+2),skipped 不进分母
    expect(html).toContain("4m 21s"); // 261000ms
  });

  it("costUSD 全缺 = null:显示缺数据,不编 $0", () => {
    expect(html).toContain("no data");
    expect(html).not.toContain("$0");
    const withCost = renderToStaticMarkup(<RunOverview data={overviewWithCost} />);
    expect(withCost).toContain("$1.23");
  });

  it("数据来源与 warnings 直接渲染在条内", () => {
    expect(html).toContain("2 snapshots");
    expect(html).toContain("compare/bub");
    expect(html).toContain("2026-07-01T10:00:00Z");
    expect(html).toContain("compare/bub 快照缺 3 个 eval 的结果");
    expect(html).toContain("nre-warnings");
  });
});

describe("MetricTable", () => {
  const html = renderToStaticMarkup(<MetricTable data={tableData} attemptHref={attemptHref} />);

  it("按传入顺序渲染行,不重排(排序在数据侧)", () => {
    // fixture 里 codex(50%)在 bub(87%)前面,输出必须保持
    expect(html.indexOf(">codex<")).toBeGreaterThan(-1);
    expect(html.indexOf(">codex<")).toBeLessThan(html.indexOf(">bub<"));
  });

  it("列头带 label、unit 与 better 方向", () => {
    expect(html).toContain("通过率");
    expect(html).toContain("(%)");
    expect(html).toContain("代码行数");
    expect(html).toContain("↑");
    expect(html).toContain("↓");
  });

  it("数字与覆盖率角标:samples < total 如实标出", () => {
    expect(html).toContain("87%");
    expect(html).toContain("120 lines");
    expect(html).toMatch(/<sup class="nre-coverage"[^>]*>5\/6<\/sup>/);
  });

  it("全 null 渲染缺数据文案,绝不画 0", () => {
    expect(html).toContain("no data");
    expect(html).toContain("nre-cell-missing");
  });

  it("refs + attemptHref 出普通 <a>", () => {
    expect(html).toContain('href="/attempts/run-a/0"');
  });
});

describe("MetricMatrix", () => {
  const html = renderToStaticMarkup(<MetricMatrix data={matrixData} attemptHref={attemptHref} />);

  it("caption 标出指标与行列维度", () => {
    expect(html).toContain("通过率");
    expect(html).toContain("eval × agent");
  });

  it("稀疏格子:没有样本的格子空着(恰好一个)", () => {
    expect(html.match(/nre-td-empty/g)).toHaveLength(1);
  });

  it("格子数字与 refs 下钻链接", () => {
    expect(html).toContain("100%");
    expect(html).toContain("0%");
    expect(html).toContain('href="/attempts/run-b/3"');
    expect(html).toContain('href="/attempts/run-b/7"');
  });

  it("列头(维度键)带稳定散列配色 class", () => {
    expect(html).toContain(colorClassForKey("bub"));
    expect(html).toContain(colorClassForKey("codex"));
  });
});

describe("Scoreboard", () => {
  const html = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);

  it("总分 + 满分口径", () => {
    expect(html).toContain("78.5");
    expect(html).toContain("52");
    expect(html).toContain("/ 100");
  });

  it("分科小计 earned/possible", () => {
    expect(html).toContain("14/16");
    expect(html).toContain("3/4");
  });

  it("missing 注脚:没跑按 0 计的题数如实展示", () => {
    expect(html).toContain("1 eval missing, scored 0");
    expect(html).toContain("2 evals missing, scored 0");
  });

  it("实际生效的权重表可审计", () => {
    expect(html).toContain("algebra/ ×2");
    expect(html).toContain("others ×1");
  });
});

describe("MetricScatter", () => {
  const html = renderToStaticMarkup(<MetricScatter data={scatterData} pointHref={(row) => `/exp/${row.key}`} />);

  const cxOf = (key: string): number => {
    const m = html.match(new RegExp(`data-key="${key}"[^>]*\\bcx="([\\d.]+)"`));
    expect(m, `circle for ${key}`).toBeTruthy();
    return Number(m![1]);
  };
  const cyOf = (key: string): number => {
    const m = html.match(new RegExp(`data-key="${key}"[^>]*\\bcy="([\\d.]+)"`));
    expect(m, `circle for ${key}`).toBeTruthy();
    return Number(m![1]);
  };

  it("内联 SVG + 轴标签", () => {
    expect(html).toContain("<svg");
    expect(html).toContain("成本($)");
    expect(html).toContain("通过率(%)");
  });

  it("better:lower 的 x 轴反向:便宜($5)在贵($10)右边,好的角落恒在右上", () => {
    expect(cxOf("compare/bub-low")).toBeGreaterThan(cxOf("compare/bub-high"));
    // y 轴 better:higher:通过率高(90%)在低(50%)上方(SVG y 向下增长)
    expect(cyOf("compare/bub-high")).toBeLessThan(cyOf("compare/bub-low"));
  });

  it("同系列点连线并标系列名,线色来自稳定散列调色板", () => {
    expect(html).toContain("<polyline");
    expect(html).toContain(">bub</text>");
    expect(html).toContain(NRE_PALETTE[colorIndexForKey("bub")]);
    // codex 只有 1 个可画点:不出线,但系列名仍标出
    expect(html).toContain(">codex</text>");
  });

  it("null 点不画,底部注脚如实报数", () => {
    expect(html).not.toContain('data-key="compare/codex-broken"');
    expect(html).toContain("1 point missing data");
  });

  it("hover 退化为 <title>:display 与 samples/total", () => {
    expect(html).toContain("<title>");
    expect(html).toContain("50%(6/6)");
  });

  it("pointHref:点包普通 <a>", () => {
    expect(html).toContain('href="/exp/compare/bub-low"');
  });

  it("全部点都缺数据时不画空坐标系", () => {
    const empty = renderToStaticMarkup(
      <MetricScatter
        data={{
          ...scatterData,
          rows: scatterData.rows.map((r) => ({ ...r, x: { ...r.x, value: null } })),
        }}
      />,
    );
    expect(empty).not.toContain("<svg");
    expect(empty).toContain("no data");
    expect(empty).toContain("4 points missing data");
  });
});

describe("DeltaTable", () => {
  const html = renderToStaticMarkup(<DeltaTable data={deltaData} />);

  it("每格 A/B/Δ 三值", () => {
    expect(html).toContain("50%");
    expect(html).toContain("62%");
    expect(html).toContain("+12pp");
    expect(html).toContain(">A</span>");
    expect(html).toContain(">B</span>");
    expect(html).toContain(">Δ</span>");
  });

  it("涨跌好坏按 better 配色:通过率涨=好,成本涨=坏,0=平", () => {
    expect(html).toContain("nre-delta-good");
    expect(html).toContain("nre-delta-bad");
    expect(html).toContain("nre-delta-flat");
  });

  it("任一侧缺数据:Δ 显示为缺,不硬算", () => {
    expect(html).toContain("nre-delta-missing");
    expect(html).toContain("no data");
  });

  it("每行标出 A → B 的 experimentId", () => {
    expect(html).toContain("compare/bub → compare/bub--agents-md");
  });
});

describe("CaseList", () => {
  const html = renderToStaticMarkup(<CaseList data={caseListData} attemptHref={attemptHref} />);

  it("逐条失败断言:name、score、detail、evidence", () => {
    expect(html).toContain("roots-correct");
    expect(html).toContain("score 0");
    expect(html).toContain("期望 x=2,得到 x=3");
    expect(html).toContain("judge: 求根公式代入时符号写反");
  });

  it("errored 的 error 摘要", () => {
    expect(html).toContain("TypeError: cannot read properties of undefined");
  });

  it("truncated 如实报「还有 n 条没列」", () => {
    expect(html).toContain("and 2 more not shown");
  });

  it("每条案例带 attemptHref 下钻链接", () => {
    expect(html).toContain('href="/attempts/run-a/4"');
    expect(html).toContain('href="/attempts/run-c/1"');
  });

  it("长文本收进 <details>,零 JS 可展开", () => {
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
  });
});

describe("跨组件契约", () => {
  it("同一维度键在所有块里同色(稳定散列,与渲染顺序无关)", () => {
    const cls = colorClassForKey("bub");
    const table = renderToStaticMarkup(<MetricTable data={tableData} />);
    const matrix = renderToStaticMarkup(<MetricMatrix data={matrixData} />);
    const board = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);
    const delta = renderToStaticMarkup(<DeltaTable data={deltaData} />);
    const cases = renderToStaticMarkup(<CaseList data={caseListData} />);
    for (const html of [table, matrix, board, delta, cases]) {
      expect(html).toContain(cls);
    }
    const scatter = renderToStaticMarkup(<MetricScatter data={scatterData} />);
    expect(scatter).toContain(NRE_PALETTE[colorIndexForKey("bub")]);
  });

  it("静态输出不含 <script>:交互只靠 <a>/<details>/CSS", () => {
    const all = [
      renderToStaticMarkup(<RunOverview data={overviewData} />),
      renderToStaticMarkup(<MetricTable data={tableData} attemptHref={attemptHref} />),
      renderToStaticMarkup(<MetricMatrix data={matrixData} attemptHref={attemptHref} />),
      renderToStaticMarkup(<Scoreboard data={scoreboardData} />),
      renderToStaticMarkup(<MetricScatter data={scatterData} />),
      renderToStaticMarkup(<DeltaTable data={deltaData} />),
      renderToStaticMarkup(<CaseList data={caseListData} />),
    ].join("");
    expect(all).not.toContain("<script");
  });

  it("组件源码零 hooks(本实验的「不 hydrate 也完整」用最笨的方式保证)", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir)
      .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
      .map((f) => readFileSync(join(dir, f), "utf8"));
    expect(sources.length).toBeGreaterThanOrEqual(12);
    for (const src of sources) {
      expect(src).not.toMatch(/\buse[A-Z][A-Za-z]*\s*\(/);
    }
  });
});
