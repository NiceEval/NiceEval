// AttemptSource:GitHub diff 式带标注 eval 源码。send / assertion 行按状态着色，点击
// 原生 details 在调用点展开完整回复与 assertion 细节。没有 source 时零输出
// (docs/feature/reports/library/attempt-detail.md)。

import type { ReactElement, ReactNode } from "react";
import type { AttemptSourceData, AttemptSourceLineData, AttemptSourceTurn } from "../../model/types.ts";
import type { AssertionResult } from "../../../types.ts";
import { cx } from "../shared.ts";
import { ConversationReplies } from "./AttemptConversation.tsx";

const TS_HL_RE =
  /(\/\/[^\n]*)|(\/\*[^]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|async|await|function|return|if|else|for|of|in|new|class|extends|typeof|void|true|false|null|undefined)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;

/** 逐行零依赖 TS 高亮；token class 是稳定的 web 展示语义，不改源码文本。 */
function highlightTs(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  TS_HL_RE.lastIndex = 0;
  while ((match = TS_HL_RE.exec(line))) {
    if (match.index > last) out.push(line.slice(last, match.index));
    const tokenClass =
      match[1] || match[2] ? "tok-comment" : match[3] ? "tok-str" : match[4] ? "tok-kw" : match[5] ? "tok-num" : "tok-fn";
    out.push(
      <span key={i++} className={tokenClass}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
    if (match[0].length === 0) TS_HL_RE.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function assertTone(a: AssertionResult): "good" | "warn" | "bad" | "na" {
  if (a.outcome === "unavailable") return "na";
  if (a.outcome === "passed") return "good";
  return a.severity === "soft" ? "warn" : "bad";
}

function lineTone(line: AttemptSourceLineData): "good" | "warn" | "bad" | "na" | undefined {
  if (line.assertions.length === 0) return undefined;
  if (line.assertions.some((a) => assertTone(a) === "bad")) return "bad";
  if (line.assertions.some((a) => assertTone(a) === "warn")) return "warn";
  if (line.assertions.some((a) => assertTone(a) === "na")) return "na";
  return "good";
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function thresholdScores(assertions: AssertionResult[]): string[] {
  const scores: string[] = [];
  for (const assertion of assertions) {
    if (assertion.outcome !== "unavailable" && assertion.threshold !== undefined) {
      scores.push(`${assertion.score}/${assertion.threshold}`);
    }
  }
  return scores;
}

function StatusMark({ tone, send }: { tone: ReturnType<typeof lineTone>; send: boolean }): ReactElement {
  const label = tone === "bad" ? "failed" : tone === "warn" ? "soft failed" : tone === "good" ? "passed" : tone === "na" ? "unavailable" : send ? "send" : null;
  if (label === null) return <span className="nre-source-status nre-source-status-empty" aria-hidden="true" />;
  if (label === "send") {
    return (
      <span className="nre-source-status nre-source-status-send" aria-label={label} title={label}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        </svg>
      </span>
    );
  }
  const mark = tone === "bad" ? "×" : tone === "warn" ? "!" : tone === "good" ? "✓" : "?";
  return (
    <span className="nre-source-status" aria-label={label} title={label}>
      {mark}
    </span>
  );
}

function LineSummary({ line, tone }: { line: AttemptSourceLineData; tone: ReturnType<typeof lineTone> }): ReactElement {
  const interactive = line.assertions.length > 0 || line.sends.length > 0 || line.turns.length > 0;
  const scores = thresholdScores(line.assertions);
  return (
    <span className="nre-source-line-summary">
      <span className="nre-source-ln">{line.line}</span>
      <StatusMark tone={tone} send={line.sends.length > 0 || line.turns.length > 0} />
      <code className="nre-source-text">{highlightTs(line.text)}</code>
      <span className="nre-source-line-meta">
        {scores.length > 0 ? <span className="nre-source-score-badge">{scores.join(", ")}</span> : null}
        {interactive ? <span className="nre-source-chevron">›</span> : null}
      </span>
    </span>
  );
}

function TurnDetail({ turn, showMeta = false, showSent = false }: { turn: AttemptSourceTurn; showMeta?: boolean; showSent?: boolean }): ReactElement {
  return (
    <div className={cx("nre-source-turn", `nre-source-turn-${turn.status}`)}>
      {showMeta ? (
        <div className="nre-source-turn-head">
          <span>{turn.label}</span>
          <span>{turn.status}</span>
          {turn.durationMs === undefined ? null : <span>{formatDuration(turn.durationMs)}</span>}
        </div>
      ) : null}
      {showSent && turn.sentText ? <div className="nre-conv-sent">{turn.sentText}</div> : null}
      <ConversationReplies replies={turn.replies} />
    </div>
  );
}

function AssertionDetail({ assertion }: { assertion: AssertionResult }): ReactElement {
  return (
    <div className={`nre-assertion-row nre-tone-${assertTone(assertion)}`}>
      <div className="nre-source-assertion-head">
        <span className="nre-assertion-badge">{assertion.outcome}</span>
        <span className="nre-assertion-name">{assertion.name}</span>
        {assertion.outcome !== "unavailable" ? <span className="nre-source-assertion-score">{assertion.score}</span> : null}
      </div>
      {assertion.detail ? <div className="nre-assertion-detail">{assertion.detail}</div> : null}
      {assertion.outcome === "unavailable" ? (
        <div className="nre-assertion-body">reason: {assertion.reason}</div>
      ) : assertion.expected !== undefined || assertion.received !== undefined || assertion.evidence !== undefined ? (
        <div className="nre-assertion-body">
          {assertion.expected !== undefined ? <span>expected: {assertion.expected}</span> : null}
          {assertion.received !== undefined ? <span>received: {assertion.received}</span> : null}
          {assertion.evidence !== undefined ? <span>evidence: {assertion.evidence}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AttemptSource({ data, className }: { data: AttemptSourceData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  const firstAttentionLine = data.lines.find((line) => {
    const tone = lineTone(line);
    return tone === "bad" || tone === "warn" || tone === "na";
  })?.line;
  return (
    <div className={cx("nre", "nre-attempt-source", className)}>
      <div className="nre-attempt-source-head">{data.sourcePath}</div>
      <div className="nre-attempt-source-lines">
        {data.lines.map((line) => {
          const tone = lineTone(line);
          const interactive = line.assertions.length > 0 || line.sends.length > 0 || line.turns.length > 0;
          const lineClass = cx(
            "nre-source-line",
            tone ? `nre-tone-${tone}` : undefined,
            line.sends.length > 0 || line.turns.length > 0 ? "nre-source-line-send" : undefined,
          );
          if (!interactive) {
            return (
              <div key={line.line} className={lineClass}>
                <LineSummary line={line} tone={tone} />
              </div>
            );
          }
          return (
            <details key={line.line} className={lineClass} open={line.line === firstAttentionLine}>
              <summary>
                <LineSummary line={line} tone={tone} />
              </summary>
              <div className="nre-source-line-detail">
                {line.turns.map((turn, i) => (
                  <TurnDetail key={`${turn.label}-${i}`} turn={turn} />
                ))}
                {line.assertions.map((assertion, i) => (
                  <AssertionDetail key={i} assertion={assertion} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
      {data.unmapped.length > 0 ? (
        <div className="nre-attempt-source-unmapped">
          <div className="nre-attempt-source-unmapped-head">Other assertions</div>
          {data.unmapped.map((a, i) => (
            <div key={i} className={`nre-assertion-row nre-tone-${assertTone(a)}`}>
              {a.groupPath?.length ? `${a.groupPath.join(" > ")} · ` : ""}
              {a.name}
            </div>
          ))}
        </div>
      ) : null}
      {data.unlocatedTurns.length > 0 ? (
        <div className="nre-attempt-source-unlocated">
          <div className="nre-attempt-source-unmapped-head">Other conversation</div>
          {data.unlocatedTurns.map((turn, i) => (
            <TurnDetail key={`${turn.label}-${i}`} turn={turn} showMeta showSent />
          ))}
        </div>
      ) : null}
    </div>
  );
}
