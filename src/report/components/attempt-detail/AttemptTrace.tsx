// AttemptTrace:不与 runner 节点混合的原始 OTel span 树。没有 trace 时零输出
// (docs/feature/reports/components/attempt-detail/README.md)。

import type { ReactElement } from "react";
import type { AttemptTraceData } from "../../model/types.ts";
import type { TraceSpan } from "../../../types.ts";
import { formatDurationMs } from "../../model/format.ts";
import { cx } from "../shared.ts";

interface SpanNode {
  span: TraceSpan;
  children: SpanNode[];
}

function buildForest(spans: readonly TraceSpan[]): SpanNode[] {
  const byId = new Map<string, SpanNode>(spans.map((s) => [s.spanId, { span: s, children: [] }]));
  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parent = node.span.parentSpanId ? byId.get(node.span.parentSpanId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function SpanRow({ node }: { node: SpanNode }): ReactElement {
  const failed = node.span.status === "error";
  const body = (
    <>
      <span className={cx("nre-span-kind", node.span.kind ? `nre-span-${node.span.kind}` : undefined)}>{node.span.kind ?? "other"}</span>
      <span title={node.span.name}>{node.span.name}</span>
      <span className="nre-span-dur">{formatDurationMs(node.span.endMs - node.span.startMs)}</span>
      {failed ? " ✗" : ""}
    </>
  );
  if (node.children.length === 0) {
    return <li className="nre-trace-span">{body}</li>;
  }
  return (
    <li>
      <details open={failed}>
        <summary className="nre-trace-span">{body}</summary>
        <ul className="nre-trace-children">
          {node.children.map((child) => (
            <SpanRow key={child.span.spanId} node={child} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function AttemptTrace({ data, className }: { data: AttemptTraceData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  const forest = buildForest(data.spans);
  return (
    <ul className={cx("nre", "nre-attempt-trace", className)}>
      {forest.map((node) => (
        <SpanRow key={node.span.spanId} node={node} />
      ))}
    </ul>
  );
}
