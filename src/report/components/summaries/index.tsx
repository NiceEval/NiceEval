// 官方双面组件的装配点:web 面(./ScopeSummary.tsx 的纯 React 组件)+ text 面(./faces.ts)
// + resolve 解析面(spec 形态由管线代调配套 ./compute.ts)。ScopeSummary 与 ExperimentComparison
// 同属汇总族——前者是范围摘要卡,后者是内建报告默认使用的组合件(装配 ScopeSummary +
// MetricScatter + ExperimentList,不产生自己的 data)。

import { defineComponent, type ReportComponent } from "../../definition/tree.ts";
import { Col } from "../../definition/primitives.tsx";
import type { ReportInput, ScopeSummaryData, SeriesInput } from "../../model/types.ts";
import type { Scope, Snapshot } from "../../../results/types.ts";
import { resolveInput, seriesName } from "../../model/aggregate.ts";
import { label } from "../../model/flag.ts";
import { costUSD, endToEndPassRate, totalScore } from "../../model/metrics.ts";
import { scoringComposition } from "../../model/scoring.ts";
import {
  cellProblem,
  isObject,
  makeDataComponent,
  tallyProblem,
  type ChromeProps,
  type DataProps,
  type Validator,
} from "../shared.ts";
import { scopeSummaryData } from "./compute.ts";
import { scopeSummaryText } from "./faces.ts";
import { ScopeSummary as ScopeSummaryWeb } from "./ScopeSummary.tsx";
import { MetricScatter } from "../metric-views/index.tsx";
import { ExperimentList } from "../entity-lists/index.tsx";

export const validateScopeSummaryData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.range)) return 'missing "range" ({ earliestStartedAt, latestStartedAt })';
  if (!(data.range.earliestStartedAt === null || typeof data.range.earliestStartedAt === "string")) {
    return '"range.earliestStartedAt" must be a string or null';
  }
  if (!(data.range.latestStartedAt === null || typeof data.range.latestStartedAt === "string")) {
    return '"range.latestStartedAt" must be a string or null';
  }
  if (typeof data.experiments !== "number") return '"experiments" must be a number';
  if (typeof data.evals !== "number") return '"evals" must be a number';
  if (typeof data.attempts !== "number") return '"attempts" must be a number';
  const evalVerdictsProblem = tallyProblem(data.evalVerdicts, "evalVerdicts");
  if (evalVerdictsProblem !== null) return evalVerdictsProblem;
  const attemptVerdictsProblem = tallyProblem(data.attemptVerdicts, "attemptVerdicts");
  if (attemptVerdictsProblem !== null) return attemptVerdictsProblem;
  const passRateProblem = cellProblem(data.endToEndPassRate, "endToEndPassRate");
  if (passRateProblem !== null) return passRateProblem;
  return cellProblem(data.totalCostUSD, "totalCostUSD");
};

// ───────────────────────── 概览组件 ─────────────────────────

export type ScopeSummaryProps = DataProps<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & {
    /** 显示哪一级计票;默认 "eval"。data 恒携带两级,votes 只选择呈现。 */
    votes?: "eval" | "attempt";
  }
>;

/** 范围摘要卡:时间窗、数量、两级计票、端到端通过率与总成本。 */
export const ScopeSummary = makeDataComponent<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & { votes?: "eval" | "attempt" }
>({
  name: "ScopeSummary",
  dataFnName: "scopeSummaryData",
  shapeName: "ScopeSummaryData",
  dataFn: (input) => scopeSummaryData(input),
  specKeys: [],
  validate: validateScopeSummaryData,
  web: (props, ctx) => <ScopeSummaryWeb {...props} locale={props.locale ?? ctx.locale} />,
  text: (props, ctx) => scopeSummaryText(props.data, props.votes ?? "eval", ctx),
}) as unknown as ReportComponent<ScopeSummaryProps>;

type ComparisonChrome = ChromeProps & {
  /** 透传给散点;缺省跟随缺省 series 解析——按 line 归类时连线(声明了线就画线)。 */
  connect?: boolean;
};

export type ExperimentComparisonProps = ComparisonChrome & {
  input?: ReportInput;
  /** 散点的 series 维度。缺省解析:Scope 内任一实验声明了 label `line` → `label("line")` 并连线;否则 `"agent"`、不连线。 */
  series?: SeriesInput;
};

/** 默认报告识别的归类键:声明了它的实验按线归类并连线(docs/feature/experiments/library.md「labels」)。 */
const LINE_LABEL_KEY = "line";

/**
 * 缺省 series:Scope 内任一快照声明了 labels.line 用 line 维度,否则 agent;显式传入覆盖。
 * connect 缺省跟随最终 series 是否解析为 line(即便是显式传入的)。
 */
function resolveComparisonSeries(
  input: ReportInput,
  props: { series?: SeriesInput; connect?: boolean },
): { series: SeriesInput; connect: boolean } {
  const hasLine = resolveInput(input).snapshots.some((s) => s.experiment?.labels?.[LINE_LABEL_KEY] !== undefined);
  const series = props.series ?? (hasLine ? label(LINE_LABEL_KEY) : "agent");
  return { series, connect: props.connect ?? seriesName(series) === LINE_LABEL_KEY };
}

/**
 * 单个快照的题型:题型只在单个 experiment 内被强制统一,任一 attempt 就能代表整个快照;
 * 零 attempt 的快照(或没有一个是 "points" 的)记 "pass",与「省略即通过制」的定义期默认一致。
 */
function snapshotScoring(snapshot: Snapshot): "pass" | "points" {
  return snapshot.attempts.some((a) => a.result.scoring === "points") ? "points" : "pass";
}

/**
 * 按快照谓词筛 input,产出与原 input 同一"形状族"的 ReportInput:Scope 走它自己的
 * filter(snapshots/attempts/coverage/warnings 一并同步收窄),裸 Snapshot[] 走
 * Array.prototype.filter——两条分支的结果都可以原样喂给 MetricScatter / ExperimentList。
 */
function filterInputBySnapshot(input: ReportInput, predicate: (snapshot: Snapshot) => boolean): ReportInput {
  if (Array.isArray(input)) return (input as readonly Snapshot[]).filter(predicate);
  const scope = input as Scope;
  return scope.filter(predicate);
}

/**
 * 内建报告的默认组合件:把同一个 input(缺省 ctx.scope)原样透传给 ScopeSummary、
 * 成本 × 主读数的 MetricScatter 与 ExperimentList——组合本身不二次计算或过滤,
 * 也不导出自己的 data 形态;每个叶子组件按自己的公开契约取数,共享计算由 resolve 的
 * 「同引用 input + 深相等 spec」记忆化保证。主读数按 scoringComposition(input) 切换:
 * "pass" 用 endToEndPassRate、"points" 用 totalScore;"mixed" 按题型把 input 拆成两个
 * 子 Scope,散点与 ExperimentList 每组各一份、各用各的主读数,ScopeSummary 始终是整个
 * input 一份(docs/feature/reports/components/summaries.md「ExperimentComparison」)。
 */
export const ExperimentComparison = defineComponent<ExperimentComparisonProps>(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const { series, connect } = resolveComparisonSeries(input, props);
  const composition = await scoringComposition(input);

  if (composition !== "mixed") {
    const primary = composition === "points" ? totalScore : endToEndPassRate;
    return (
      <Col className={props.className}>
        <ScopeSummary input={input} locale={props.locale} />
        <MetricScatter
          input={input}
          points="experiment"
          series={series}
          connect={connect}
          x={costUSD}
          y={primary}
          locale={props.locale}
        />
        <ExperimentList input={input} filter locale={props.locale} />
      </Col>
    );
  }

  // mixed:按题型拆成两个子 Scope,散点 + ExperimentList 各一份、各用各的主读数;
  // series/connect 只从整个 input 解析一次,题型拆分与 series 归类正交,两组共用。
  const passInput = filterInputBySnapshot(input, (snapshot) => snapshotScoring(snapshot) === "pass");
  const pointsInput = filterInputBySnapshot(input, (snapshot) => snapshotScoring(snapshot) === "points");
  return (
    <Col className={props.className}>
      <ScopeSummary input={input} locale={props.locale} />
      <Col>
        <MetricScatter
          input={passInput}
          points="experiment"
          series={series}
          connect={connect}
          x={costUSD}
          y={endToEndPassRate}
          locale={props.locale}
        />
        <ExperimentList input={passInput} filter locale={props.locale} />
      </Col>
      <Col>
        <MetricScatter
          input={pointsInput}
          points="experiment"
          series={series}
          connect={connect}
          x={costUSD}
          y={totalScore}
          locale={props.locale}
        />
        <ExperimentList input={pointsInput} filter locale={props.locale} />
      </Col>
    </Col>
  );
});
ExperimentComparison.displayName = "ExperimentComparison";
