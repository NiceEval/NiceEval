// ScopeWarnings:选择警告区的 web 面。按「下一步动作」聚合(../scope-warnings.ts,
// 与 text 面共用同一聚合层):整个警告区是默认折叠的原生 <details>,<summary> 是
// 分类计数汇总行(恒可见);展开后每组组头 = 标题 + kind 徽标 + 去重后恰一条的
// 可复制命令,逐条原始 message 收进第二层 <details>(总条数 ≤ 3 默认展开)。
// 空警告集零输出,不渲染空容器
// (docs/feature/reports/components/site/scope-warnings.md)。

import type { ReactElement } from "react";
import type { ScopeWarning } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "../../model/locale.ts";
import { groupScopeWarnings, warningDetailsLabel } from "./scope-warnings.ts";
import { cx } from "../shared.ts";

/** 命令的可复制块:无 JS 时点击全选(user-select: all),enhance.js 在场时点击复制。 */
function CommandBlock({ command }: { command: string }): ReactElement {
  return (
    <code className="nre-warning-command" data-nre-copy={command}>
      {command}
    </code>
  );
}

/**
 * 选择警告区(纯 web 渲染面):按动作聚合的警告组。嵌入自有 React 页面时传
 * `data={scope.warnings}`;空集返回 null,不渲染空容器。
 */
export function ScopeWarnings({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: readonly ScopeWarning[];
  className?: string;
  locale?: ReportLocale;
}): ReactElement | null {
  if (data.length === 0) return null;
  const { summary, groups, detailsOpen } = groupScopeWarnings(data, locale);
  return (
    <div className={cx("nre", "nre-scope-warnings", className)}>
      <details className="nre-warnings">
        <summary className="nre-warnings-summary">{summary}</summary>
        <ul className="nre-warning-groups">
          {groups.map((group, i) => (
            <li key={i} className="nre-warning-group">
              <div className="nre-warning-head">
                <span className="nre-warning-title">{group.title}</span>
                {group.badges.map((badge, j) => (
                  <span key={j} className="nre-warning-badge" data-kind={badge.kind}>
                    {badge.text}
                  </span>
                ))}
                {group.headCommand !== null && <CommandBlock command={group.headCommand} />}
              </div>
              <details className="nre-warning-details" open={detailsOpen || undefined}>
                <summary>{warningDetailsLabel(locale, group.warnings.length)}</summary>
                <ul>
                  {group.warnings.map((w, j) => (
                    <li key={j} className="nre-warning" data-kind={w.kind}>
                      {w.message}
                      {/* 组头命令的含义是「复制即推进整组」;去重后多于一条时命令随明细逐条走 */}
                      {group.headCommand === null && "command" in w && w.command !== undefined && (
                        <CommandBlock command={w.command} />
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
