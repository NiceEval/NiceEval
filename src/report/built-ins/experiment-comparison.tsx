// ExperimentComparison:裸 niceeval show / view 首页渲染的内置默认报告,同时是可整体引用的
// 官方组合件(docs/feature/reports/library.md「ExperimentComparison」)。
//
// 名字描述整份报告回答的问题,不绑定其中某一张图。它是组合件而非新的数据源——两个子块
// (成本 × 成功率散点、固定列 ExperimentList)消费与单独使用时完全相同的 .data() 计算结果。
// 两种用法共享同一份口径:
//   · 默认报告:宿主把它当普通 ReportDefinition(build 面),没有 renderer 私有通道;
//   · 报告组件:`<ExperimentComparison data={await ExperimentComparison.data(selection)} />`,
//     在自定义报告或用户自己的 React 页面里整体引用。

import { Col } from "../primitives.tsx";
import { ExperimentList, MetricScatter } from "../components.tsx";
import { costUSD, taskPassRate } from "../metrics.ts";
import { defineReport, type ReportDefinition } from "../report.ts";
import { defineComponent, type ReportComponent } from "../tree.ts";
import type { ReportLocale } from "../locale.ts";
import type { ExperimentListItem, ScatterData } from "../types.ts";
import type { ScatterDataOptions } from "../compute.ts";
import type { SnapshotsInput } from "../aggregate.ts";

// 散点的唯一口径:build(selection 形态)与 .data()(预计算形态)共用,不各写一份。
const SCATTER_OPTIONS: ScatterDataOptions = {
  points: "experiment",
  series: "agent",
  x: costUSD,
  y: taskPassRate,
};

/**
 * `ExperimentComparison.data(selection)` 的产物:两个子块各自的 `.data()` 计算结果,
 * 与单独使用 `MetricScatter.data` / `ExperimentList.data` 时完全相同。
 */
export interface ExperimentComparisonData {
  /** 成本 × 成功率散点(`MetricScatter.data` 的口径:points=experiment、series=agent)。 */
  scatter: ScatterData;
  /** 固定列 experiment 比较表(`ExperimentList.data` 的口径,已按成功率排序)。 */
  experiments: ExperimentListItem[];
}

/** 组合件的数据计算:两个子块的 `.data()` 并行算好,可序列化、可跨边界传递。 */
async function experimentComparisonData(input: SnapshotsInput): Promise<ExperimentComparisonData> {
  const [scatter, experiments] = await Promise.all([
    MetricScatter.data(input, SCATTER_OPTIONS),
    ExperimentList.data(input),
  ]);
  return { scatter, experiments };
}

export interface ExperimentComparisonProps {
  data: ExperimentComparisonData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/** 两个渲染面共用的组合:数据形态的散点 + 实验列表,与 build 面的树同构。 */
function composition(data: ExperimentComparisonData, locale?: ReportLocale, className?: string) {
  return (
    <Col className={className}>
      <MetricScatter data={data.scatter} locale={locale} />
      <ExperimentList items={data.experiments} filter locale={locale} />
    </Col>
  );
}

/**
 * 内置默认报告兼官方组合件:作为组件时收 `data`(`.data()` 的产物),两个渲染面直接摆
 * 数据形态的子组件;作为默认报告时经 build 面走与用户 `--report` 完全相同的管线。
 */
export const ExperimentComparison: ReportComponent<ExperimentComparisonProps> &
  ReportDefinition & { data: typeof experimentComparisonData } = Object.assign(
  defineComponent<ExperimentComparisonProps>({
    web: (props, ctx) => composition(props.data, props.locale ?? ctx.locale, props.className),
    text: ({ data, className }, ctx) => ctx.render(composition(data, undefined, className)),
  }),
  defineReport(async ({ selection }) => {
    const experiments = await ExperimentList.data(selection);
    return (
      <Col>
        <MetricScatter selection={selection} {...SCATTER_OPTIONS} />
        <ExperimentList items={experiments} filter />
      </Col>
    );
  }),
  { data: experimentComparisonData },
);
ExperimentComparison.displayName = "ExperimentComparison";
