// 实体列表组合件:FailureList / AttemptList；列表本体是 Table 原语。

import { defineComponent } from "../../definition/tree.ts";
import { TableContentView } from "../../definition/primitives.tsx";
import type { TableContent } from "../../definition/cell.ts";
import type { ReportInput } from "../../model/types.ts";
import type { AttemptHandle, Sample } from "../../../record/types.ts";
import { collectItems, locatorOf, resolveInput } from "../../model/aggregate.ts";
import { localeText, type ReportLocale } from "../../model/locale.ts";
import { attemptListData, attemptRowsOf, hasHistoricalOrStale } from "./compute.ts";
import { attemptListContent, experimentListContent } from "./content.ts";
import { toAttemptRows, toExperimentRows } from "../../model/conversions.ts";

export { validateAttemptListData, validateEvalListData, validateExperimentListData } from "./validate.ts";

export interface FailureListProps {
  limit?: number;
  input?: ReportInput;
  locale?: ReportLocale;
  className?: string;
}

export const FailureList = defineComponent<FailureListProps>(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const all = await attemptListData(input);
  const startedAtByLocator = new Map<string, string>();
  const { runs, attempts } = resolveInput(input);
  for (const item of collectItems(runs, attempts)) {
    startedAtByLocator.set(locatorOf(item), item.attempt.result.startedAt ?? "");
  }
  const failures = all
    .filter((item) => item.verdict === "failed" || item.verdict === "errored")
    .sort((a, b) => {
      const ta = startedAtByLocator.get(a.locator) ?? "";
      const tb = startedAtByLocator.get(b.locator) ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0;
    });
  const limit = props.limit ?? 20;
  const content = attemptListContent(failures.slice(0, limit));
  return <TableContentView data={content} locale={props.locale} className={props.className} />;
});
FailureList.displayName = "FailureList";

export interface AttemptListProps {
  attempts: readonly AttemptHandle[];
  locale?: ReportLocale;
  className?: string;
}

/** 薄组合：toAttemptRows + Table。 */
export const AttemptList = defineComponent<AttemptListProps>(async (props) => {
  const rows = await toAttemptRows(props.attempts);
  return <TableContentView data={attemptListContent(rows)} locale={props.locale} className={props.className} />;
});
AttemptList.displayName = "AttemptList";

export interface ExperimentTableProps {
  input?: Sample;
  sort?: string;
  searchable?: boolean;
  locale?: ReportLocale;
  className?: string;
}

interface ExperimentTableViewProps {
  fullContent: TableContent;
  /** 只在 Sample 里确有历史执行或过期结论时才非 null——开关是否出现由这个字段的存在与否决定。 */
  freshContent: TableContent | null;
  sort?: string;
  searchable?: boolean;
  locale?: ReportLocale;
  className?: string;
}

/**
 * `ExperimentTable` 的渲染叶子:web 面在有 `freshContent` 时叠一层「只看新执行」开关——
 * 两份 Content 都已经由 `ExperimentTable` 按 fresh 与非 fresh 两态重新投影好,`Table` 原语
 * 本身不知道这个开关存在(本体里没有任何时效分支,语义全部住在投影层)。切换纯靠原生
 * checkbox 状态经 CSS `:has()` 驱动的可见性完成(styles.css `.niceeval-fresh-toggle`),
 * 不重新请求或重新计算任何数据,也不需要 JavaScript——初始态(未勾选)展示 `fullContent`
 * 这份完整表。text 面没有这个开关的等价物,`--fresh` CLI 选项就是它的入口,这里只渲染
 * `fullContent`。
 */
export const ExperimentTableView = defineComponent<ExperimentTableViewProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const table = (
      <TableContentView
        data={props.fullContent}
        sort={props.sort}
        searchable={props.searchable}
        locale={props.locale}
        className={props.className}
      />
    );
    if (!props.freshContent) return table;
    const locale = props.locale ?? ctx.locale;
    return (
      <div className="niceeval-report niceeval-experiment-table">
        <label className="niceeval-fresh-toggle">
          <input type="checkbox" />
          {localeText(locale, "experimentTable.freshOnlyToggle")}
        </label>
        <div className="niceeval-fresh-all">{table}</div>
        <div className="niceeval-fresh-only">
          <TableContentView
            data={props.freshContent}
            sort={props.sort}
            searchable={props.searchable}
            locale={props.locale}
            className={props.className}
          />
        </div>
      </div>
    );
  },
  text(props, ctx) {
    return ctx.render(
      <TableContentView
        data={props.fullContent}
        sort={props.sort}
        searchable={props.searchable}
        locale={props.locale}
        className={props.className}
      />,
    );
  },
});
ExperimentTableView.displayName = "ExperimentTableView";

export const ExperimentTable = defineComponent<ExperimentTableProps>(async (props, ctx) => {
  const sample = props.input ?? ctx.scope;
  const full = await toExperimentRows(sample);
  const fullContent = experimentListContent(full);
  const hasPassRate = fullContent.columns.some((column) => column.key === "passRate");
  const hasTotalScore = fullContent.columns.some((column) => column.key === "totalScore");
  const defaultSort = hasPassRate === hasTotalScore ? undefined : hasPassRate ? "passRate" : "totalScore";
  const freshContent = hasHistoricalOrStale(full)
    ? experimentListContent(await toExperimentRows(sample.freshOnly()))
    : null;
  // 没有历史执行也没有过期结论时直接产出 `<TableContentView>`,与开关引入前的树形状逐字相同——
  // 只有真的需要开关那一态,才多绕一层 `ExperimentTableView`。
  if (freshContent === null) {
    return (
      <TableContentView
        data={fullContent}
        sort={props.sort ?? defaultSort}
        searchable={props.searchable ?? true}
        locale={props.locale}
        className={props.className}
      />
    );
  }
  return (
    <ExperimentTableView
      fullContent={fullContent}
      freshContent={freshContent}
      sort={props.sort ?? defaultSort}
      searchable={props.searchable ?? true}
      locale={props.locale}
      className={props.className}
    />
  );
});
ExperimentTable.displayName = "ExperimentTable";

// re-export for callers that still import attemptRowsOf locally
export { attemptRowsOf };
