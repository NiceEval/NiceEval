// 代表性自定义报告 2/2 —— 自定义多页 + page.render + attempt page(docs/engineering/testing/e2e/
// report.md §5「自定义报告的用户操作回归」)。三张可导航页 + 一张不进导航的自定义 attempt-input
// page,pages 是字面量(shell.md「render / pages / extends 恰好声明一个」),不 extends 任何内建
// 报告 —— 用来证明"用户改一份报告文件就能踩到的路径"不依赖内建组件组合。
//
// 顺手覆盖 verify-render-structure.ts 头注 COVERAGE GAP #2/#3:内建 standard 报告从没用到
// Section 嵌套边框、Grid 列数规划、aggregate 矩阵 / 成绩单 / 对比表 ——
// overview 页用嵌套 Section 包 Grid/Stat(toSummaryItems 现算)与 eval×agent 矩阵 Table;scoreboard
// 页用 aggregate 成绩单与带过滤框的对比 Table。
import type { AttemptEvidence, Sample } from "niceeval/record";
import type { AttemptListItem, Cell, MetricValue } from "niceeval/report";
import {
  AttemptAssessment,
  AttemptSummary,
  Col,
  CopyBlock,
  Grid,
  SampleNotices,
  Section,
  Stat,
  Table,
  aggregate,
  agent,
  costUSD,
  defineReport,
  durationMs,
  evalId,
  experiment,
  formatMetricValue,
  mean,
  passRate,
  rollup,
  toAttemptFixPrompt,
  toAttemptListRows,
  toAttemptSummary,
  toSummaryItems,
} from "niceeval/report";

const SCOREBOARD_QUESTIONS = ["tool-call", "deliberate-fail", "deliberate-error"] as const;
const SCOREBOARD_FULL_MARKS = 100;

/** 与内建 examScore 同口径的 rollup Calculation —— 成绩单页固定题集打分用。 */
const examScore = rollup(
  async (attempt) => {
    const { verdict, assertions } = attempt.result;
    if (verdict === "unreadable") return null;
    if (verdict !== "passed") return 0;
    const soft = assertions.filter(
      (x) => x.severity === "soft" && x.outcome !== "unavailable" && x.points === undefined,
    );
    if (soft.length === 0) return 1;
    return soft.reduce((sum, x) => sum + (x.outcome === "unavailable" ? 0 : x.score), 0) / soft.length;
  },
  { withinEval: mean, acrossEvals: mean, unit: "%", better: "higher" },
);

function metricValueCell(metric: MetricValue): Cell {
  return { kind: "metric", metric };
}

function matrixTableRows(
  rows: ReadonlyArray<{ eval: string; agent: string; passRate: MetricValue }>,
): { columns: string[]; rows: Array<Record<string, unknown> & { key: string }> } {
  const columnKeys = [...new Set(rows.map((row) => row.agent))].sort();
  const rowKeys = [...new Set(rows.map((row) => row.eval))].sort();
  const byPosition = new Map(rows.map((row) => [`${row.eval}\0${row.agent}`, row] as const));
  return {
    columns: ["eval", ...columnKeys],
    rows: rowKeys.map((evalKey) => {
      const tableRow: Record<string, unknown> & { key: string } = {
        key: evalKey,
        eval: { kind: "text", text: evalKey },
      };
      for (const columnKey of columnKeys) {
        const row = byPosition.get(`${evalKey}\0${columnKey}`);
        tableRow[columnKey] = row ? metricValueCell(row.passRate) : { kind: "notApplicable" };
      }
      return tableRow;
    }),
  };
}

function scoreboardTableRows(
  rows: ReadonlyArray<{ experiment: string; eval: string; score: MetricValue }>,
): Array<{ key: string; entity: Cell; total: Cell }> {
  const experiments = [...new Set(rows.map((row) => row.experiment))].sort();
  const byExpEval = new Map(rows.map((row) => [`${row.experiment}\0${row.eval}`, row] as const));
  return experiments.map((exp) => {
    let earned = 0;
    const possible = SCOREBOARD_QUESTIONS.length;
    for (const question of SCOREBOARD_QUESTIONS) {
      const row = byExpEval.get(`${exp}\0${question}`);
      if (!row) continue;
      const value = row.score.value;
      if (value !== null) earned += value;
    }
    const totalValue = (SCOREBOARD_FULL_MARKS * earned) / possible;
    return {
      key: exp,
      entity: { kind: "text", text: exp },
      total: { kind: "score", earned: totalValue, possible: SCOREBOARD_FULL_MARKS },
    };
  });
}

function attemptListTableRows(
  items: readonly AttemptListItem[],
): Array<{
  key: string;
  entity: Cell;
  verdict: Cell;
  result: Cell;
  durationMs: Cell;
  costUSD: Cell;
}> {
  return items.map((item) => ({
    key: item.locator,
    entity: {
      kind: "locator",
      locator: item.locator,
      staleSinceMs: item.historical ? 1 : undefined,
    },
    verdict: { kind: "verdict", verdict: item.verdict },
    result:
      item.failureSummary !== null
        ? {
            kind: "summary",
            text: item.failureSummary,
            more: item.moreFailures > 0 ? item.moreFailures : undefined,
          }
        : { kind: "text", text: "—" },
    durationMs: {
      kind: "metric",
      metric: {
        value: item.durationMs,
        unit: "ms",
        basis: "eval",
        samples: 1,
        total: 1,
        refs: [item.locator],
      },
    },
    costUSD: {
      kind: "metric",
      metric: {
        value: item.costUSD,
        unit: "$",
        basis: "eval",
        samples: item.costUSD === null ? 0 : 1,
        total: 1,
        refs: [item.locator],
      },
    },
  }));
}

async function overviewRender(sample: Sample) {
  const [summary, matrixRows] = await Promise.all([
    toSummaryItems(sample),
    aggregate(sample, { by: { eval: evalId, agent }, values: { passRate } }),
  ]);
  const matrix = matrixTableRows(matrixRows);
  const rate = summary.endToEndPassRate.value;
  return (
    <Col>
      <SampleNotices />
      <Section title={{ en: "Run overview", "zh-CN": "运行总览" }} meta="niceeval report E2E fixture">
        <Grid>
          <Stat label={{ en: "Experiments", "zh-CN": "实验数" }} value={summary.experiments} />
          <Stat label={{ en: "Evals", "zh-CN": "Eval 数" }} value={summary.evals} />
          <Stat label={{ en: "Attempts", "zh-CN": "Attempt 数" }} value={summary.attempts} />
          <Stat
            label={{ en: "Pass rate", "zh-CN": "通过率" }}
            value={formatMetricValue(rate, summary.endToEndPassRate.unit, summary.endToEndPassRate.format)}
            tone={rate === null ? "neutral" : rate >= 0.5 ? "positive" : "negative"}
          />
        </Grid>
        <Section title={{ en: "Eval × agent", "zh-CN": "Eval × Agent" }}>
          <Table rows={matrix.rows} columns={matrix.columns} className="niceeval-metric-matrix" />
        </Section>
      </Section>
    </Col>
  );
}

async function scoreboardRender(sample: Sample) {
  const [scoreRows, comparison] = await Promise.all([
    aggregate(sample, {
      by: { experiment, eval: evalId },
      values: { score: examScore },
    }),
    aggregate(sample, {
      by: { experiment },
      values: { passRate, costUSD, durationMs },
    }),
  ]);
  return (
    <Col>
      <SampleNotices />
      <Section title={{ en: "Exam", "zh-CN": "考试" }}>
        <Table
          rows={scoreboardTableRows(scoreRows)}
          columns={["entity", "total"]}
          className="niceeval-scoreboard-table"
        />
      </Section>
      <Section title={{ en: "Comparison", "zh-CN": "对比" }}>
        <Table
          rows={comparison as unknown as readonly Record<string, unknown>[]}
          columns={["experiment", "passRate", "costUSD", "durationMs"]}
          sort="passRate"
          searchable
          className="niceeval-metric-table"
        />
      </Section>
    </Col>
  );
}

async function attemptsRender(sample: Sample) {
  const items = await toAttemptListRows(sample);
  return (
    <Col>
      <SampleNotices />
      <Table
        rows={attemptListTableRows(items)}
        columns={["entity", "verdict", "result", "durationMs", "costUSD"]}
        searchable
      />
    </Col>
  );
}

async function reviewRender(attempt: AttemptEvidence) {
  const [summary, fixPrompt] = await Promise.all([toAttemptSummary(attempt), toAttemptFixPrompt(attempt)]);
  return (
    <Col>
      <AttemptSummary data={summary} />
      <AttemptAssessment attempt={attempt} />
      {fixPrompt !== null ? <CopyBlock content={fixPrompt} /> : null}
    </Col>
  );
}

export default defineReport({
  title: { en: "Results E2E · Custom site", "zh-CN": "Results E2E · 自定义站点" },
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      render: overviewRender,
    },
    {
      id: "scoreboard",
      title: { en: "Scoreboard", "zh-CN": "成绩单" },
      render: scoreboardRender,
    },
    {
      id: "attempts",
      title: { en: "Attempts", "zh-CN": "Attempt" },
      render: attemptsRender,
    },
    {
      id: "review",
      title: { en: "Attempt review", "zh-CN": "Attempt 复核" },
      input: "attempt",
      navigation: false,
      render: reviewRender,
    },
  ],
});
