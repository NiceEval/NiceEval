import { Children, type ReactElement, type ReactNode } from "react";

import { Callouts } from "./callouts.tsx";
import { CommandEvidence, Conversation, ConversationEntries } from "./conversation.tsx";
import { CopyBlock } from "./copy-block.tsx";
import { DiffView } from "./diff-view.tsx";
import { SourceView } from "./source-view.tsx";
import { TurnTrace } from "./turn-trace.tsx";
import { Waterfall } from "./waterfall.tsx";
import { cx, resolveLocalizedText, type LocalizedText, type ReportLocale } from "./shared.ts";

export { AssertionEvidence } from "./assertion-evidence.tsx";
export { Callouts, CommandEvidence, Conversation, ConversationEntries, CopyBlock, DiffView, SourceView, TurnTrace, Waterfall };
export { MatcherFilterDebugger } from "./matcher-filter-debugger.tsx";
export { ToolEvidence } from "./tool-evidence.tsx";

export interface LayoutProps {
  readonly children?: ReactNode;
  readonly className?: string;
}

export function Col({ children, className }: LayoutProps): ReactElement {
  return <div className={cx("niceeval-report", "niceeval-col", className)}>{Children.toArray(children)}</div>;
}

export function Grid({ children, className }: LayoutProps): ReactElement {
  const cells = Children.toArray(children);
  return (
    <div className="niceeval-report niceeval-grid-fit">
      <div className={cx("niceeval-report", "niceeval-grid", className)} data-cells={cells.length}>
        {cells.map((cell, index) => <div className="niceeval-grid-cell" key={index}>{cell}</div>)}
      </div>
    </div>
  );
}

export function Text({ children, className }: LayoutProps): ReactElement {
  return <div className={cx("niceeval-report", "niceeval-text", className)}>{children}</div>;
}

export type TableCellContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "verdict"; readonly verdict: "passed" | "failed" | "skipped" }
  | { readonly kind: "notApplicable" };

export interface TableContentRow {
  readonly key: string;
  readonly cells: Readonly<Record<string, TableCellContent>>;
}

export interface TableContent {
  readonly columns: readonly { readonly key: string; readonly header: LocalizedText }[];
  readonly rows: readonly TableContentRow[];
}

function CellValue({ cell }: { readonly cell: TableCellContent | undefined }): ReactNode {
  if (cell === undefined || cell.kind === "notApplicable") return "—";
  if (cell.kind === "verdict") {
    return <span className={cx("niceeval-verdict-pill", `niceeval-verdict-${cell.verdict}`)}>{cell.verdict}</span>;
  }
  return cell.text;
}

export function TableContentView({
  data,
  locale,
  className,
}: {
  readonly data: TableContent | null;
  readonly locale: ReportLocale;
  readonly className?: string;
}): ReactElement | null {
  if (data === null || data.rows.length === 0 || data.columns.length === 0) return null;
  return (
    <table className={cx("niceeval-report", "niceeval-table", className)}>
      <thead><tr>{data.columns.map((column) => <th key={column.key} scope="col">{resolveLocalizedText(column.header, locale)}</th>)}</tr></thead>
      <tbody>{data.rows.map((row) => (
        <tr key={row.key}>{data.columns.map((column) => <td key={column.key}><CellValue cell={row.cells[column.key]} /></td>)}</tr>
      ))}</tbody>
    </table>
  );
}
