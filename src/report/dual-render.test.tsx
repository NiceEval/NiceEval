// 双面验收:每个官方组件对同一份数据,web 面(renderToStaticMarkup)与 text 面
// 给出一致判读 —— 排序方向随 better、samples < total 角标、缺数据 — 不补 0、
// 截断如实报剩余;text 面形态以内联快照锁定(照 report-components.mdx 的示例形态)。
// 另验收:排版原语的分栏与降级、渲染前树校验、defineComponent 自定义组件、
// defineReport + renderReportToText / renderReportToStaticHtml 两个宿主入口。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EvalResult } from "../types.ts";
import type { Results, Selection, Snapshot } from "../results/index.ts";
import type { GroupSummaryData, ScatterData } from "./types.ts";
import type { AttemptLocator, MetricScatterProps } from "./index.ts";
import { evalLevelStats } from "../shared/verdict.ts";
import {
  AttemptList,
  Col,
  DeltaTable,
  EvalList,
  ExperimentList,
  GroupSummary,
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
  Table,
  Text,
  bar,
  costUSD,
  defineComponent,
  defineReport,
  isReportDefinition,
  padEnd,
  passRate,
  renderReportToText,
  stringWidth,
} from "./index.ts";
import { CostPassRateComparison } from "./built-ins/index.ts";
import { renderReportToStaticHtml } from "./web.ts";
import { createTextContext, renderNodeToText, validateReportTree } from "./tree.ts";
import {
  attemptListItems,
  deltaData,
  evalListItems,
  experimentListItems,
  groupSummaryData,
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

  it("text 面形态:头行(含通过率)+ 判定行 + 警告行", () => {
    expect(term).toMatchInlineSnapshot(`
      "2 experiments · 12 evals · 48 attempts · Pass rate 70% 46/48 · composed from 2 runs · latest 2026-07-01T11:30:00Z
      passed 36 · failed 8 · errored 2 · skipped 2 · no data · 4m 21s
      ! snapshot covers 9 of 12 evals seen in history; re-run \`niceeval exp compare/bub\` for a full snapshot"
    `);
  });

  it("两面同口径:通过率显示同一个 MetricCell.display(70%,不是 36/46 现算的 78%);成本全缺都是 no data 不编 $0;警告都在", () => {
    for (const face of [html, term]) {
      expect(face).toContain("70%");
      expect(face).not.toContain("78%");
      expect(face).toContain("46/48"); // samples < total:两级聚合的覆盖率角标,两面一致
      expect(face).toContain("no data");
      expect(face).not.toContain("$0");
      expect(face).toContain("snapshot covers 9 of 12 evals");
    }
  });
});

// fixtures.overviewData 是手工摆好的终值,只验证渲染面「原样显示 MetricCell,不重算」;
// 下面这组用真实 Selection 走一遍 RunOverview.data(= compute.ts 的 overviewData()),
// 专门验证 totals.passRate 本身的计算口径 —— 三种通过率公式在这个 fixture 上各不相同:
//   两级聚合(唯一官方口径,docs/feature/reports/architecture.md「指标聚合不变量」):eval a 题内 2/3 通过、eval b 题内 1,
//     跨题均值 (2/3 + 1) / 2 = 5/6 ≈ 83.3%
//   attempt 原始占比(旧 bug 公式,曾经的 RunOverview 现场重算):3 passed / (3 passed + 1 failed) = 75%
//   eval 折叠投票(evalLevelStats,GroupSummary/MetricTable meta 的口径):a、b 都折成 passed → 2/2 = 100%
// 三个数互不相同,任何一处偷懒复用另一个公式都会在这里露馅。
describe("RunOverview.data · passRate 两级聚合口径", () => {
  function fakeVaryingAttemptsContext(): { selection: Selection; attempts: { evalId: string; result: { verdict: EvalResult["verdict"] } }[] } {
    const dir = "/results/compare_bub/snap-1";
    const base = {
      experimentId: "compare/bub",
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      agent: "bub",
      schemaVersion: 1,
      dir,
    };
    const mk = (evalId: string, verdict: "passed" | "failed" | "skipped", attemptIndex: number, minute: number) => ({
      evalId,
      experimentId: "compare/bub",
      result: {
        id: evalId,
        agent: "bub",
        verdict,
        attempt: attemptIndex,
        startedAt: `2026-07-01T10:0${minute}:00Z`,
        durationMs: 1000,
        assertions: [],
      },
      ref: { snapshot: "compare_bub/snap-1", attempt: `${evalId}/a${attemptIndex}` },
      snapshot: base,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    });
    const attempts = [
      // eval a:3 attempts,2 通过 1 失败 → 题内 partial credit 2/3
      mk("algebra/a", "passed", 0, 0),
      mk("algebra/a", "failed", 1, 1),
      mk("algebra/a", "passed", 2, 2),
      // eval b:1 attempt 通过 → 题内 1
      mk("algebra/b", "passed", 0, 3),
      // eval c:1 attempt 跳过 —— 两级聚合与 eval 折叠计票都要把它排除在分母外
      mk("algebra/c", "skipped", 0, 4),
    ];
    const evalIds = [...new Set(attempts.map((a) => a.evalId))];
    const snapshot: Snapshot = {
      ...base,
      evals: evalIds.map((id) => ({ id, attempts: attempts.filter((a) => a.evalId === id) })),
      attempts,
    } as unknown as Snapshot;
    const selection: Selection = { snapshots: [snapshot], warnings: [], filter: () => selection };
    return { selection, attempts };
  }

  it("totals.passRate = 两级聚合 83.3%,既不等于 attempt 原始占比 75%,也不等于 eval 折叠投票 100%", async () => {
    const { selection, attempts } = fakeVaryingAttemptsContext();
    const data = await RunOverview.data(selection);

    expect(data.totals.passRate.value).toBeCloseTo(5 / 6, 10);
    expect(data.totals.passRate.display).toBe("83.3%");
    expect(data.totals.passRate.samples).toBe(4); // 5 attempts - 1 skipped(不进桶)
    expect(data.totals.passRate.total).toBe(5);

    // attempt 原始占比(旧 bug 公式):必须与两级聚合不同,证明没有从 passed/failed/errored 现算
    const attemptFraction = data.totals.passed / (data.totals.passed + data.totals.failed + data.totals.errored);
    expect(attemptFraction).toBeCloseTo(0.75, 10);
    expect(attemptFraction).not.toBeCloseTo(data.totals.passRate.value as number, 3);

    // eval 折叠投票(evalLevelStats,GroupSummary 的口径):也必须与两级聚合不同
    const stats = evalLevelStats(
      attempts.map((a) => ({ verdict: a.result.verdict, key: a.evalId })),
      (r) => r.key,
    );
    expect(stats.passRate).toBeCloseTo(1, 10);
    expect(stats.passRate).not.toBeCloseTo(data.totals.passRate.value as number, 3);
  });

  it("web 面与 text 面显示同一个 passRate.display,覆盖率角标(4/5)两面一致", async () => {
    const { selection } = fakeVaryingAttemptsContext();
    const data = await RunOverview.data(selection);
    const html = renderToStaticMarkup(<RunOverview data={data} />);
    const term = text(<RunOverview data={data} />);
    for (const face of [html, term]) {
      expect(face).toContain(data.totals.passRate.display);
      expect(face).toContain("4/5");
    }
  });
});

// ───────────────────────── GroupSummary ─────────────────────────

describe("GroupSummary 双面", () => {
  const html = renderToStaticMarkup(<GroupSummary data={groupSummaryData} />);
  const term = text(<GroupSummary data={groupSummaryData} />);

  it("text 面形态:一行头(通过率 + experiment/eval 数 + failed/errored + 总成本)+ 最后运行时间", () => {
    expect(term).toMatchInlineSnapshot(`
      "Pass rate 60% 5/6 · 2 experiments · 6 evals · failed 1 · errored 1 · $1.50
      latest 2026-07-01T11:30:00Z"
    `);
  });

  it("两面同口径:通过率显示同一个 MetricCell.display(60%,不是现场重算);总成本、最后运行时间两面一致", () => {
    for (const face of [html, term]) {
      expect(face).toContain("60%");
      expect(face).toContain("$1.50");
      expect(face).toContain("2026-07-01T11:30:00Z");
    }
    // 覆盖率角标:samples(5) < total(6) —— 1 道 eval 是 skipped,没进分母
    expect(html).toContain("5/6");
    expect(term).toContain("5/6");
  });

  it("缺成本:两面都显示无数据文案,不编 $0", () => {
    const missingCost: GroupSummaryData = { ...groupSummaryData, totalCostUSD: null };
    const h = renderToStaticMarkup(<GroupSummary data={missingCost} />);
    const t = text(<GroupSummary data={missingCost} />);
    for (const face of [h, t]) {
      expect(face).toContain("no data");
      expect(face).not.toContain("$0");
    }
  });

  it("零失败:web 面整个 errored 片段不渲染,text 面也没有 errored 分段;failed 仍如实显示 0(不是省略整个字段)", () => {
    const allPassed: GroupSummaryData = {
      ...groupSummaryData,
      verdicts: { passed: 6, failed: 0, errored: 0, skipped: 0 },
      passRate: { value: 1, display: "100%", samples: 6, total: 6, refs: [] },
    };
    const h = renderToStaticMarkup(<GroupSummary data={allPassed} />);
    const t = text(<GroupSummary data={allPassed} />);
    expect(h).not.toContain("nre-verdict-errored");
    expect(h).not.toContain(">errored<");
    expect(t).not.toContain("errored");
    // failed 计数依旧渲染,哪怕是 0 —— 数据字段本身从不省略,只是 errored 的展示片段在 0 时省略
    expect(h).toContain(">failed<");
    expect(t).toContain("failed 0");
  });

  it("存在错误:两面都显示 errored 计数(与 groupSummaryData 基础 fixture 的 errored:1 一致)", () => {
    expect(html).toContain("nre-verdict-errored");
    expect(html).toContain(">errored<");
    expect(term).toContain("errored 1");
  });

  it("zh-CN locale:web 面走中文字典(通过率/失败/错误/总成本/实验数),text 面同理;display 数字不本地化", () => {
    const zhHtml = renderToStaticMarkup(<GroupSummary data={groupSummaryData} locale="zh-CN" />);
    expect(zhHtml).toContain("通过率");
    expect(zhHtml).toContain("失败");
    expect(zhHtml).toContain("错误");
    expect(zhHtml).toContain("总成本");
    expect(zhHtml).toContain("实验数");
    expect(zhHtml).toContain("60%"); // display 本身不随 locale 变

    const zhCtx = createTextContext({ width: 80, locale: "zh-CN" });
    const zhTerm = renderNodeToText(<GroupSummary data={groupSummaryData} />, zhCtx);
    expect(zhTerm).toContain("通过率");
    expect(zhTerm).toContain("失败 1");
    expect(zhTerm).toContain("错误 1");
    expect(zhTerm).toContain("60%");
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
    expect(html.match(/class="nre-bar /g)).toHaveLength(3);
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

describe("AttemptList 双面", () => {
  const html = renderToStaticMarkup(<AttemptList items={attemptListItems} />);
  const term = text(<AttemptList items={attemptListItems} />);

  it("两面同口径:判定符 + locator + 证据能力标记 + 断言/error 明细 + 下钻命令一致", () => {
    for (const piece of ["roots-correct", "expected x=2, got x=3", "TypeError", "@1a4a4a4", "@1c1c1c1"]) {
      expect(html).toContain(piece);
      expect(term).toContain(piece);
    }
    // web 面走证据室路由(#/attempt/@<locator>);text 面只列 locator 本身,不重复整条命令
    // (docs/feature/reports/architecture.md「text 输出只在整份报告末尾给一次命令模板」)。
    expect(html).toContain('href="#/attempt/@1a4a4a4"');
    // 证据能力标记两面一致:failedAttempt 有 eval/execution/timing,erroredAttempt 只有 execution
    expect(term).toContain("[E,X,⏱]");
    expect(html).toContain("[E,X,⏱]");
  });

  it("total > items.length 时两面都如实报剩余数量", () => {
    const htmlTrunc = renderToStaticMarkup(<AttemptList items={attemptListItems} total={attemptListItems.length + 2} />);
    const termTrunc = text(<AttemptList items={attemptListItems} total={attemptListItems.length + 2} />);
    expect(htmlTrunc).toContain("2 more not shown");
    expect(termTrunc).toContain("2 more not shown");
  });
});

describe("EvalList 双面", () => {
  const html = renderToStaticMarkup(<EvalList items={evalListItems} />);
  const term = text(<EvalList items={evalListItems} />);

  it("两面同口径:身份、判定、展开到 Attempt 的 locator 徽标一致", () => {
    for (const piece of ["algebra/quadratic", "compare/bub", "geometry/angles", "compare/codex", "@1a4a4a4", "@1c1c1c1"]) {
      expect(html).toContain(piece);
      expect(term).toContain(piece);
    }
  });

  it("text 面的 score 行插值正确:不留字面量占位符 {score}(回归——曾把带插值的 locale 模板当纯标签用,漏传 vars)", () => {
    expect(term).toContain("score 0%");
    expect(term).not.toContain("{score}");
  });
});

describe("ExperimentList 双面", () => {
  const html = renderToStaticMarkup(<ExperimentList items={experimentListItems} />);
  const term = text(<ExperimentList items={experimentListItems} />);

  it("两面同口径:身份、Eval 判定构成、展开到 Eval 的 locator 徽标一致", () => {
    for (const piece of ["compare/bub", "compare/codex", "algebra/quadratic", "geometry/angles", "@1a4a4a4", "@1c1c1c1"]) {
      expect(html).toContain(piece);
      expect(term).toContain(piece);
    }
    // 官方两级聚合 passRate.display 两面同一个数字,不各自重算
    expect(html).toContain("50%");
    expect(term).toContain("50%");
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

// ───────────────────────── Table(自定义表的标准件)─────────────────────────
//
// 官方的 MetricTable / MetricMatrix / Scoreboard / DeltaTable 的 text 面就建在它上面
// (上面那几个 describe 的内联快照即它的输出);这里验收作者直接用它时的四条契约:
// 显示宽度对齐(中文不撕歪)、右对齐、缺数据 —、超宽折行。

/** 某个片段的右边缘落在第几显示列 —— 右对齐验收看的就是它。 */
function displayEndOf(line: string, piece: string): number {
  const at = line.indexOf(piece);
  expect(at).toBeGreaterThanOrEqual(0);
  return stringWidth(line.slice(0, at + piece.length));
}

describe("Table 双面", () => {
  const cjkTable = (
    <Table
      columns={[
        { key: "eval", header: "题目" },
        { key: "pass", header: "通过率", align: "right" },
        { key: "cost", header: "成本", align: "right" },
      ]}
      rows={[
        {
          key: "记忆/写缓存",
          locator: "@160iuj3h" as AttemptLocator,
          cells: { eval: "记忆/写缓存", pass: "87%", cost: "$0.09" },
        },
        {
          key: "浏览/表单填写",
          locator: "@1qrdcfq8" as AttemptLocator,
          cells: { eval: "浏览/表单填写", pass: null, cost: null },
        },
      ]}
    />
  );

  it("中文列宽:按显示宽度对齐(CJK 记 2 列),不是 .length —— String.padEnd 撕歪表的那一步", () => {
    const term = text(cjkTable);
    expect(term).toMatchInlineSnapshot(`
      "题目            通过率    成本   attempt
      记忆/写缓存        87%   $0.09   @160iuj3h
      浏览/表单填写        —       —   @1qrdcfq8"
    `);

    const [header, first, second] = term.split("\n");
    // 每列的右边缘落在同一显示列:中文格子多一倍显示宽度,补齐必须按显示宽度算
    expect(displayEndOf(first, "87%")).toBe(displayEndOf(header, "通过率"));
    expect(displayEndOf(second, "—")).toBe(displayEndOf(header, "通过率"));
    expect(displayEndOf(first, "$0.09")).toBe(displayEndOf(header, "成本"));
    expect(displayEndOf(first, "@160iuj3h")).toBe(displayEndOf(second, "@1qrdcfq8"));
    // 上面那几条不是巧合:UTF-16 码元数与显示宽度在中文上就是不同的两个数,
    // 拿 .length 补齐(或 String.prototype.padEnd)必然歪
    expect("记忆/写缓存".length).toBe(6);
    expect(stringWidth("记忆/写缓存")).toBe(11);
  });

  it("align: \"right\":长短不一的数字右边缘对齐;默认列仍是左对齐", () => {
    const term = text(
      <Table
        columns={[
          { key: "agent", header: "agent" },
          { key: "cost", header: "cost", align: "right" },
        ]}
        rows={[
          { key: "bub", cells: { agent: "bub", cost: "$9.00" } },
          { key: "codex", cells: { agent: "codex", cost: "$123.45" } },
        ]}
      />,
    );
    expect(term).toMatchInlineSnapshot(`
      "agent      cost
      bub       $9.00
      codex   $123.45"
    `);
    const [, first, second] = term.split("\n");
    expect(displayEndOf(first, "$9.00")).toBe(displayEndOf(second, "$123.45"));
    // 左对齐列的左边缘对齐(不传 align 就是 left)
    expect(first.startsWith("bub")).toBe(true);
    expect(second.startsWith("codex")).toBe(true);
  });

  it("null → —,不补 0;cells 里干脆缺这个键也是 —;两面同源", () => {
    const node = (
      <Table
        columns={[
          { key: "agent", header: "agent" },
          { key: "pass", header: "pass", align: "right" },
          { key: "cost", header: "cost", align: "right" },
        ]}
        rows={[
          { key: "bub", cells: { agent: "bub", pass: "87%", cost: "$0.42" } },
          { key: "claude", cells: { agent: "claude", pass: null } }, // cost 键根本不在
        ]}
      />
    );
    const term = text(node);
    const html = renderToStaticMarkup(node);
    expect(term).toMatchInlineSnapshot(`
      "agent    pass    cost
      bub       87%   $0.42
      claude      —       —"
    `);
    for (const face of [term, html]) {
      expect(face).toContain("—");
      expect(face).not.toContain("$0.00");
      expect(face).not.toContain("0%");
    }
    expect(html).toContain('<td class="nre-align-right"><span class="nre-missing">—</span></td>');
  });

  it("超宽:先折最宽的左对齐列(数字列不折),压到下限仍放不下就丢列并如实报数", () => {
    const wide = (
      <Table
        columns={[
          { key: "eval", header: "eval" },
          { key: "reason", header: "reason" },
          { key: "cost", header: "cost", align: "right" },
        ]}
        rows={[
          {
            key: "weather/brooklyn",
            cells: {
              eval: "weather/brooklyn",
              reason: "gate calledTool(\"get_weather\") — the tool was never called by the agent",
              cost: "$0.04",
            },
          },
        ]}
      />
    );
    const narrow = renderNodeToText(wide, createTextContext({ width: 48 }));
    // 折行:一条逻辑行铺成多条物理行,没有一行溢出 48 列
    const lines = narrow.split("\n");
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(48);
    // 数字列没被折:$0.04 完整出现在某一行上
    expect(narrow).toContain("$0.04");
    expect(narrow).toContain("never called");

    // 压到下限还是放不下 → 从右侧丢列,如实报剩余列数(不静默截断)
    const tiny = renderNodeToText(wide, createTextContext({ width: 20 }));
    expect(tiny).toContain("(1 more column not shown)");
    expect(tiny).not.toContain("$0.04");
  });

  it("行带 locator:web 面链到证据室,text 面多一列 attempt", () => {
    const html = renderToStaticMarkup(cjkTable);
    expect(html).toContain('<a class="nre-locator" href="#/attempt/@160iuj3h">@160iuj3h</a>');
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(text(cjkTable)).toContain("@160iuj3h");
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

  // custom-reports.mdx「换形态」的 PassBars 示例,逐字同源:text 面用公开的文本排版工具箱
  // (stringWidth / padEnd / bar),不用 String.prototype.padEnd —— 中文名的那一行是护栏。
  it("自定义双面组件:同一份数据两面判读一致,text 面拿到宽度;中文行不撕歪", () => {
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
        expect(width).toBe(80);
        const label = Math.max(...rows.map((r) => stringWidth(r.key)));
        const barWidth = Math.min(20, width - label - 8);
        return rows
          .map((r) => {
            const chart = r.ratio === null ? padEnd("—", barWidth) : bar(r.ratio, barWidth);
            return `${padEnd(r.key, label)}  ${chart}  ${r.display}`;
          })
          .join("\n");
      },
    });
    const rows: BarRow[] = [
      { key: "bub", ratio: 0.87, display: "87%" },
      { key: "codex", ratio: 0.8, display: "80%" },
      { key: "克劳德", ratio: null, display: "—" },
    ];
    const term = text(<PassBars rows={rows} />);
    expect(term).toMatchInlineSnapshot(`
      "bub     █████████████████░░░  87%
      codex   ████████████████░░░░  80%
      克劳德  —                     —"
    `);
    // 三行的条形都从同一显示列开始:"克劳德" 是 3 个码元、6 个显示列,
    // 拿 .padEnd(label) 补齐会把这一行整体左移 3 列
    const starts = term.split("\n").map((line, i) => stringWidth(line.slice(0, line.indexOf(["█", "█", "—"][i]))));
    expect(new Set(starts).size).toBe(1);

    const html = renderToStaticMarkup(<PassBars rows={rows} />);
    expect(html).toContain("87%");
    expect(html).toContain("—"); // 缺数据两面都是 —,不补 0
  });
});

// ───────────────────────── defineReport 与两个宿主入口 ─────────────────────────

function fakeContext(): { selection: Selection; results: Results } {
  const snapshot: Snapshot = (() => {
    const dir = "/results/compare_bub/snap-1";
    const base = {
      experimentId: "compare/bub",
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      agent: "bub",
      schemaVersion: 1,
      dir,
    };
    const mk = (id: string, verdict: "passed" | "failed", index: number) => ({
      evalId: id,
      experimentId: "compare/bub",
      result: {
        id,
        agent: "bub",
        verdict,
        attempt: 0,
        startedAt: `2026-07-01T10:0${index}:00Z`,
        durationMs: 1000,
        assertions: [],
      },
      ref: { snapshot: "compare_bub/snap-1", attempt: `${id}/a0` },
      snapshot: base,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    });
    const attempts = [mk("algebra/x", "passed", 0), mk("algebra/y", "failed", 1)];
    return {
      ...base,
      evals: attempts.map((a) => ({ id: a.evalId, attempts: [a] })),
      attempts,
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
    latest: () => selection,
  } as Results;
  return { selection, results };
}

/**
 * 三份快照、三个 experiment("compare/bub"、"other/codex"、"solo"),全部通过、无成本——
 * 一个多实验 Selection 夹具:ExperimentList 出三项,MetricScatter 三个点都无成本
 * (0 可画点,如实走空态)。`filter` 落实真实语义(不像 fakeContext 那样恒等返回自己)。
 */
function fakeMultiGroupContext(): { selection: Selection; results: Results } {
  const mkSnapshot = (experimentId: string, agent: string, dirSuffix: string): Snapshot => {
    const dir = `/results/${dirSuffix}`;
    const base = {
      experimentId,
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      agent,
      schemaVersion: 1,
      dir,
    };
    const attempt = {
      evalId: "algebra/x",
      experimentId,
      result: {
        id: "algebra/x",
        agent,
        verdict: "passed" as const,
        attempt: 0,
        startedAt: "2026-07-01T10:00:00Z",
        durationMs: 1000,
        assertions: [],
      },
      ref: { snapshot: dirSuffix, attempt: "algebra/x/a0" },
      snapshot: base,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    };
    return {
      ...base,
      evals: [{ id: attempt.evalId, attempts: [attempt] }],
      attempts: [attempt],
    } as unknown as Snapshot;
  };

  const snapshots = [
    mkSnapshot("compare/bub", "bub", "compare_bub/snap-1"),
    mkSnapshot("other/codex", "codex", "other_codex/snap-1"),
    mkSnapshot("solo", "bub", "solo/snap-1"),
  ];

  const makeSelection = (snaps: Snapshot[]): Selection => ({
    snapshots: snaps,
    warnings: [],
    filter: (predicate) => makeSelection(snaps.filter(predicate)),
  });
  const selection = makeSelection(snapshots);
  const results = {
    experiments: snapshots.map((s) => ({
      id: s.experimentId,
      snapshots: [s],
      latest: s,
      evalIds: ["algebra/x"],
    })),
    skipped: [],
    latest: () => selection,
  } as Results;
  return { selection, results };
}

describe("defineReport + 渲染入口", () => {
  // ExperimentList 没有 selection-form:build() 里直接 await .data(selection) 拿到普通数组
  // 再传 items;RunOverview / Scoreboard 同样是预计算的 data 形态。三者都在 build() 里
  // await,一棵树验证同一个 renderReportToText/renderReportToStaticHtml 管线消费得动它们。
  const report = defineReport(async ({ selection }) => {
    const experiments = await ExperimentList.data(selection);
    return (
      <Col>
        <RunOverview data={await RunOverview.data(selection)} />
        <ExperimentList items={experiments} />
        <Section title="考试成绩单">
          <Scoreboard data={await Scoreboard.data(selection, { rows: "agent", subjects: "evalGroup" })} />
        </Section>
      </Col>
    );
  });

  it("isReportDefinition 识别产物;非函数报错", () => {
    expect(isReportDefinition(report)).toBe(true);
    expect(isReportDefinition({})).toBe(false);
    // @ts-expect-error 非函数
    expect(() => defineReport(42)).toThrow(/expects a build function/);
  });

  it("renderReportToText:同一棵树走 text 面,build() 里 await 的实体列表数据原样渲染", async () => {
    const out = await renderReportToText(report, fakeContext(), { width: 100 });
    // RunOverview(data 形态,预计算)
    expect(out).toContain("1 experiment · 2 evals · 2 attempts");
    // ExperimentList:主行 + eval 级折叠计票 + 失败诊断(locator 徽标带证据能力标记)
    expect(out).toContain("compare/bub · bub");
    expect(out).toContain("1 passed / 1 failed");
    expect(out).toContain("50%");
    expect(out).toMatch(/✗ algebra\/y\s+@[0-9a-z]+✗/);
    // 自己的口径:成绩单
    expect(out).toContain("考试成绩单");
    expect(out).toContain("bub");
    expect(out).toContain("50/100");
  });

  it("renderReportToStaticHtml:同一棵树走 web 面,ExperimentList 自动接证据室深链", async () => {
    const html = await renderReportToStaticHtml(report, fakeContext());
    expect(html).toContain("nre-experiment-list");
    expect(html).toContain("nre-scoreboard");
    expect(html).toContain("考试成绩单");
    // 宿主注入的 attemptHref:ExperimentList 的 locator 徽标是普通 <a>,默认 view 路由(单段 locator)
    expect(html).toMatch(/href="#\/attempt\/@[0-9a-z]+"/);
    expect(html).not.toContain("<script");
  });

  it("树里混进 <div>:两个宿主 resolve 后同一遍校验拦住", async () => {
    const bad = defineReport(() => (
      <Col>
        <div>nope</div>
      </Col>
    ));
    await expect(renderReportToText(bad, fakeContext())).rejects.toThrow(/Raw HTML <div>/);
    await expect(renderReportToStaticHtml(bad, fakeContext())).rejects.toThrow(/Raw HTML <div>/);
  });

  it("selection 形态组件裸嵌进 React(不经宿主 resolve):web 面直说未解析", () => {
    const { selection } = fakeContext();
    // selection 形态在类型上合法,但裸调用路径(不过 resolveReportTree)只接收 data 形态,
    // web 面拿不到 data —— 运行时直说,而不是画一张空组件。MetricScatter 是本文件里仍带
    // selection-form 的官方组件(ExperimentList/EvalList/AttemptList 没有 selection-form,
    // 这条契约不适用于它们)。
    expect(() =>
      renderToStaticMarkup(<MetricScatter selection={selection} points="experiment" x={costUSD} y={passRate} />),
    ).toThrow(/received unresolved \(selection-form\) props/);
  });
});

// ───────────────────────── 数据组件互斥 props(类型层负向)─────────────────────────
// 只在 pnpm run typecheck 生效(src 纳入 tsconfig);函数从不执行,仅让 tsc 校验每条
// ts-expect-error 注释对应一处编译错误。直接标注 Props 类型(而非 JSX)——JSX 的 union
// 属性检查对「缺必填字段」较宽松,直接的类型赋值才严格钉住互斥不变量:同时传 data 与
// selection、或两者都不传、或 selection 形态缺必填计算选项,全部编译失败。正向 JSX 用法由
// CostPassRateComparison / defineReport 报告在同一文件里编译验证。
function metricScatterPropsTypeChecks(selection: Selection, data: ScatterData): void {
  const ok1: MetricScatterProps = { data }; // 合法:data 形态
  const ok2: MetricScatterProps = { selection, points: "experiment", series: "agent", x: costUSD, y: passRate }; // 合法:selection 形态
  // @ts-expect-error 同时传 data 与 selection:非法
  const bad1: MetricScatterProps = { data, selection, points: "experiment", x: costUSD, y: passRate };
  // @ts-expect-error data 与 selection 都不传:非法
  const bad2: MetricScatterProps = { pointHref: () => "/x" };
  // @ts-expect-error selection 形态缺必填的 x / y:非法
  const bad3: MetricScatterProps = { selection, points: "experiment" };
  void ok1;
  void ok2;
  void bad1;
  void bad2;
  void bad3;
}

void metricScatterPropsTypeChecks;

// ───────────────────────── CostPassRateComparison(内置默认报告)─────────────────────────

describe("CostPassRateComparison", () => {
  it("是普通 ReportDefinition;text 面 = 成本×通过率散点 + 实验列表,别无它物", async () => {
    expect(isReportDefinition(CostPassRateComparison)).toBe(true);
    const out = await renderReportToText(CostPassRateComparison, fakeContext(), { width: 100 });
    // 散点:fakeContext 无成本数据 → 0 可画点,显式说明缺哪两个指标(而不是画一张空图)
    expect(out).toContain("No data to plot");
    expect(out).not.toContain("better → upper right");
    // 实验列表主行 + eval 级折叠计票 + 失败诊断(ExperimentList.data 在 build() 里直接 await)
    expect(out).toContain("compare/bub · bub");
    expect(out).toContain("1 passed / 1 failed");
    expect(out).toContain("50%");
    expect(out).toMatch(/✗ algebra\/y\s+@[0-9a-z]+✗/);
    // 只有两个直接业务组件:没有 RunOverview / GroupSummary / Section 分组
    expect(out).not.toContain("Current verdicts");
  });

  it("web 面:散点空态 + 实验列表 <details> 展开区,无 <script>,无 Section 分组", async () => {
    const html = await renderReportToStaticHtml(CostPassRateComparison, fakeContext());
    expect(html).toContain("nre-metric-scatter");
    expect(html).toContain("nre-scatter-empty"); // 0 可画点的空态
    expect(html).toContain('<li class="nre-experiment-entry">');
    expect(html).toContain("nre-experiment-evals");
    expect(html).not.toContain("nre-section");
    expect(html).not.toContain("<script");
  });

  it("locale 变体:en / zh-CN 都渲染(chrome 分语言),散点空态两面同一事实", async () => {
    const zhHtml = await renderReportToStaticHtml(CostPassRateComparison, fakeContext(), { locale: "zh-CN" });
    expect(zhHtml).toContain("成功率"); // passRate 的 zh-CN label(ExperimentList 主行)
    const enHtml = await renderReportToStaticHtml(CostPassRateComparison, fakeContext(), { locale: "en" });
    expect(enHtml).toContain("Pass rate");
    const zhText = await renderReportToText(CostPassRateComparison, fakeContext(), { locale: "zh-CN" });
    expect(zhText).toContain("没有可绘制的数据"); // 散点空态 zh
    const enText = await renderReportToText(CostPassRateComparison, fakeContext(), { locale: "en" });
    expect(enText).toContain("No data to plot");
  });

  it("多实验 fixture:每个 experiment 一项,散点如实处理全部无成本", async () => {
    const out = await renderReportToText(CostPassRateComparison, fakeMultiGroupContext(), { width: 100 });
    // 三个 experiment 的身份行都出现(experimentId · agent,不再截短成最后一段)
    expect(out).toContain("compare/bub · bub");
    expect(out).toContain("other/codex · codex");
    expect(out).toContain("solo · bub");
    // 散点空态(三点都无成本)
    expect(out).toContain("No data to plot");
    // 没有组分 Section 标题(不再按目录前缀分组)
    expect(out).not.toMatch(/^compare$/m);
    const html = await renderReportToStaticHtml(CostPassRateComparison, fakeMultiGroupContext());
    expect(html).not.toContain("nre-section");
  });
});
