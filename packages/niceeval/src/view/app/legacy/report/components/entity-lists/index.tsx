// 旧 Experiment / Eval / Attempt 层级表的 plain React 入口。
// 不读取 Sample、repository、SQL、router 或 authoring context；integrator 只需传入
// 已闭合的 old-shape ExperimentListItem[] 与 selection title。

import type { ReactNode } from "react";
import { TableContentView } from "../../definition/primitives.tsx";
import {
  resolveLocalizedText,
  type LocalizedText,
  type ReportLocale,
} from "../../model/locale.ts";
import {
  sortExperimentListItems,
  type ExperimentListItem,
} from "./compute.ts";
import { experimentListContent } from "./content.ts";

export interface ExperimentOverviewData {
  readonly selectionTitle: LocalizedText;
  readonly experiments: readonly ExperimentListItem[];
}

/** Integrator-facing closed props. */
export interface ExperimentOverviewProps {
  readonly data: ExperimentOverviewData;
  readonly locale: ReportLocale;
  /** 显示排序列；旧 ExperimentTable 默认 summary。 */
  readonly sort?: string;
  readonly searchable?: boolean;
  /** 保留旧 ExperimentTable 的 table className 传递位置。 */
  readonly className?: string;
}

/**
 * selection title 使用旧 Section 的 DOM/class；表本体保持旧 TableContentView 的
 * hierarchy、sort/filter 属性与原生 details/summary。
 */
export function ExperimentOverview({
  data,
  locale,
  sort = "summary",
  searchable = true,
  className,
}: ExperimentOverviewProps): ReactNode {
  const items = sortExperimentListItems(data.experiments);
  return (
    <section className="niceeval-report niceeval-section">
      <h2 className="niceeval-section-title">
        {resolveLocalizedText(data.selectionTitle, locale)}
      </h2>
      <TableContentView
        data={experimentListContent(items)}
        sort={sort}
        searchable={searchable}
        locale={locale}
        className={className}
      />
    </section>
  );
}

ExperimentOverview.displayName = "ExperimentOverview";

export {
  experimentEvalLayout,
  experimentListEvaluationKindComposition,
  relativeEvalLabel,
  sortExperimentListItems,
} from "./compute.ts";
export type {
  AttemptListItem,
  EvalLayoutNode,
  EvaluationKindComposition,
  ExperimentListEvalRow,
  ExperimentListItem,
  ExperimentMetrics,
} from "./compute.ts";
export {
  attemptCells,
  attemptListContent,
  evalRow,
  experimentListContent,
  experimentRow,
  groupRow,
  measureCell,
} from "./content.ts";
export type {
  Cell,
  ColumnSpec,
  MetricBasis,
  MetricState,
  MetricValue,
  TableContent,
  TableContentRow,
  Verdict,
} from "../../definition/cell.tsx";
export {
  canonicalAttemptHref,
  MetricCellView,
  renderHierarchyRowsWeb,
  TableContentView,
} from "../../definition/primitives.tsx";
export type {
  MetricCellViewProps,
  TableContentViewProps,
  TablePresentation,
  TableWebContext,
} from "../../definition/primitives.tsx";
export type {
  LocalizedText,
  ReportLocale,
} from "../../model/locale.ts";
