// 旧表实际需要的 plain React DOM 原语。
// 固定源中的 Row / Col / Grid / Section / Stat / Text / Markdown / Style / Tabs / Tab、
// text renderer、defineComponent、ReportNode/WebContext、theme/download/static export 均不在
// 这份闭包里；TableContentView 只把闭合 TableContent 渲染成 React 19 DOM。

import { useMemo, useState, type ReactNode } from "react";
import {
  costProjectionOf,
  formatCellText,
  type AttemptLocator,
  type Cell,
  type TableContent,
  type TableContentRow,
} from "./cell.tsx";
import {
  formatMetricScalar,
  metricStateText,
  missingText,
  verdictMark,
} from "./format.ts";
import {
  countText,
  DEFAULT_REPORT_LOCALE,
  localeText,
  resolveLocalizedText,
  type LocalizedText,
  type ReportLocale,
} from "./locale.ts";

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** `null`/缺数据的统一显示符:Table 与 Cell 共用,不补成 0。 */
const MISSING_MARK = "—";

/** 一列的定义:取哪个 cells 键、表头写什么、往哪边对齐。 */
export interface TableColumn {
  readonly key: string;
  readonly header: LocalizedText;
  readonly align?: "left" | "right";
  readonly better?: "higher" | "lower";
}

export interface TablePresentation {
  readonly sort?: string;
  readonly searchable?: boolean;
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/** 旧表的唯一普通 React props；不接受 Dataset、Sample 或 authoring context。 */
export type TableContentViewProps = {
  readonly data: TableContent;
  /** 省略时使用当前 Insight 的固定 hash route。 */
  readonly hrefForLocator?: (locator: AttemptLocator) => string | undefined;
} & TablePresentation;

export interface TableWebContext {
  readonly href: (locator: AttemptLocator) => string | undefined;
  readonly locale: ReportLocale;
  readonly showMeasureRefs?: boolean;
}

/** 当前 Insight 的 canonical Attempt route；不读取 router。 */
export function canonicalAttemptHref(locator: AttemptLocator): string {
  return `#/attempt/${locator.startsWith("@") ? locator.slice(1) : locator}`;
}

function tableContentOf(data: TableContent): {
  readonly columns: readonly [TableColumn, ...TableColumn[]];
  readonly content: TableContent;
} {
  const columns: TableColumn[] = data.columns.map((spec) => ({
    key: spec.key,
    header: spec.header ?? spec.key,
    align: spec.better ? "right" : "left",
    better: spec.better,
  }));
  return validatedTable(columns, data);
}

function validatedTable(
  columns: TableColumn[],
  content: TableContent,
): { readonly columns: readonly [TableColumn, ...TableColumn[]]; readonly content: TableContent } {
  if (columns.length === 0) {
    throw new Error("Table needs at least one column.");
  }
  const keys = new Set<string>();
  for (const column of columns) {
    if (keys.has(column.key)) {
      throw new Error(`Table column key "${column.key}" is declared twice.`);
    }
    keys.add(column.key);
  }
  validateSiblingRowKeys(content.rows);
  validateRowShapes(content.rows, keys);
  return {
    columns: columns as [TableColumn, ...TableColumn[]],
    content,
  };
}

/**
 * 行形状与列集同源:每一行(含 group / placeholder 与各层子行)的 cells key 集合
 * 等于列集。不适用的列显式填 notApplicable,不靠缺格回落成 `—`。
 */
function validateRowShapes(rows: readonly TableContentRow[], columnKeys: ReadonlySet<string>): void {
  for (const row of rows) {
    for (const cellKey of Object.keys(row.cells)) {
      if (!columnKeys.has(cellKey)) {
        throw new Error(
          `Table row "${row.key}" has a cell for "${cellKey}", which is not a declared column.`,
        );
      }
    }
    for (const columnKey of columnKeys) {
      if (!(columnKey in row.cells)) {
        throw new Error(
          `Table row "${row.key}" has no cell for column "${columnKey}".`,
        );
      }
    }
    if (row.subRows?.length) validateRowShapes(row.subRows, columnKeys);
  }
}

function validateSiblingRowKeys(rows: readonly TableContentRow[]): void {
  const keys = new Set<string>();
  for (const row of rows) {
    if (keys.has(row.key)) {
      throw new Error(`Table row key "${row.key}" is declared twice at the same level.`);
    }
    keys.add(row.key);
    if (row.subRows?.length) validateSiblingRowKeys(row.subRows);
  }
}

/** closed refs 里能变成下钻目标的 attempt locator。 */
function refLocatorsOf(cell: Extract<Cell, { readonly kind: "metric" }>["metric"]): AttemptLocator[] {
  return cell.refs.flatMap((ref) =>
    ref.identity.kind === "attempt" ? [ref.identity.locator] : []
  );
}

export interface MetricCellViewProps {
  readonly cell: Extract<Cell, { readonly kind: "metric" }>["metric"];
  readonly href?: (locator: AttemptLocator) => string | undefined;
  readonly locale?: ReportLocale;
  readonly showCoverage?: boolean;
  readonly coverageDetail?: boolean;
}

export function MetricCellView({
  cell,
  href,
  locale,
  showCoverage = true,
  coverageDetail = false,
}: MetricCellViewProps): ReactNode {
  const loc = locale ?? DEFAULT_REPORT_LOCALE;
  const projection = costProjectionOf(cell);
  if (projection !== undefined) {
    const costText = projection.combined === null
      ? metricStateText(cell.state, loc)
      : `$${projection.combined.amount}`;
    return (
      <span className="niceeval-cell">
        <span className="niceeval-value">{costText}</span>
      </span>
    );
  }
  const text = cell.value === null
    ? metricStateText(cell.state, loc)
    : formatMetricScalar(cell.value, cell.unit, cell.format, loc);
  if (cell.value === null) {
    return (
      <span className="niceeval-cell niceeval-cell-missing">
        <span
          className="niceeval-missing"
          title={localeText(loc, "cell.noneMeasurableTitle", { total: cell.total })}
        >
          {text}
        </span>
      </span>
    );
  }
  const refLocators = refLocatorsOf(cell);
  const hasPartialCoverage = showCoverage && cell.samples < cell.total;
  return (
    <span className={cx("niceeval-cell", hasPartialCoverage && coverageDetail && "niceeval-cell-text")}>
      <span
        className="niceeval-value"
        title={localeText(loc, "cell.measuredTitle", { samples: cell.samples, total: cell.total })}
      >
        {text}
      </span>
      {hasPartialCoverage && (coverageDetail ? (
        <small
          className="niceeval-cell-detail"
          title={localeText(loc, "cell.coverageTitle", { samples: cell.samples, total: cell.total })}
        >
          {localeText(loc, "cell.coverageDetail", { samples: cell.samples, total: cell.total })}
        </small>
      ) : (
        <sup
          className="niceeval-coverage"
          title={localeText(loc, "cell.coverageTitle", { samples: cell.samples, total: cell.total })}
        >
          {cell.samples}/{cell.total}
        </sup>
      ))}
      {href && refLocators.length === 1 && href(refLocators[0]!) !== undefined && (
        <span className="niceeval-refs">
          <a className="niceeval-ref" href={href(refLocators[0]!)}>
            #1
          </a>
        </span>
      )}
      {href && refLocators.length > 1 && (
        <details className="niceeval-refs">
          <summary className="niceeval-refs-summary">
            {countText(loc, "cell.evidence", refLocators.length)}
          </summary>
          <span className="niceeval-refs-list">
            {refLocators.map((locator, index) =>
              href(locator) !== undefined ? (
                <a key={locator} className="niceeval-ref" href={href(locator)}>
                  #{index + 1}
                </a>
              ) : (
                <span key={locator} className="niceeval-ref-text">
                  #{index + 1}
                </span>
              )
            )}
          </span>
        </details>
      )}
    </span>
  );
}

function renderCellWeb(
  cell: Cell | undefined,
  ctx: TableWebContext,
  coverageDetail = false,
): ReactNode {
  if (!cell) return <span className="niceeval-missing">{MISSING_MARK}</span>;
  switch (cell.kind) {
    case "stack":
      return (
        <span className="niceeval-cell-stack">
          {cell.cells.map((entry, index) => (
            <span className="niceeval-cell-stack-item" key={index}>
              {renderCellWeb(entry, ctx, index === 0)}
            </span>
          ))}
        </span>
      );
    case "notApplicable":
      return <span className="niceeval-missing">{MISSING_MARK}</span>;
    case "missing":
      return (
        <span className="niceeval-missing">
          <span className="niceeval-missing-reason">{missingText(cell.code, ctx.locale)}</span>
          {cell.detail ? <small className="niceeval-cell-detail">{cell.detail}</small> : null}
        </span>
      );
    case "text":
      return (
        <span className="niceeval-cell-text">
          <span>{cell.text}</span>
          {cell.detail ? <small className="niceeval-cell-detail">{cell.detail}</small> : null}
        </span>
      );
    case "locator": {
      // 判定长在 locator 上:判定符与语义色同场,不靠颜色单独表意。
      const verdict = cell.verdict;
      const className = cx(
        "niceeval-locator",
        verdict !== undefined && `niceeval-verdict-${verdict}`,
      );
      const mark = verdict === undefined ? null : (
        <span className="niceeval-locator-mark" aria-hidden="true">
          {verdictMark(verdict)}
        </span>
      );
      const href = ctx.href(cell.locator);
      return href !== undefined ? (
        <a className={className} href={href}>
          {mark}
          {cell.locator}
        </a>
      ) : (
        <span className={className}>
          {mark}
          {cell.locator}
        </span>
      );
    }
    case "summary":
    case "score":
      return formatCellText(cell, ctx.locale);
    case "verdict": {
      if (cell.counts) {
        const parts = (["passed", "failed", "errored", "skipped"] as const)
          .filter((kind) => cell.counts![kind] > 0);
        return (
          <span className="niceeval-verdict-tally">
            {parts.map((kind) => (
              <span className={`niceeval-verdict-${kind}`} key={kind}>
                {cell.counts![kind]} {localeText(ctx.locale, `verdict.${kind}`)}
              </span>
            ))}
            {parts.length === 0 ? <span className="niceeval-missing">{MISSING_MARK}</span> : null}
          </span>
        );
      }
      const verdict = cell.verdict ?? "skipped";
      return (
        <span className={cx("niceeval-verdict", `niceeval-verdict-${verdict}`)}>
          {verdictMark(verdict)}
          {!cell.bare ? <> {localeText(ctx.locale, `verdict.${verdict}`)}</> : null}
        </span>
      );
    }
    case "metric":
      return (
        <MetricCellView
          cell={cell.metric}
          href={ctx.showMeasureRefs === false ? undefined : ctx.href}
          locale={ctx.locale}
          showCoverage={cell.showCoverage !== false}
          coverageDetail={coverageDetail}
        />
      );
  }
}

function cellSortValue(cell: Cell | undefined): string | number {
  if (!cell) return "";
  if (cell.kind === "stack") return cellSortValue(cell.cells[0]);
  if (cell.kind === "metric") return cell.metric.value ?? "";
  if (cell.kind === "score") return cell.earned;
  if (cell.kind === "text") return cell.text;
  if (cell.kind === "locator") return cell.locator;
  if (cell.kind === "verdict" && cell.counts) return cell.counts.passed;
  return formatCellText(cell);
}

export function renderHierarchyRowsWeb(
  rows: readonly TableContentRow[],
  columns: readonly TableColumn[],
  ctx: TableWebContext,
  depth = 0,
): ReactNode[] {
  return rows.map((row) => {
    const cells = columns.map((column) => (
      <span
        className={cx(
          "niceeval-table-hierarchy-cell",
          column.align === "right" && "niceeval-align-right",
        )}
        data-sort-value={cellSortValue(row.cells[column.key])}
        key={column.key}
      >
        {renderCellWeb(row.cells[column.key], ctx)}
      </span>
    ));
    const className = cx(
      "niceeval-table-hierarchy-row",
      row.variant === "placeholder" && "niceeval-row-placeholder",
      row.variant === "group" && "niceeval-row-group",
    );
    if (!row.subRows?.length) {
      return (
        <div className={className} data-depth={depth || undefined} key={row.key}>
          {cells}
        </div>
      );
    }
    return (
      <details
        className={cx(className, "niceeval-table-hierarchy-group")}
        data-depth={depth || undefined}
        key={row.key}
      >
        <summary className="niceeval-table-hierarchy-summary">{cells}</summary>
        <div className="niceeval-table-hierarchy-children">
          {renderHierarchyRowsWeb(row.subRows, columns, ctx, depth + 1)}
        </div>
      </details>
    );
  });
}

function renderFlatContentRowsWeb(
  rows: readonly TableContentRow[],
  columns: readonly TableColumn[],
  ctx: TableWebContext,
): ReactNode[] {
  return rows.map((row) => (
    <tr
      key={row.key}
      className={cx(
        row.variant === "placeholder" && "niceeval-row-placeholder",
        row.variant === "group" && "niceeval-row-group",
      )}
    >
      {columns.map((column) => (
        <td key={column.key} className={column.align === "right" ? "niceeval-align-right" : undefined}>
          {renderCellWeb(row.cells[column.key], ctx)}
        </td>
      ))}
    </tr>
  ));
}

/** 行 × 列原语：只消费闭合 TableContent plain props。 */
export function TableContentView(props: TableContentViewProps): ReactNode {
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;
  const { columns, content } = tableContentOf(props.data);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<{ key: string; direction: "asc" | "desc" } | null>(
    props.sort === undefined ? null : { key: props.sort, direction: "asc" },
  );
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filter = (row: TableContentRow): TableContentRow | null => {
      const subRows = row.subRows?.map(filter).filter((item): item is TableContentRow => item !== null);
      const matches = needle === "" || Object.values(row.cells).some((cell) => formatCellText(cell, locale).toLocaleLowerCase().includes(needle));
      return matches || (subRows?.length ?? 0) > 0 ? { ...row, ...(subRows === undefined ? {} : { subRows }) } : null;
    };
    const filtered = content.rows.map(filter).filter((row): row is TableContentRow => row !== null);
    if (sorting === null) return filtered;
    const direction = sorting.direction === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => formatCellText(left.cells[sorting.key], locale)
      .localeCompare(formatCellText(right.cells[sorting.key], locale), locale, { numeric: true }) * direction);
  }, [content.rows, locale, query, sorting]);
  const href = props.hrefForLocator ?? canonicalAttemptHref;
  const hierarchical = content.rows.some((row) => (row.subRows?.length ?? 0) > 0);
  const table = (
    <table
      className={cx(
        "niceeval-report",
        "niceeval-table",
        hierarchical && "niceeval-table--hierarchical",
        props.className,
      )}
      data-column-count={hierarchical ? columns.length : undefined}
    >
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cx(
                column.align === "right" && "niceeval-align-right",
                sorting?.key === column.key
                  ? sorting.direction === "asc" ? "niceeval-sort-asc" : "niceeval-sort-desc"
                  : undefined,
              )}
              onClick={column.better === undefined ? undefined : () => setSorting((current) => ({
                key: column.key,
                direction: current?.key === column.key && current.direction === "asc" ? "desc" : "asc",
              }))}
              tabIndex={column.better === undefined ? undefined : 0}
              onKeyDown={column.better === undefined ? undefined : (event) => {
                if (event.key === "Enter" || event.key === " ") event.currentTarget.click();
              }}
            >
              {resolveLocalizedText(column.header, locale)}
            </th>
          ))}
        </tr>
      </thead>
      {hierarchical ? (
        <tbody>
          <tr>
            <td colSpan={columns.length} className="niceeval-table-hierarchy-body">
              {renderHierarchyRowsWeb(rows, columns, {
                href,
                locale,
                showMeasureRefs: false,
              })}
            </td>
          </tr>
        </tbody>
      ) : (
        <tbody>{renderFlatContentRowsWeb(rows, columns, { href, locale })}</tbody>
      )}
    </table>
  );
  if (props.searchable !== true) return table;
  return (
    <div className="niceeval-report niceeval-table-wrap">
      <input
        className="niceeval-filter"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={localeText(
          locale,
          columns[0].key === "entity"
            ? "experimentList.filterPlaceholder"
            : "table.filterPlaceholder",
        )}
      />
      {table}
    </div>
  );
}
