// 双面验收:每个官方组件对同一份数据,web 面(renderToStaticMarkup)与 text 面
// 给出一致判读 —— 排序方向随 better、samples < total 角标、缺数据 — 不补 0、
// 截断如实报剩余;text 面形态以内联快照锁定(照 report-components.mdx 的示例形态)。
// 另验收:排版原语的分栏与降级、渲染前树校验、defineComponent 自定义组件、
// defineReport + renderReportToText / renderReportToStaticHtml 两个宿主入口。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Results, Selection, Snapshot } from "../results/index.ts";
import {
  CaseList,
  Col,
  DefaultReport,
  DeltaTable,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  Row,
  RunOverview,
  Scoreboard,
  Section,
  Style,
  Text,
  defineComponent,
  defineReport,
  isReportDefinition,
  renderReportToText,
} from "./index.ts";
import { renderReportToStaticHtml } from "./web.ts";
import { createTextContext, renderNodeToText, validateReportTree } from "./tree.ts";
import {
  caseListData,
  deltaData,
  lineData,
  matrixData,
  overviewData,
  scatterData,
  scoreboardData,
  tableData,
} from "./react/fixtures.ts";

const ctx = createTextContext({ width: 80 });
const text = (node: Parameters<typeof renderNodeToText>[0]) => renderNodeToText(node, ctx);

// ───────────────────────── 每组件双面一致 ─────────────────────────

describe("RunOverview 双面", () => {
  const html = renderToStaticMarkup(<RunOverview data={overviewData} />);
  const term = text(<RunOverview data={overviewData} />);

  it("text 面形态:头行 + 判决行 + 警告行", () => {
    expect(term).toMatchInlineSnapshot(`
      "2 experiments · 12 evals · 48 attempts · composed from 2 runs · latest 2026-07-01T11:30:00Z
      passed 36 · failed 8 · errored 2 · skipped 2 · no data · 4m 21s
      ! snapshot covers 9 of 12 evals seen in history; re-run \`niceeval exp compare/bub\` for a full snapshot"
    `);
  });

  it("两面同口径:成本全缺都是 no data 不编 $0;警告都在", () => {
    for (const face of [html, term]) {
      expect(face).toContain("no data");
      expect(face).not.toContain("$0");
      expect(face).toContain("snapshot covers 9 of 12 evals");
    }
  });
});

describe("MetricTable 双面", () => {
  const html = renderToStaticMarkup(<MetricTable data={tableData} />);
  const term = text(<MetricTable data={tableData} />);

  it("text 面形态:对齐列 + 覆盖率角标 + 缺数据 —", () => {
    expect(term).toMatchInlineSnapshot(`
      "agent   pass rate   code lines
      codex   50%         —
      bub     87%         120 lines 5/6"
    `);
  });

  it("两面同口径:行序一致(预排即终排)、角标一致、缺数据不补 0", () => {
    // 行序:codex 在 bub 前(数据侧顺序,两面都不重排)
    expect(html.indexOf(">codex<")).toBeLessThan(html.indexOf(">bub<"));
    expect(term.indexOf("codex")).toBeLessThan(term.indexOf("bub"));
    // 覆盖率角标 5/6 两面都在
    expect(html).toContain("5/6");
    expect(term).toContain("5/6");
    // 全 null 格子:web 是 no data 文案,text 是 —,都绝不画 0
    expect(html).toContain("no data");
    expect(term).toContain("—");
  });
});

describe("MetricMatrix 双面", () => {
  const html = renderToStaticMarkup(<MetricMatrix data={matrixData} />);
  const term = text(<MetricMatrix data={matrixData} />);

  it("text 面形态:稀疏格子 — + 下钻命令指向最值得看的一行", () => {
    expect(term).toMatchInlineSnapshot(`
      "eval                bub    codex
      algebra/quadratic   100%   0%
      geometry/angles     50%    —

      next: niceeval show geometry/angles"
    `);
  });

  it("两面同口径:数字一致,稀疏格子不编数", () => {
    for (const value of ["100%", "0%", "50%"]) {
      expect(html).toContain(value);
      expect(term).toContain(value);
    }
    expect(html.match(/nre-td-empty/g)).toHaveLength(1); // web 空格子
  });
});

describe("MetricBars 双面", () => {
  const html = renderToStaticMarkup(<MetricBars data={matrixData} />);
  const term = text(<MetricBars data={matrixData} />);

  it("text 面形态:一组条 = 一个 row 键,条长即刻度,缺数据 —", () => {
    expect(term).toMatchInlineSnapshot(`
      "algebra/quadratic
        bub     ████████████████████  100%
        codex   ░░░░░░░░░░░░░░░░░░░░  0%
      geometry/angles
        bub     ██████████░░░░░░░░░░  50%
        codex   —"
    `);
  });

  it("两面同口径:组内按值排序(better higher 降序),缺数据不出柱", () => {
    expect(html).toContain("100%");
    expect(html).toContain("50%");
    // web 面:codex 在 geometry/angles 组没有柱(缺数据),柱数 = 3
    expect(html.match(/class="nre-bar"/g)).toHaveLength(3);
    // text 面:codex 行是 —
    expect(term).toContain("codex   —");
  });
});

describe("Scoreboard 双面", () => {
  const html = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);
  const term = text(<Scoreboard data={scoreboardData} />);

  it("text 面形态:总分/满分 + 分科 + missing 注脚 + 权重表", () => {
    expect(term).toMatchInlineSnapshot(`
      "agent   total      algebra             geometry
      bub     78.5/100   14/16 (1 missing)   3/4
      codex   52/100     9/16                1.4/4 (2 missing)
      weights: algebra/ ×2 · others ×1"
    `);
  });

  it("两面同口径:missing 与权重都如实", () => {
    expect(html).toContain("1 eval missing, scored 0");
    expect(term).toContain("(1 missing)");
    expect(html).toContain("algebra/ ×2");
    expect(term).toContain("algebra/ ×2");
  });
});

describe("MetricScatter 双面", () => {
  const html = renderToStaticMarkup(<MetricScatter data={scatterData} />);
  const term = text(<MetricScatter data={scatterData} />);

  it("text 面形态:字符坐标图 + 图例 + 缺数据注脚", () => {
    expect(term).toMatchInlineSnapshot(`
      "    pass rate ↑
       90%│B····
          │     ·········
          │              ··········
          │                        ·········
          │                                 ·········
          │                                          ·········
          │                                            C      ··········
          │                                                             ·········
       50%│                                                                      ····A
          └───────────────────────────────────────────────────────────────────────────→ cost (axis reversed: right = better)
           $10.00                                                                $5.00

      better → upper right
      A compare/bub-low   B compare/bub-high   C compare/codex-mid
      1 point missing data"
    `);
  });

  it("两面同口径:x 轴反向(lower 好的一端在右)、缺数据点都不画、注脚同数", () => {
    // web:$5(便宜)在 $10 右边(cx 更大)——render.test.tsx 已细测,这里只对注脚
    expect(html).toContain("1 point missing data");
    expect(term).toContain("1 point missing data");
    expect(html).not.toContain('data-key="compare/codex-broken"'); // 注脚 title 如实列缺数据的点,但不画
    // text 图例里也没有缺数据的点
    expect(term).not.toContain("codex-broken");
  });

  it("点太密时降级坐标表,不硬挤", () => {
    const narrow = renderNodeToText(<MetricScatter data={scatterData} />, createTextContext({ width: 40 }));
    expect(narrow).toContain("experiment");
    expect(narrow).toContain("$5.00");
    expect(narrow).not.toContain("└");
  });
});

describe("MetricLine 双面", () => {
  const html = renderToStaticMarkup(<MetricLine data={lineData} />);
  const term = text(<MetricLine data={lineData} />);

  it("text 面形态:同系列一个字母、沿 x 排布,y 轴刻度,图例 + 缺数据注脚", () => {
    expect(term).toMatchInlineSnapshot(`
      "    pass rate ↑
       80%│B··················
          │                   ·····································
          │                                                        ··················B
          │
          │
          │
          │A··················
          │                   ·····································
       30%│                                                        ··················A
          └───────────────────────────────────────────────────────────────────────────→ Simulated latency
           100ms                                                                 300ms

      A 1 agents   B 16 agents
      1 point missing data"
    `);
  });

  it("两面同口径:未声明 flag 的点两面都不画、注脚同数", () => {
    expect(html).toContain("1 point missing data");
    expect(term).toContain("1 point missing data");
    expect(html).not.toContain('data-key="ultra/legacy"'); // 注脚 title 如实列缺数据的点,但不画
  });
});

describe("DeltaTable 双面", () => {
  const html = renderToStaticMarkup(<DeltaTable data={deltaData} />);
  const term = text(<DeltaTable data={deltaData} />);

  it("text 面形态:A → B + Δ,单侧缺数据是 —,Δ=0 是 ±0", () => {
    expect(term).toMatchInlineSnapshot(`
      "pair    pass rate           cost
      bub     50% → 62%   +12pp   $0.20 → $0.35   +$0.15
      codex   40% → 40%   ±0      — → $0.30   —"
    `);
  });

  it("两面同口径:Δ 文案一致、缺数据都不硬算", () => {
    for (const piece of ["+12pp", "+$0.15", "±0"]) {
      expect(html).toContain(piece);
      expect(term).toContain(piece);
    }
    expect(html).toContain("nre-delta-missing");
    expect(term).toContain("— → $0.30");
  });
});

describe("CaseList 双面", () => {
  const html = renderToStaticMarkup(<CaseList data={caseListData} />);
  const term = text(<CaseList data={caseListData} />);

  it("text 面形态:逐条案例 + 下钻命令 + 截断报剩余", () => {
    expect(term).toMatchInlineSnapshot(`
      "✗ algebra/quadratic · compare/bub · failed · 32.0s · $0.12
          roots-correct — expected x=2, got x=3
            judge: sign flipped when substituting into the quadratic formula
          → niceeval show algebra/quadratic
      ✗ geometry/angles · compare/codex · errored · 4.5s
          TypeError: cannot read properties of undefined (reading 'foo')
          → niceeval show geometry/angles

      (2 more not shown)"
    `);
  });

  it("两面同口径:失败断言、error、truncated 数一致", () => {
    for (const piece of ["roots-correct", "expected x=2, got x=3", "TypeError", "2 more not shown"]) {
      expect(html).toContain(piece);
      expect(term).toContain(piece);
    }
  });
});

// ───────────────────────── 排版原语 ─────────────────────────

describe("排版原语", () => {
  it("Col 纵向堆叠;Section 标题 + 缩进;Text 折行;Style text 面为空", () => {
    const node = (
      <Col>
        <Section title="考试成绩单">
          <Text>algebra 权重 ×2,满分 100。</Text>
        </Section>
        <Style>{`.passbars i { background: #4a7; }`}</Style>
      </Col>
    );
    expect(text(node)).toMatchInlineSnapshot(`
      "考试成绩单
        algebra 权重 ×2,满分 100。"
    `);
    const html = renderToStaticMarkup(node);
    expect(html).toContain("<h2 class=\"nre-section-title\">考试成绩单</h2>");
    expect(html).toContain("<style>.passbars i { background: #4a7; }</style>");
  });

  it("Row:宽度够时字符分栏,│ 分隔,各栏折到自己的宽度", () => {
    const node = (
      <Row>
        <Text>left column body</Text>
        <Text>right column body</Text>
      </Row>
    );
    const wide = renderNodeToText(node, createTextContext({ width: 60 }));
    expect(wide).toContain("│");
    expect(wide.split("\n")[0]).toContain("left column body");
    expect(wide.split("\n")[0]).toContain("right column body");
  });

  it("Row:宽度不足降级纵向,不硬挤", () => {
    const node = (
      <Row>
        <Text>left column body</Text>
        <Text>right column body</Text>
      </Row>
    );
    const narrow = renderNodeToText(node, createTextContext({ width: 30 }));
    expect(narrow).not.toContain("│");
    expect(narrow).toContain("left column body\n\nright column body");
  });
});

// ───────────────────────── 树校验与自定义组件 ─────────────────────────

describe("渲染前树校验", () => {
  it("字符串 intrinsic(<div>)报错,错误指名组件路径", () => {
    const bad = (
      <Col>
        <Section title="x">
          <div>raw</div>
        </Section>
      </Col>
    );
    expect(() => validateReportTree(bad)).toThrow(
      /Raw HTML <div> has no terminal face; use <Text>, layout primitives, or a defineComponent component\. \(in <Col> > <Section>\)/,
    );
  });

  it("普通函数组件(组合页面片段)被调用展开继续校验", () => {
    const Fragmented = () => (
      <Col>
        <Text>ok</Text>
      </Col>
    );
    expect(() => validateReportTree(<Fragmented />)).not.toThrow();
    const BadInside = () => <span>nope</span>;
    expect(() => validateReportTree(<BadInside />)).toThrow(/Raw HTML <span>/);
  });
});

describe("defineComponent", () => {
  it("faces 两键必填,少一个面在运行时也拦住(编译期本就不过)", () => {
    // @ts-expect-error 缺 text 面编译不过;运行时同样报错
    expect(() => defineComponent({ web: () => null })).toThrow(/requires both faces/);
  });

  it("自定义双面组件:同一份数据两面判读一致,text 面拿到宽度", () => {
    interface BarRow {
      key: string;
      ratio: number | null;
      display: string;
    }
    const PassBars = defineComponent<{ rows: BarRow[] }>({
      web({ rows }) {
        return (
          <ul className="passbars">
            {rows.map((r) => (
              <li key={r.key}>
                <span>{r.key}</span>
                <b>{r.ratio === null ? "—" : r.display}</b>
              </li>
            ))}
          </ul>
        );
      },
      text({ rows }, { width }) {
        const bar = (n: number) => "█".repeat(Math.round(n * 10)).padEnd(10, "░");
        expect(width).toBe(80);
        return rows
          .map((r) => `${r.key.padEnd(8)} ${r.ratio === null ? "—".padEnd(10) : bar(r.ratio)} ${r.display}`)
          .join("\n");
      },
    });
    const rows: BarRow[] = [
      { key: "bub", ratio: 0.87, display: "87%" },
      { key: "claude", ratio: null, display: "—" },
    ];
    const term = text(<PassBars rows={rows} />);
    expect(term).toMatchInlineSnapshot(`
      "bub      █████████░ 87%
      claude   —          —"
    `);
    const html = renderToStaticMarkup(<PassBars rows={rows} />);
    expect(html).toContain("87%");
    expect(html).toContain("—"); // 缺数据两面都是 —,不补 0
  });
});

// ───────────────────────── defineReport 与两个宿主入口 ─────────────────────────

function fakeContext(): { selection: Selection; results: Results } {
  const snapshot: Snapshot = (() => {
    const summary = {
      agent: "bub",
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      passed: 1,
      failed: 1,
      skipped: 0,
      errored: 0,
      durationMs: 2000,
      results: [] as never[],
    };
    const runDir = { dir: "/results/run-1", summary, attempts: [] as never[] };
    const mk = (id: string, outcome: "passed" | "failed", index: number) => ({
      evalId: id,
      experimentId: "compare/bub",
      result: {
        id,
        agent: "bub",
        outcome,
        attempt: 0,
        startedAt: `2026-07-01T10:0${index}:00Z`,
        durationMs: 1000,
        assertions: [],
      },
      ref: { run: "run-1", result: index },
      runDir,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    });
    const attempts = [mk("algebra/x", "passed", 0), mk("algebra/y", "failed", 1)];
    return {
      experimentId: "compare/bub",
      startedAt: "2026-07-01T10:00:00Z",
      agent: "bub",
      schemaVersion: 1,
      evals: attempts.map((a) => ({ id: a.evalId, attempts: [a] })),
      attempts,
      runDir,
    } as unknown as Snapshot;
  })();
  const selection: Selection = {
    snapshots: [snapshot],
    warnings: [],
    filter: () => selection,
  };
  const results = {
    experiments: [{ id: "compare/bub", snapshots: [snapshot], latest: snapshot, evalIds: ["algebra/x", "algebra/y"] }],
    skipped: [],
    runDirs: [snapshot.runDir],
    latest: () => selection,
  } as Results;
  return { selection, results };
}

describe("defineReport + 渲染入口", () => {
  const report = defineReport(async ({ selection }) => (
    <Col>
      <DefaultReport />
      <Section title="考试成绩单">
        <Scoreboard data={await Scoreboard.data(selection, { rows: "agent", subjects: "evalGroup" })} />
      </Section>
    </Col>
  ));

  it("isReportDefinition 识别产物;非函数报错", () => {
    expect(isReportDefinition(report)).toBe(true);
    expect(isReportDefinition({})).toBe(false);
    // @ts-expect-error 非函数
    expect(() => defineReport(42)).toThrow(/expects a build function/);
  });

  it("renderReportToText:同一棵树走 text 面,DefaultReport 渲染宿主注入的选集", async () => {
    const out = await renderReportToText(report, fakeContext(), { width: 100 });
    // 官方水位 = show 榜单(viewing-results.mdx):Current verdicts 头 + experiment 榜单 + 失败清单
    expect(out).toContain("Current verdicts · 1 experiment · composed from 1 run");
    expect(out).toContain("experiment");
    expect(out).toContain("evals");
    expect(out).toContain("compare/bub");
    expect(out).toContain("1/2"); // eval 级折叠计票
    expect(out).toContain("50%");
    expect(out).toContain("Failing:");
    expect(out).toContain("✗ algebra/y");
    expect(out).toContain("→ niceeval show algebra/y"); // 失败清单每条自带下钻命令
    // 自己的口径:成绩单
    expect(out).toContain("考试成绩单");
    expect(out).toContain("bub     50/100");
  });

  it("renderReportToStaticHtml:同一棵树走 web 面,官方组件自动接证据室深链", async () => {
    const html = await renderReportToStaticHtml(report, fakeContext());
    expect(html).toContain("nre-default-report");
    expect(html).toContain("nre-scoreboard");
    expect(html).toContain("考试成绩单");
    // 宿主注入的 attemptHref:CaseList 的下钻是普通 <a>,默认 view 路由
    expect(html).toContain('href="#/attempt/run-1/1"');
    expect(html).not.toContain("<script");
  });

  it("树里混进 <div>:两个宿主渲染前同一遍校验拦住", async () => {
    const bad = defineReport(() => (
      <Col>
        <div>nope</div>
      </Col>
    ));
    await expect(renderReportToText(bad, fakeContext())).rejects.toThrow(/Raw HTML <div>/);
    await expect(renderReportToStaticHtml(bad, fakeContext())).rejects.toThrow(/Raw HTML <div>/);
  });

  it("<DefaultReport /> 在宿主之外渲染:一句直说的错误", () => {
    expect(() => renderToStaticMarkup(<DefaultReport />)).toThrow(/renders the host-injected selection/);
  });
});
