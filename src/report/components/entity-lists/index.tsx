// 实体列表组合件:FailureList / AttemptList / ExperimentTable。
// 列表本体是中立 Table 原语(TableContentView);语义全部住在 compute.ts 与
// content.ts 的投影层,docs/feature/reports/library.md。

import type { Sample } from "../../../analysis/index.ts";
import { defineComponent } from "../../definition/tree.ts";
import { TableContentView } from "../../definition/primitives.tsx";
import type { ReportLocale } from "../../model/locale.ts";
import {
  attemptListData,
  experimentListData,
  type AttemptListItem,
  type ExperimentListItem,
} from "./compute.ts";
import { attemptListContent, experimentListContent } from "./content.ts";

export {
  attemptListData,
  experimentListData,
  experimentEvalLayout,
  relativeEvalLabel,
} from "./compute.ts";
export type {
  AttemptListItem,
  EvalLayoutNode,
  EvaluationKindComposition,
  ExperimentListEvalRow,
  ExperimentListItem,
  ExperimentMetrics,
} from "./compute.ts";
export { attemptListContent, experimentListContent } from "./content.ts";

export interface FailureListProps {
  readonly limit?: number;
  /** 显式 Sample;省略时用当前组合上下文的 `ctx.scope`。 */
  readonly input?: Sample;
  /** 已闭合的行;省略时按 `input` 计算。 */
  readonly rows?: readonly AttemptListItem[];
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/** 失败处理台:只列 failed / errored attempt,按 startedAt 新到旧、locator 升序收口。 */
export const FailureList = defineComponent<FailureListProps>(async (props, ctx) => {
  const sample = props.input ?? ctx.scope;
  const all = props.rows ?? await attemptListData(sample, ctx.report.pricing);
  const failures = all
    .filter((item) => item.verdict === "failed" || item.verdict === "errored")
    .sort((left, right) => {
      const leftStarted = left.startedAt ?? Number.NEGATIVE_INFINITY;
      const rightStarted = right.startedAt ?? Number.NEGATIVE_INFINITY;
      if (leftStarted !== rightStarted) return leftStarted > rightStarted ? -1 : 1;
      return left.locator < right.locator ? -1 : left.locator > right.locator ? 1 : 0;
    });
  const limit = props.limit ?? 20;
  return <TableContentView
    data={attemptListContent(failures.slice(0, limit))}
    locale={props.locale}
    className={props.className}
  />;
});
FailureList.displayName = "FailureList";

export interface AttemptListProps {
  /** 显式 Sample;省略时用当前组合上下文的 `ctx.scope`。 */
  readonly input?: Sample;
  /** 已闭合的行;省略时按 `input` 计算。 */
  readonly rows?: readonly AttemptListItem[];
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/** 薄组合:attemptListData + Table。顺序保持传入顺序(不重排)。 */
export const AttemptList = defineComponent<AttemptListProps>(async (props, ctx) => {
  const rows = props.rows ?? await attemptListData(props.input ?? ctx.scope, ctx.report.pricing);
  return <TableContentView
    data={attemptListContent(rows)}
    locale={props.locale}
    className={props.className}
  />;
});
AttemptList.displayName = "AttemptList";

export interface ExperimentTableProps {
  /** 显式 Sample;省略时用当前组合上下文的 `ctx.scope`。 */
  readonly input?: Sample;
  /** 已闭合的行;省略时按 `input` 计算。 */
  readonly rows?: readonly ExperimentListItem[];
  /** 显示排序列;省略时按列表自身主读数(当前 facade 恒为 passRate)降序。 */
  readonly sort?: string;
  readonly searchable?: boolean;
  readonly locale?: ReportLocale;
  readonly className?: string;
}

export const ExperimentTable = defineComponent<ExperimentTableProps>(async (props, ctx) => {
  const sample = props.input ?? ctx.scope;
  const rows = props.rows ?? await experimentListData(sample, ctx.report.pricing);
  // 当前 facade 只发布通过制读数,默认排序恒为 passRate 降序(数据本身已按此排好)。
  const defaultSort = "passRate";
  return <TableContentView
    data={experimentListContent(rows)}
    sort={props.sort ?? defaultSort}
    searchable={props.searchable ?? true}
    locale={props.locale}
    className={props.className}
  />;
});
ExperimentTable.displayName = "ExperimentTable";
