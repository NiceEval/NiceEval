// AttemptTimeline:runner phases 主链 + 收尾段,children(hook/command/turn)默认收合、
// 失败节点带标记;turn 节点按 traceId 关联同一轮的 agent/model/tool span。没有 phase 时
// 零输出(docs/feature/reports/components/attempt-detail/README.md)。

import type { ReactElement } from "react";
import type { AttemptTimelineData } from "../../model/types.ts";
import type { TimingNode, TraceSpan } from "../../../types.ts";
import { formatDurationMs } from "../../model/format.ts";
import { cx } from "../shared.ts";

const CLOSING_PHASES = new Set(["eval.teardown", "agent.teardown", "sandbox.teardown", "sandbox.suspend", "sandbox.stop"]);

function TimingNodeRow({ node, trace }: { node: TimingNode; trace: readonly TraceSpan[] | null }): ReactElement {
  const kids = node.children ?? [];
  const spans = node.kind === "turn" && node.traceId && trace ? trace.filter((s) => s.traceId === node.traceId) : [];
  const label = node.kind === "command" && node.command ? `shell · ${node.command.display}` : node.label;
  if (kids.length === 0 && spans.length === 0) {
    return (
      <li className={cx("nre-timeline-node", node.failed ? "nre-timeline-failed" : undefined)}>
        <span title={label}>{label}</span> <span className="nre-timeline-dur">{formatDurationMs(node.durationMs)}</span>
        {node.failed ? " ✗" : ""}
      </li>
    );
  }
  return (
    <li>
      <details open={Boolean(node.failed)}>
        <summary className={cx("nre-timeline-node", node.failed ? "nre-timeline-failed" : undefined)}>
          <span title={label}>{label}</span> <span className="nre-timeline-dur">{formatDurationMs(node.durationMs)}</span>
          {node.failed ? " ✗" : ""}
        </summary>
        {kids.length > 0 ? (
          <ul className="nre-timeline-children">
            {kids.map((child) => (
              <TimingNodeRow key={child.id} node={child} trace={trace} />
            ))}
          </ul>
        ) : null}
        {spans.length > 0 ? (
          <ul className="nre-timeline-spans">
            {spans.map((s) => (
              <li key={s.spanId}>
                {s.kind} · {s.name} · {formatDurationMs(s.endMs - s.startMs)}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </li>
  );
}

export function AttemptTimeline({ data, className }: { data: AttemptTimelineData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  const main = data.phases.filter((p) => !CLOSING_PHASES.has(p.name));
  const closing = data.phases.filter((p) => CLOSING_PHASES.has(p.name));
  const total = main.reduce((sum, p) => sum + p.durationMs, 0);
  const anyFailed = data.phases.some((p) => p.failed);
  return (
    <details className={cx("nre", "nre-attempt-timeline", className)} open={anyFailed}>
      <summary>
        Timing <span className="nre-timeline-dur">{formatDurationMs(total)}</span>
        {anyFailed ? " ✗" : ""}
      </summary>
      <ul className="nre-timeline-phases">
        {main.map((p, i) => {
          const kids = p.children ?? [];
          if (kids.length === 0) {
            return (
              <li key={i} className={cx("nre-timeline-phase", p.failed ? "nre-timeline-failed" : undefined)}>
                {p.name} <span className="nre-timeline-dur">{formatDurationMs(p.durationMs)}</span>
                {p.failed ? " ✗" : ""}
              </li>
            );
          }
          return (
            <li key={i}>
              <details open={Boolean(p.failed)}>
                <summary className={cx("nre-timeline-phase", p.failed ? "nre-timeline-failed" : undefined)}>
                  {p.name} <span className="nre-timeline-dur">{formatDurationMs(p.durationMs)}</span>
                  {p.failed ? " ✗" : ""}
                </summary>
                <ul className="nre-timeline-children">
                  {kids.map((node) => (
                    <TimingNodeRow key={node.id} node={node} trace={data.trace} />
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      {closing.length > 0 ? (
        <div className="nre-timeline-closing">
          <div className="nre-timeline-closing-head">teardown</div>
          <ul className="nre-timeline-phases">
            {closing.map((p, i) => (
              <li key={i} className={cx("nre-timeline-phase", p.failed ? "nre-timeline-failed" : undefined)}>
                {p.name} <span className="nre-timeline-dur">{formatDurationMs(p.durationMs)}</span>
                {p.failed ? " ✗" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}
