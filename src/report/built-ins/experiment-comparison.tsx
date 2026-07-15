// ExperimentComparison:裸 niceeval show / view 首页渲染的内置默认报告,同时是可整体引用的
// 官方组合件(docs/feature/reports/library.md「ExperimentComparison」)。
//
// 名字描述整份报告回答的问题,不绑定其中某一张图。它是组合件而非新的数据源——每组的
// GroupSummary、成本 × 端到端成功率散点、固定列 ExperimentList 都消费各自公开 .data() 的结果。
// 两种用法共享同一份口径:
//   · 默认报告:宿主把它当普通 ReportDefinition(build 面),没有 renderer 私有通道;
//   · 报告组件:`<ExperimentComparison data={await ExperimentComparison.data(selection)} />`,
//     在自定义报告或用户自己的 React 页面里整体引用。

import { Col, Section, Table } from "../primitives.tsx";
import { ExperimentList, GroupSummary, MetricScatter } from "../components.tsx";
import { costUSD, endToEndPassRate } from "../metrics.ts";
import { defineReport, type ReportDefinition } from "../report.ts";
import { defineComponent, type ReportComponent, type TextContext } from "../tree.ts";
import { localeText, type ReportLocale } from "../locale.ts";
import type { ExperimentListItem, GroupSummaryData, ScatterData } from "../types.ts";
import type { ScatterDataOptions } from "../compute.ts";
import { resolveInput, type SnapshotsInput } from "../aggregate.ts";
import { ExperimentComparisonView } from "../react/ExperimentComparison.tsx";
import { wrapDisplay } from "../text/layout.ts";
import { formatUSD } from "../format.ts";

// 每组散点的唯一口径：默认 definition 与公开 `.data()` 共用，不各写一份。
const SCATTER_OPTIONS: ScatterDataOptions = {
  points: "experiment",
  series: "agent",
  x: costUSD,
  y: endToEndPassRate,
};

/**
 * 一个可比组的数据。三个子块都只消费本组快照，不能含其它父目录的引用。
 */
export interface ExperimentComparisonGroupData {
  /** experiment id 的完整父路径；根目录 experiment 使用自己的完整 id。 */
  key: string;
  summary: GroupSummaryData;
  /** 成本 × 端到端成功率散点(`MetricScatter.data` 的口径:points=experiment、series=agent)。 */
  scatter: ScatterData;
  /** 固定列 experiment 比较表(`ExperimentList.data` 的口径,已按端到端成功率排序)。 */
  experiments: ExperimentListItem[];
}

/** `ExperimentComparison.data(selection)` 的穷尽产物：按 key 排序的独立可比组。 */
export interface ExperimentComparisonData {
  groups: ExperimentComparisonGroupData[];
}

/** 完整父路径是组键；没有父路径的 experiment 不能互相比，自己形成单例组。 */
export function experimentComparisonGroupKey(experimentId: string): string {
  const slash = experimentId.lastIndexOf("/");
  return slash === -1 ? experimentId : experimentId.slice(0, slash);
}

/** 组合件的数据计算：先分区，再让三个官方子块在各组内并行计算。 */
async function experimentComparisonData(input: SnapshotsInput): Promise<ExperimentComparisonData> {
  const { snapshots } = resolveInput(input);
  const snapshotsByGroup = new Map<string, typeof snapshots>();
  for (const snapshot of snapshots) {
    const key = experimentComparisonGroupKey(snapshot.experimentId);
    const group = snapshotsByGroup.get(key);
    if (group) group.push(snapshot);
    else snapshotsByGroup.set(key, [snapshot]);
  }

  const groups = await Promise.all(
    [...snapshotsByGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([key, groupSnapshots]): Promise<ExperimentComparisonGroupData> => {
        const [summary, scatter, experiments] = await Promise.all([
          GroupSummary.data(groupSnapshots),
          MetricScatter.data(groupSnapshots, SCATTER_OPTIONS),
          ExperimentList.data(groupSnapshots),
        ]);
        return { key, summary, scatter, experiments };
      }),
  );
  return { groups };
}

export interface ExperimentComparisonProps {
  data: ExperimentComparisonData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/** 单组详情：散点与实验列表全部来自同一个预分区结果。 */
function groupComposition(group: ExperimentComparisonGroupData, locale?: ReportLocale, className?: string) {
  return (
    <Col className={className}>
      <MetricScatter data={group.scatter} locale={locale} />
      <ExperimentList items={group.experiments} filter locale={locale} relativeTo={group.key} />
    </Col>
  );
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function verdictsText(group: ExperimentComparisonGroupData, locale: ReportLocale): string {
  const parts: string[] = [];
  for (const verdict of ["passed", "failed", "errored", "skipped"] as const) {
    const count = group.summary.verdicts[verdict];
    if (count > 0) parts.push(`${count} ${localeText(locale, `verdict.${verdict}`)}`);
  }
  return parts.length > 0 ? parts.join(" / ") : "—";
}

function textFace(data: ExperimentComparisonData, className: string | undefined, ctx: TextContext): string {
  if (data.groups.length === 0) return localeText(ctx.locale, "experimentComparison.empty");
  if (data.groups.length === 1) {
    const group = data.groups[0]!;
    return ctx.render(
      <Section title={group.key} className={className}>
        {groupComposition(group)}
      </Section>,
    );
  }

  const table = ctx.render(
    <Table
      columns={[
        { key: "group", header: localeText(ctx.locale, "experimentComparison.group") },
        { key: "experiments", header: localeText(ctx.locale, "groupSummary.experiments"), align: "right" },
        { key: "evals", header: localeText(ctx.locale, "overview.evals"), align: "right" },
        { key: "passRate", header: localeText(ctx.locale, "overview.passRate"), align: "right" },
        { key: "results", header: localeText(ctx.locale, "experimentComparison.results") },
        { key: "cost", header: localeText(ctx.locale, "overview.totalCost"), align: "right" },
        { key: "lastRun", header: localeText(ctx.locale, "experimentComparison.lastRun") },
      ]}
      rows={data.groups.map((group) => ({
        key: group.key,
        cells: {
          group: group.key,
          experiments: String(group.summary.experiments),
          evals: String(group.summary.evals),
          passRate: group.summary.passRate.display,
          results: verdictsText(group, ctx.locale),
          cost: group.summary.totalCostUSD === null ? null : formatUSD(group.summary.totalCostUSD),
          lastRun: group.summary.lastRunAt ?? null,
        },
      }))}
    />,
  );
  const commands = data.groups
    .map((group) => {
      const command = `niceeval show --experiment ${shellQuote(group.key)}`;
      return wrapDisplay(localeText(ctx.locale, "experimentComparison.command", { command }), ctx.width).join("\n");
    })
    .join("\n");
  return `${localeText(ctx.locale, "experimentComparison.groups")}\n\n${table}\n\n${commands}`;
}

/**
 * 内置默认报告兼官方组合件:作为组件时收 `data`(`.data()` 的产物),两个渲染面直接摆
 * 数据形态的子组件;作为默认报告时经 build 面走与用户 `--report` 完全相同的管线。
 */
export const ExperimentComparison: ReportComponent<ExperimentComparisonProps> &
  ReportDefinition & { data: typeof experimentComparisonData } = Object.assign(
  defineComponent<ExperimentComparisonProps>({
    web: (props, ctx) => (
      <ExperimentComparisonView
        data={props.data}
        locale={props.locale ?? ctx.locale}
        className={props.className}
      />
    ),
    text: ({ data, className }, ctx) => textFace(data, className, ctx),
  }),
  defineReport(async ({ selection }) => {
    const data = await experimentComparisonData(selection);
    return <ExperimentComparison data={data} />;
  }),
  { data: experimentComparisonData },
);
ExperimentComparison.displayName = "ExperimentComparison";
