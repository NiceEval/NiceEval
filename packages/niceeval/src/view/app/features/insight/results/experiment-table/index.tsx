// Experiment / Eval / Attempt 层级表的 React presentation 入口。

import type { ReactNode } from "react";
import { TableContentView } from "../../components/TableContentView.tsx";
import {
  resolveLocalizedText,
  type LocalizedText,
  type ReportLocale,
} from "../../components/locale.ts";
import {
  sortExperimentListItems,
  type ExperimentListItem,
} from "./compute.ts";
import { experimentListContent } from "./content.ts";
import QualityCostScatter from "./quality-cost-scatter.tsx";

export interface ExperimentResultsData {
  readonly selectionTitle: LocalizedText;
  readonly experiments: readonly ExperimentListItem[];
}

/** Integrator-facing closed props. */
export interface ExperimentResultsProps {
  readonly data: ExperimentResultsData;
  readonly locale: ReportLocale;
}

/**
 * selection title 使用旧 Section 的 DOM/class；表本体保持旧 TableContentView 的
 * hierarchy、sort/filter 属性与原生 details/summary。
 */
export function ExperimentResults({
  data,
  locale,
}: ExperimentResultsProps): ReactNode {
  const items = sortExperimentListItems(data.experiments);
  return (
    <section className="niceeval-report niceeval-section">
      <h2 className="niceeval-section-title">
        {resolveLocalizedText(data.selectionTitle, locale)}
      </h2>
      <div className="niceeval-quality-cost-comparison">
        <QualityCostScatter items={items} kind="pass" locale={locale} />
        <QualityCostScatter items={items} kind="points" locale={locale} />
      </div>
      <TableContentView
        data={experimentListContent(items)}
        sort="summary"
        searchable
        locale={locale}
      />
    </section>
  );
}

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
} from "../../components/cell.tsx";
export {
  canonicalAttemptHref,
  MetricCellView,
  renderHierarchyRowsWeb,
  TableContentView,
} from "../../components/TableContentView.tsx";
export type {
  MetricCellViewProps,
  TableContentViewProps,
  TablePresentation,
  TableWebContext,
} from "../../components/TableContentView.tsx";
export type {
  LocalizedText,
  ReportLocale,
} from "../../components/locale.ts";
