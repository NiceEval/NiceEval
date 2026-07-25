// SnapshotDiagnostics:快照诊断区的 web 面。按来源 experiment → Snapshot 分组
// (../snapshot-diagnostics.ts,与 text 面共用同一聚合层):整个区域是默认折叠的原生
// <details>,<summary> 是恒可见的计数汇总行(涉及多少个 experiment、多少个 Snapshot、
// 多少条记录与最高严重度)。单个快照只有一条诊断时退化成一行,不摆只有一个孩子的空壳
// 层级。空诊断集零输出,不渲染空容器
// (docs/feature/reports/components/site/run-diagnostics.md)。

import type { ReactElement } from "react";
import type { DiagnosticRecord } from "../../../types.ts";
import type { SnapshotDiagnosticsData } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "../../model/locale.ts";
import { formatHistoricalGap, formatReportDateTime } from "../../model/format.ts";
import { groupSnapshotDiagnostics, occurrencesOf } from "./snapshot-diagnostics.ts";
import { cx } from "../shared.ts";

/** 命令的可复制块:无 JS 时点击全选(user-select: all),enhance.js 在场时点击复制。 */
function CommandBlock({ command }: { command: string }): ReactElement {
  return (
    <code className="nre-snap-diag-command" data-nre-copy={command}>
      {command}
    </code>
  );
}

/** 相对时距徽标:可见文本是紧凑时距,hover 显示完整时刻(与实体列表的时效标注同一套语义)。 */
function TimeBadge({ startedAt, locale }: { startedAt: string; locale: ReportLocale }): ReactElement {
  return (
    <span className="nre-snap-diag-time" title={formatReportDateTime(startedAt, locale)}>
      ↩ {formatHistoricalGap(startedAt)}
    </span>
  );
}

/** 一条 DiagnosticRecord 的内容:level/code meta、message、count 后缀与 command。 */
function RecordBody({ record }: { record: DiagnosticRecord }): ReactElement {
  const n = occurrencesOf(record);
  return (
    <>
      <span className={`nre-snap-diag-meta nre-tone-${record.level === "error" ? "bad" : "warn"}`}>
        {record.level} · {record.code}
        {n > 1 ? ` ×${n}` : ""}
      </span>
      <div className="nre-snap-diag-message">{record.message}</div>
      {record.command !== undefined && <CommandBlock command={record.command} />}
    </>
  );
}

/**
 * 快照诊断区(纯 web 渲染面):按来源分组的实验域诊断。嵌入自有 React 页面时传
 * `data={await snapshotDiagnosticsData(input)}`;空集返回 null,不渲染空容器。
 */
export function SnapshotDiagnostics({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: SnapshotDiagnosticsData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement | null {
  if (data.length === 0) return null;
  const { summary, groups, severity } = groupSnapshotDiagnostics(data, locale);
  return (
    <div className={cx("nre", "nre-snapshot-diagnostics", className)}>
      <details className="nre-snap-diag">
        <summary className="nre-snap-diag-summary" data-severity={severity}>
          {summary}
        </summary>
        <ul className="nre-snap-diag-groups">
          {groups.map((group) => (
            <li key={group.experimentId} className="nre-snap-diag-group">
              <div className="nre-snap-diag-exp">{group.experimentId}</div>
              <ul className="nre-snap-diag-snapshots">
                {group.items.map((item, i) =>
                  item.diagnostics.length === 1 ? (
                    // 单诊断快照退化成一行:时距与该条记录合并展示,不另起 <ul> 空壳层级。
                    <li key={i} className="nre-snap-diag-snapshot nre-snap-diag-collapsed">
                      <TimeBadge startedAt={item.startedAt} locale={locale} />
                      <RecordBody record={item.diagnostics[0]!} />
                    </li>
                  ) : (
                    <li key={i} className="nre-snap-diag-snapshot">
                      <TimeBadge startedAt={item.startedAt} locale={locale} />
                      <ul className="nre-snap-diag-records">
                        {item.diagnostics.map((record, j) => (
                          <li key={j} className="nre-snap-diag-record">
                            <RecordBody record={record} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ),
                )}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
