// AttemptDiagnostics:lifecycle 分组的 diagnostics。没有 diagnostics 时零输出
// (docs/feature/reports/components/attempt-detail.md)。

import type { ReactElement } from "react";
import type { AttemptDiagnosticsData } from "../../model/types.ts";
import { cx } from "../shared.ts";

export function AttemptDiagnostics({
  data,
  className,
}: {
  data: AttemptDiagnosticsData | null;
  className?: string;
}): ReactElement | null {
  if (data === null) return null;
  return (
    <div className={cx("nre", "nre-attempt-diagnostics", className)}>
      {data.groups.map(({ phase, items }) => (
        <div key={phase} className="nre-diagnostics-group">
          <div className="nre-diagnostics-phase">{phase}</div>
          <ul>
            {items.map((d, i) => (
              <li key={i} className={`nre-diagnostics-item nre-tone-${d.level === "error" ? "bad" : "warn"}`}>
                <span className="nre-diagnostics-meta">
                  {d.level} · {d.code}
                </span>
                <div>
                  {d.message}
                  {d.count && d.count > 1 ? ` (${d.count} occurrences)` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
