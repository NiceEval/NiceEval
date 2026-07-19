// cases: docs/engineering/unit-tests/reports/cases.md
// 「不 hydrate 也完整」的验收测试:每个组件过 renderToStaticMarkup,
// 断言纯静态 HTML 里就有全部关键内容——数字、覆盖率角标、缺数据文案、
// 散点的 SVG 与系列名、truncated 行、attemptHref 链接。
// 另外锁一条契约:维度键跨组件同色。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AttemptLocator } from "../../results/locator.ts";

import {
  AttemptList,
  DeltaTable,
  EvalList,
  ExperimentList,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  Scoreboard,
  ScopeSummary,
} from "./index.tsx";
import { colorClassForKey, seriesClassForKey } from "./colors.ts";
import {
  attemptListItems,
  deltaData,
  evalListItems,
  experimentListItems,
  matrixData,
  scatterData,
  scopeSummaryData,
  scoreboardData,
  tableData,
} from "./fixtures.ts";

const attemptHref = (locator: AttemptLocator) => `/attempts/${locator}`;

describe("ScopeSummary", () => {
  const html = renderToStaticMarkup(<ScopeSummary data={scopeSummaryData} />);

  it("KPI:experiment/eval/attempt 数、通过率与总成本原样渲染(不从计票重算)", () => {
    expect(html).toContain("nre-scope-summary");
    expect(html).toContain("Pass rate");
    expect(html).toContain("Experiments");
    expect(html).toContain("Evals");
    expect(html).toContain("Attempts");
    expect(html).toContain("Eval results");
    expect(html).toContain("<dd>2</dd>"); // experiments
    expect(html).toContain("<dd>6</dd>"); // evals
    expect(html).toContain("<dd>9</dd>"); // attempts
    // endToEndPassRate.display 原样渲染(两级聚合 60%),不是 eval 计票 3/5 = 60% 巧合之外的重算;
    // attempt 计票 4/9 ≈ 44% 也不该出现
    expect(html).toContain("60%");
    expect(html).not.toContain("44%");
    expect(html).toContain("$1.50");
    expect(html).toContain("Cost available for 8/9 attempts");
  });

  it("votes 默认 eval 级计票;votes='attempt' 切换显示但 data 不变", () => {
    expect(html).toContain("3 passed");
    expect(html).toContain('data-votes="eval"');
    const attempts = renderToStaticMarkup(<ScopeSummary data={scopeSummaryData} votes="attempt" />);
    expect(attempts).toContain("4 passed");
    expect(attempts).toContain("Attempt results");
    expect(attempts).toContain('data-votes="attempt"');
  });

  it("时间窗带语义并按 locale 格式化,不暴露原始 ISO 或编造当前时间", () => {
    expect(html).toContain("Run range ·");
    expect(html).toContain("2026");
    expect(html).not.toContain("2026-07-01T10:00:00Z");
    expect(html).not.toContain("2026-07-01T11:30:00Z");

    const zh = renderToStaticMarkup(<ScopeSummary data={scopeSummaryData} locale="zh-CN" />);
    expect(zh).toContain("通过率");
    expect(zh).toContain("实验");
    expect(zh).toContain("Eval 结果");
    expect(zh).toContain("8/9 次有成本数据");
    expect(zh).toContain("运行范围 ·");
  });
});

describe("MetricTable", () => {
  const html = renderToStaticMarkup(<MetricTable data={tableData} attemptHref={attemptHref} />);

  it("列头带 label、unit 与 better 方向,首列是 rowDimension", () => {
    expect(html).toContain("pass rate");
    expect(html).toContain("(%)");
    expect(html).toContain("code lines");
    expect(html).toContain("↑");
    expect(html).toContain("↓");
    expect(html).toContain(">agent</th>");
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
    expect(html).toContain('href="/attempts/@1a0a0a0a"');
  });

  it("渐进增强的 data 属性:所有表头 data-nre-sort、格子 data-sort-value(无 JS 时纯属性,内容完整)", () => {
    expect(html.match(/data-nre-sort/g)).toHaveLength(3); // 维度列 + 2 指标列
    expect(html).toContain('data-sort-value="codex"');
    expect(html).toContain('data-sort-value="0.87"');
    // 缺数据格子的排序值为空串:enhance.js 排序时恒沉底
    expect(html).toContain('data-sort-value=""');
  });

  it("filter 开:表格前渲染 data-nre-filter 输入框(无 JS 静默无功能),仍无 <script>", () => {
    const filtered = renderToStaticMarkup(<MetricTable data={tableData} filter />);
    expect(filtered).toContain("data-nre-filter");
    expect(filtered).toContain('class="nre-filter"');
    expect(filtered.indexOf("nre-filter")).toBeLessThan(filtered.indexOf("<table"));
    expect(filtered).toContain('placeholder="Filter rows…"');
    expect(filtered).not.toContain("<script");
  });

  it("locale=zh-CN:chrome 文案走字典;display 不本地化", () => {
    const zh = renderToStaticMarkup(<MetricTable data={tableData} filter locale="zh-CN" />);
    expect(zh).toContain('placeholder="筛选行…"');
    expect(zh).toContain("50%"); // display 是 format 产物,不本地化
  });
});

describe("MetricMatrix", () => {
  const html = renderToStaticMarkup(<MetricMatrix data={matrixData} attemptHref={attemptHref} />);

  it("caption 标出指标与行列维度(rowDimension × columnDimension)", () => {
    expect(html).toContain("pass rate");
    expect(html).toContain("eval × agent");
  });

  it("格子数字与 refs 下钻链接;稀疏格子空着不补 0", () => {
    expect(html).toContain("100%");
    expect(html).toContain("0%");
    expect(html).toContain('href="/attempts/@1b3b3b3b"');
    expect(html).toContain('href="/attempts/@1b7b7b7b"');
    expect(html).toContain("nre-td-empty");
  });
});

describe("Scoreboard", () => {
  const html = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);

  it("总分 + 满分口径", () => {
    expect(html).toContain("78.5");
    expect(html).toContain("52");
    expect(html).toContain("/ 100");
  });

  it("分科小计 display(earned/possible 与同尺度百分比)", () => {
    expect(html).toContain("14/16 (87.5%)");
    expect(html).toContain("3/4 (75%)");
  });

  it("notRun 与 unscorable 分开注脚,不合并成一个笼统的缺失数", () => {
    expect(html).toContain("1 eval not run, scored 0");
    expect(html).toContain("2 evals unscorable, scored 0");
  });

  it("实际生效的权重表可审计;题集外被忽略的 eval 如实报数", () => {
    expect(html).toContain("algebra/ ×2");
    expect(html).toContain("others ×1");
    expect(html).toContain("1 eval outside the question set ignored");
  });
});

describe("MetricScatter", () => {
  const html = renderToStaticMarkup(<MetricScatter data={scatterData} pointHref={(row) => `/exp/${row.key}`} />);

  // data-key 在点的 <g> 上,坐标在其内第一个 circle 上(非贪婪跨标签匹配)
  const cxOf = (key: string): number => {
    const m = html.match(new RegExp(`data-key="${key}"[\\s\\S]*?\\bcx="([\\d.]+)"`));
    expect(m, `circle for ${key}`).toBeTruthy();
    return Number(m![1]);
  };
  const cyOf = (key: string): number => {
    const m = html.match(new RegExp(`data-key="${key}"[\\s\\S]*?\\bcy="([\\d.]+)"`));
    expect(m, `circle for ${key}`).toBeTruthy();
    return Number(m![1]);
  };

  it("内联 SVG + 轴标签", () => {
    expect(html).toContain("<svg");
    expect(html).toContain("cost($)");
    expect(html).toContain("pass rate(%)");
  });

  it("轴方向跟随 better:成本轴(lower)反向,便宜($5)在贵($10)右边;提示恒为「越靠右上越好」", () => {
    expect(cxOf("compare/bub-low")).toBeGreaterThan(cxOf("compare/bub-high"));
    // y 轴(higher)正向:通过率高(90%)在低(50%)上方(SVG y 向下增长)
    expect(cyOf("compare/bub-high")).toBeLessThan(cyOf("compare/bub-low"));
    expect(html).toContain("better → upper right");
  });

  it("反向轴的刻度显示真实值:x 刻度从左到右数值递减(值大在左),数字不变", () => {
    // x 轴刻度 <text class="nre-scatter-tick" x="…">$N</text>:抓出 (x, 值) 对,按 x 升序后值应递减。
    const ticks = [...html.matchAll(/nre-scatter-tick" x="([\d.]+)" y="[\d.]+" text-anchor="middle">\$([\d.]+)/g)].map(
      (m) => ({ px: Number(m[1]), value: Number(m[2]) }),
    );
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const byPx = [...ticks].sort((a, b) => a.px - b.px);
    for (let i = 1; i < byPx.length; i++) {
      expect(byPx[i]!.value).toBeLessThan(byPx[i - 1]!.value);
    }
  });

  it("任一轴未声明 better:该轴正向渲染且整图无方向提示(组件不猜「更好」朝哪边)", () => {
    const noBetter = renderToStaticMarkup(
      <MetricScatter data={{ ...scatterData, x: { key: "cost", label: "cost", unit: "$" } }} />,
    );
    expect(noBetter).not.toContain("better →");
    // x 正向:便宜($5)回到贵($10)左边。
    const cx = (key: string): number => {
      const m = noBetter.match(new RegExp(`data-key="${key}"[\\s\\S]*?\\bcx="([\\d.]+)"`));
      expect(m, `circle for ${key}`).toBeTruthy();
      return Number(m![1]);
    };
    expect(cx("compare/bub-low")).toBeLessThan(cx("compare/bub-high"));
  });

  it("默认不连线;connect 显式开启才画折线,系列色走类名(nre-series-cN,CSS 上色跟随深浅主题),图例列系列名", () => {
    expect(html).not.toContain("<polyline");
    // 渲染面零内联 hex:深色主题下由 CSS 变量切换
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
    expect(html).toContain(">bub</span>");
    expect(html).toContain(">codex</span>");

    const connected = renderToStaticMarkup(<MetricScatter data={scatterData} connect />);
    expect(connected).toContain("<polyline");
    expect(connected).toContain('nre-scatter-line nre-series-c');
    expect(connected).toContain('data-series="bub"');
  });

  it("niceTicks 网格与每点直接标签(末段唯一时缩成末段)", () => {
    expect(html).toContain("nre-scatter-grid");
    expect(html.match(/nre-scatter-tick/g)!.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain(">bub-low</text>");
    expect(html).toContain(">codex-mid</text>");
  });

  it("末段重名的点使用能区分它们的最短路径后缀", () => {
    const dupes = renderToStaticMarkup(
      <MetricScatter
        data={{
          ...scatterData,
          rows: [
            { ...scatterData.rows[0]!, key: "compare/a/run" },
            { ...scatterData.rows[1]!, key: "compare/b/run" },
          ],
        }}
      />,
    );
    expect(dupes).toContain(">a/run</text>");
    expect(dupes).toContain(">b/run</text>");
  });

  it("hover 退化为 <title>:display 与 samples/total", () => {
    expect(html).toContain("<title>");
    expect(html).toContain("50%(6/6)");
  });

  it("pointHref:点包普通 <a>", () => {
    expect(html).toContain('href="/exp/compare/bub-low"');
  });

  it("全部点都缺数据时不画空坐标系:显式说明缺哪两个指标", () => {
    const empty = renderToStaticMarkup(
      <MetricScatter
        data={{
          ...scatterData,
          rows: scatterData.rows.map((r) => ({ ...r, x: { ...r.x, value: null } })),
        }}
      />,
    );
    expect(empty).not.toContain("<svg");
    expect(empty).toContain("No data to plot"); // 0 可画点:命名 x/y 指标,不画空图
    expect(empty).toContain("4 points missing data");
  });

  it("恰好 1 个可画点:照常画出单点", () => {
    const single = renderToStaticMarkup(
      <MetricScatter
        data={{
          ...scatterData,
          // 只留第一个点可画,其余 x 置空
          rows: scatterData.rows.map((r, i) => (i === 0 ? r : { ...r, x: { ...r.x, value: null } })),
        }}
      />,
    );
    expect(single).toContain("<svg");
    expect(single).toContain("nre-scatter-point");
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

  it("涨跌好坏按数据侧算好的 outcome 配色:improved / regressed / unchanged / unavailable", () => {
    expect(html).toContain("nre-delta-good");
    expect(html).toContain("nre-delta-bad");
    expect(html).toContain("nre-delta-flat");
    expect(html).toContain('data-outcome="unavailable"');
  });

  it("每行显示作者声明的 pair label 与 A → B 的维度键", () => {
    expect(html).toContain(">bub</span>");
    expect(html).toContain("compare/bub → compare/bub--agents-md");
  });

  it("0 对显示明确空态并报告配对域实验数", () => {
    const empty = renderToStaticMarkup(<DeltaTable data={{ ...deltaData, experiments: 3, rows: [] }} />);
    expect(empty).not.toContain("<table");
    expect(empty).toContain("3 experiments, 0 comparable pairs");
  });
});

describe("AttemptList", () => {
  const html = renderToStaticMarkup(<AttemptList data={attemptListItems} />);

  it("显示算好的 failureSummary 与 +N more failures 计数,不重算摘要", () => {
    expect(html).toContain("gate: roots-correct · expected x=2 · received x=3");
    expect(html).toContain("+1 more failure");
    // errored 的一层摘要(phase · code · message)
    expect(html).toContain("eval.run · unexpected-error · TypeError");
  });

  it("total > data.length 时如实报「还有 n 条没列」", () => {
    const html2 = renderToStaticMarkup(<AttemptList data={attemptListItems} total={attemptListItems.length + 2} />);
    expect(html2).toContain("and 2 more not shown");
    // 不传 total(或 total === data.length)不产出截断文案
    expect(html).not.toContain("more not shown");
  });

  it("costUSD 为 null 时不显示成本,也不伪造 $0", () => {
    expect(html).toContain("$0.12");
    expect(html.match(/nre-attempt-cost/g)).toHaveLength(1); // errored 那条 costUSD: null
  });

  it("AttemptList 自身不展开断言详情", () => {
    expect(html).not.toContain("<details");
  });
});

describe("EvalList", () => {
  const html = renderToStaticMarkup(<EvalList data={evalListItems} />);

  it("展开到这道题的 Attempt(与 AttemptList 同一套 AttemptRow 渲染)", () => {
    expect(html).toContain('href="#/attempt/@1a4a4a4a"');
    expect(html).toContain("roots-correct");
  });

  it("零 JS 靠原生 <details>,静态 HTML 内容已完整", () => {
    expect(html).toContain("<details");
    expect(html).not.toContain("<script");
  });
});

describe("ExperimentList", () => {
  const html = renderToStaticMarkup(<ExperimentList data={experimentListItems} filter />);

  it("web 面是带过滤框与八个固定列头的 experiment 比较表(成本列头是 Cost)", () => {
    expect(html).toContain('data-nre-experiment-filter=""');
    for (const header of ["Experiment", "Model", "Agent", "Avg. time", "Pass rate", "Tokens", "Cost", "Results"]) {
      expect(html).toContain(`class="nre-sort-label">${header}</span>`);
    }
    expect(html).not.toContain("Est. cost");
    expect(html).toContain('data-nre-experiment-sort="4" class="nre-num-head nre-sort-desc"');

    const zh = renderToStaticMarkup(<ExperimentList data={experimentListItems} locale="zh-CN" />);
    expect(zh).toContain('class="nre-sort-label">通过率</span>');
    expect(zh).toContain("2 个 Eval");
    expect(html).toContain("2 evals");
  });

  it("主行:身份、agent/model、官方两级聚合指标与 eval 级判定构成", () => {
    expect(html).toContain("compare/bub");
    expect(html).toContain("compare/codex");
    expect(html).toContain("gpt-5.4");
    expect(html).toContain("50%"); // endToEndPassRate.display
    expect(html).toContain("1 passed · 1 failed");
    expect(html).toContain("memory=true");
  });

  it("展开到 Eval:父行只有折叠判定与题级聚合,失败摘要只在 Attempt 子行", () => {
    // 独立自有 React 场景:显式传 attemptHref 才产生外部链接(没有报告宿主注入 ctx.attemptHref)。
    const linked = renderToStaticMarkup(
      <ExperimentList data={experimentListItems} filter attemptHref={(l) => `#/attempt/${l}`} />,
    );
    expect(linked).toContain("algebra/quadratic");
    expect(linked).toContain('href="#/attempt/@1a4a4a4a"');
    expect(linked).toContain('href="#/attempt/@1b5b5b5b"');
    expect(html.match(/algebra\/quadratic/g)).toHaveLength(1);
    expect(html).toContain("nre-experiment-eval-header");
    expect(html.match(/nre-experiment-attempt-row/g)).toHaveLength(4);
    expect(html).toContain("├─");
    expect(html).toContain("└─");
    // 主失败摘要只出现在 attempt 子行:两次(同一 eval 的两轮 attempt 各自的摘要),不在父行重复
    expect(html.match(/gate: roots-correct/g)).toHaveLength(2);
  });

  it("relativeTo 去掉组前缀只显示末段;data-sort-value 仍是完整 id", () => {
    const relative = renderToStaticMarkup(<ExperimentList data={experimentListItems} relativeTo="compare" />);
    expect(relative).toContain(">bub</b>");
    expect(relative).toContain('data-sort-value="compare/bub"');
    // 不传 relativeTo 显示完整 id
    expect(html).toContain(">compare/bub</b>");
  });

  it("零 JS 靠原生 <details>,无 <script>", () => {
    expect(html).toContain("<details");
    expect(html).not.toContain("<script");
  });
});

describe("跨组件契约", () => {
  it("同一维度键在所有块里同色(稳定散列,与渲染顺序无关)", () => {
    const cls = colorClassForKey("bub");
    const table = renderToStaticMarkup(<MetricTable data={tableData} />);
    const matrix = renderToStaticMarkup(<MetricMatrix data={matrixData} />);
    const board = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);
    const attempts = renderToStaticMarkup(<AttemptList data={attemptListItems} />);
    const experiments = renderToStaticMarkup(<ExperimentList data={experimentListItems} />);
    for (const html of [table, matrix, board, attempts, experiments]) {
      expect(html).toContain(cls);
    }
    const scatter = renderToStaticMarkup(<MetricScatter data={scatterData} />);
    expect(scatter).toContain(seriesClassForKey("bub"));
  });

  it("静态输出不含 <script>:交互只靠 <a>/<details>/CSS", () => {
    const all = [
      renderToStaticMarkup(<ScopeSummary data={scopeSummaryData} />),
      renderToStaticMarkup(<MetricTable data={tableData} attemptHref={attemptHref} />),
      renderToStaticMarkup(<MetricMatrix data={matrixData} attemptHref={attemptHref} />),
      renderToStaticMarkup(<Scoreboard data={scoreboardData} />),
      renderToStaticMarkup(<MetricScatter data={scatterData} />),
      renderToStaticMarkup(<DeltaTable data={deltaData} />),
      renderToStaticMarkup(<AttemptList data={attemptListItems} />),
      renderToStaticMarkup(<EvalList data={evalListItems} />),
      renderToStaticMarkup(<ExperimentList data={experimentListItems} />),
    ].join("");
    expect(all).not.toContain("<script");
  });
});
