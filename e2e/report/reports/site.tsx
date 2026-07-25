// 代表性自定义报告 2/2 —— 自定义多页 + 自定义组件与 attempt page(docs/engineering/testing/e2e/
// report.md §5「自定义报告的用户操作回归」)。三张可导航页 + 一张不进导航的自定义 attempt-input
// page,pages 是字面量(shell.md「content / pages / extends 恰好声明一个」),不 extends 任何内建
// 报告 —— 用来证明"用户改一份报告文件就能踩到的路径"不依赖内建组件组合。
//
// 顺手覆盖 verify-render-structure.ts 头注 COVERAGE GAP #2/#3:内建 standard 报告从没用到
// Section 嵌套边框、Grid 列数规划、MetricTable / MetricMatrix / Scoreboard —— overview 页用嵌套
// Section 包 Grid/Stat(自定义组合组件读 scopeSummaryData 现算,不是硬编码文案)与 MetricMatrix,
// scoreboard 页用 Scoreboard 与带过滤框的 MetricTable。
import {
  AttemptAssessment,
  AttemptDiagnostics,
  AttemptFixPrompt,
  AttemptList,
  AttemptSummary,
  Col,
  Grid,
  MetricMatrix,
  MetricTable,
  ScopeWarnings,
  Scoreboard,
  Section,
  Stat,
  costUSD,
  defineComponent,
  defineReport,
  durationMs,
  endToEndPassRate,
  scopeSummaryData,
} from "niceeval/report";

/**
 * 组合组件:现算的运行总览 Grid —— 不是把 Stat 值写死成字面量,而是每次 resolve 时读
 * `scopeSummaryData(ctx.scope)`,和「本文件消费真实证据」这条约定一致。
 */
const RunOverviewGrid = defineComponent(async (_props: Record<string, never>, ctx) => {
  const summary = await scopeSummaryData(ctx.scope);
  const passRate = summary.endToEndPassRate.value;
  return (
    <Grid columns={4} variant="boxed">
      <Stat label={{ en: "Experiments", "zh-CN": "实验数" }} value={summary.experiments} />
      <Stat label={{ en: "Evals", "zh-CN": "Eval 数" }} value={summary.evals} />
      <Stat label={{ en: "Attempts", "zh-CN": "Attempt 数" }} value={summary.attempts} />
      <Stat
        label={{ en: "Pass rate", "zh-CN": "通过率" }}
        value={summary.endToEndPassRate.display}
        tone={passRate === null ? "neutral" : passRate >= 0.5 ? "positive" : "negative"}
      />
    </Grid>
  );
});

/**
 * 自定义 attempt-input page 的内容组件 —— 参照 src/report/built-in/standard.tsx 的
 * standardAttemptPage 写法(组合已有区块表达内建排列顺序),但不照抄它的全量区块:只保留身份、
 * 断言/源码评估、修复 prompt 与 diagnostics 四块,不带 timeline/usage/conversation/trace/diff——
 * 一张更轻量的"复核卡片",证明作者能重排 docs/feature/reports/components/attempt-detail/attempt-detail.md
 * 列出的公开叶子组件,不依赖 AttemptDetail 成品。
 */
const AttemptReviewCard = defineComponent((_props: Record<string, never>, ctx) => {
  if (ctx.page.input !== "attempt") {
    throw new Error("AttemptReviewCard requires an attempt-input page.");
  }
  return (
    <Col>
      <AttemptSummary />
      <AttemptAssessment />
      <AttemptFixPrompt />
      <AttemptDiagnostics />
    </Col>
  );
});

export default defineReport({
  title: { en: "Results E2E · Custom site", "zh-CN": "Results E2E · 自定义站点" },
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      content: (
        <Col>
          <ScopeWarnings />
          <Section title={{ en: "Run overview", "zh-CN": "运行总览" }} meta="niceeval report E2E fixture">
            <RunOverviewGrid />
            {/* 嵌套 Section:text 面降级成横隔条(library/layout.md「嵌套只画最外层」),
                web 面仍是独立 <section>——这条嵌套在内建 standard 报告里从未出现过。 */}
            <Section title={{ en: "Eval × agent", "zh-CN": "Eval × Agent" }}>
              <MetricMatrix rows="eval" columns="agent" cell={endToEndPassRate} />
            </Section>
          </Section>
        </Col>
      ),
    },
    {
      id: "scoreboard",
      title: { en: "Scoreboard", "zh-CN": "成绩单" },
      content: (
        <Col>
          <ScopeWarnings />
          <Section title={{ en: "Exam", "zh-CN": "考试" }}>
            <Scoreboard rows="experiment" questions={["tool-call", "deliberate-fail", "deliberate-error"]} fullMarks={100} />
          </Section>
          <Section title={{ en: "Comparison", "zh-CN": "对比" }}>
            <MetricTable rows="experiment" columns={[endToEndPassRate, costUSD, durationMs]} sort={endToEndPassRate} filter />
          </Section>
        </Col>
      ),
    },
    {
      id: "attempts",
      title: { en: "Attempts", "zh-CN": "Attempt" },
      content: (
        <Col>
          <ScopeWarnings />
          <AttemptList filter />
        </Col>
      ),
    },
    {
      id: "review",
      title: { en: "Attempt review", "zh-CN": "Attempt 复核" },
      input: "attempt",
      navigation: false,
      content: <AttemptReviewCard />,
    },
  ],
});
