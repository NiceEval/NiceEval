// AttemptSource:GitHub diff 式带标注 eval 源码。send / assertion 行按状态着色，点击
// 原生 details 在调用点展开完整回复与 assertion 细节。没有 source 时零输出
// (docs/feature/reports/components/attempt-detail.md)。

import type { ReactElement, ReactNode } from "react";
import type { AttemptSourceData, AttemptSourceLineData, AttemptSourceTurn } from "../../model/types.ts";
import type { AssertionResult, ScoreEntry } from "../../../types.ts";
import { stripControl } from "../../../scoring/display.ts";
import { formatPointsSuffix } from "../../model/format.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
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

/** 一行是否可展开:断言 / send / turn / t.score 给分记录任一非空。 */
function isLineInteractive(line: AttemptSourceLineData): boolean {
  return line.assertions.length > 0 || line.sends.length > 0 || line.turns.length > 0 || line.scoreEntries.length > 0;
}

/**
 * 一行的挣分 pill 总额:`.points` 断言挣到的分(排除 unavailable)+ `t.score(...)` 给分记录之和;
 * 两者都不存在时 undefined(该行不是分数面证据),0 分照实显示(docs/feature/scoring/library/
 * display.md「计分制」)。
 */
function linePointsTotal(line: AttemptSourceLineData): number | undefined {
  const hasScorePoint = line.assertions.some((a) => a.outcome !== "unavailable" && a.points !== undefined);
  if (!hasScorePoint && line.scoreEntries.length === 0) return undefined;
  const fromAssertions = line.assertions.reduce(
    (sum, a) => sum + (a.outcome !== "unavailable" && typeof a.points === "number" ? a.points : 0),
    0,
  );
  const fromScoreEntries = line.scoreEntries.reduce((sum, e) => sum + e.points, 0);
  return fromAssertions + fromScoreEntries;
}

/** 行号位标记(与产品站示例卡同语言:图标顶替行号,不加独立状态列);内联 SVG,零图标依赖。 */
const MARK_ICONS: Record<"send" | "good" | "bad" | "warn" | "na", ReactElement> = {
  send: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
  good: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  bad: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  warn: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </>
  ),
  na: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
};

function LineNo({ line, tone, send }: { line: number; tone: ReturnType<typeof lineTone>; send: boolean }): ReactElement {
  const kind = tone ?? (send ? "send" : null);
  if (kind === null) return <span className="nre-source-ln">{line}</span>;
  const label = kind === "bad" ? "failed" : kind === "warn" ? "soft failed" : kind === "good" ? "passed" : kind === "na" ? "unavailable" : "send";
  return (
    <span className="nre-source-ln nre-source-ln-mark" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{MARK_ICONS[kind]}</svg>
    </span>
  );
}

function LineSummary({ line, tone }: { line: AttemptSourceLineData; tone: ReturnType<typeof lineTone> }): ReactElement {
  const interactive = isLineInteractive(line);
  const scores = thresholdScores(line.assertions);
  const points = linePointsTotal(line);
  return (
    <span className="nre-source-line-summary">
      <LineNo line={line.line} tone={tone} send={line.sends.length > 0 || line.turns.length > 0} />
      <code className="nre-source-text">{highlightTs(line.text)}</code>
      <span className="nre-source-line-meta">
        {scores.length > 0 ? <span className="nre-source-score-badge">{scores.join(", ")}</span> : null}
        {/* 得分点/t.score(...) 的挣分 pill,钉在滚动视口右缘(docs/feature/reports/library/
            attempt-detail.md「AttemptSource web 面视觉规范」右缘 meta)。 */}
        {points !== undefined ? <span className="nre-source-points-pill">{formatPointsSuffix(points)}</span> : null}
        {/* 前置中止行的 ⤓ 标记,同处右缘 meta。 */}
        {line.aborted ? <span className="nre-source-abort-mark" aria-hidden="true">⤓</span> : null}
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

function AssertionDetail({ assertion, locale }: { assertion: AssertionResult & { aborted?: true }; locale: ReportLocale }): ReactElement {
  return (
    <div className={`nre-assertion-row nre-tone-${assertTone(assertion)}`}>
      <div className="nre-source-assertion-head">
        <span className="nre-assertion-badge">{assertion.outcome}</span>
        <span className="nre-assertion-name">{assertion.name}</span>
        {assertion.outcome !== "unavailable" ? <span className="nre-source-assertion-score">{assertion.score}</span> : null}
      </div>
      {assertion.detail ? <div className="nre-assertion-detail">{assertion.detail}</div> : null}
      {assertion.outcome === "unavailable" ? (
        <div className="nre-assertion-body">reason: {assertion.reason === undefined ? undefined : stripControl(assertion.reason)}</div>
      ) : assertion.expected !== undefined || assertion.received !== undefined || assertion.evidence !== undefined ? (
        <div className="nre-assertion-body">
          {assertion.expected !== undefined ? <span>expected: {stripControl(assertion.expected)}</span> : null}
          {assertion.received !== undefined ? <span>received: {stripControl(assertion.received)}</span> : null}
          {assertion.evidence !== undefined ? <span>evidence: {stripControl(assertion.evidence)}</span> : null}
        </div>
      ) : null}
      {/* 前置中止:这条断言让 test() 就地结束,其后不再有任何断言或给分记录
          (docs/feature/scoring/library/display.md「前置中止」)。 */}
      {assertion.aborted ? <div className="nre-assertion-abort">⤓ {localeText(locale, "attemptSource.abortReason")}</div> : null}
    </div>
  );
}

/** `t.score(label, n)` 调用行的展开区:给分记录本体(label、挣分、分组路径),不着判定色——
 *  给分是分数面事实,不是判定(docs/feature/reports/components/attempt-detail.md「AttemptSource
 *  web 面视觉规范」给分行)。 */
function ScoreEntryDetail({ entry }: { entry: ScoreEntry }): ReactElement {
  return (
    <div className="nre-score-entry-row">
      {entry.groupPath?.length ? <span className="nre-score-entry-group">{entry.groupPath.join(" > ")} · </span> : null}
      <span className="nre-score-entry-label">{entry.label}</span>
      <span className="nre-assertion-points">{formatPointsSuffix(entry.points)}</span>
    </div>
  );
}

export function AttemptSource({
  data,
  locale = DEFAULT_REPORT_LOCALE,
  className,
}: {
  data: AttemptSourceData | null;
  locale?: ReportLocale;
  className?: string;
}): ReactElement | null {
  if (data === null) return null;
  const firstAttentionLine = data.lines.find((line) => {
    const tone = lineTone(line);
    return tone === "bad" || tone === "warn" || tone === "na";
  })?.line;
  return (
    <div className={cx("nre", "nre-attempt-source", className)}>
      <div className="nre-attempt-source-head">
        {data.sourcePath}
        {/* 顶层计数:计分制 attempt 加一项得分点挣满计数(源码不可用时换成 AttemptAssertions
            「规则完全一致」,docs/feature/reports/show/attempt.md)。 */}
        {data.scorePointsEarned ? (
          <span className="nre-attempt-source-score-points">
            {localeText(locale, "attemptAssertions.scorePointsEarned", data.scorePointsEarned)}
          </span>
        ) : null}
      </div>
      <div className="nre-attempt-source-lines">
        {data.lines.map((line) => {
          const tone = lineTone(line);
          const interactive = isLineInteractive(line);
          const lineClass = cx(
            "nre-source-line",
            tone ? `nre-tone-${tone}` : undefined,
            line.sends.length > 0 || line.turns.length > 0 ? "nre-source-line-send" : undefined,
            // 前置中止行之后整体降灰(未到达——那些行没有任何断言或给分记录,不是因为没写,
            // 是因为没跑到),行号照常显示(docs/feature/scoring/library/display.md「前置中止」)。
            line.unreached ? "nre-source-line-unreached" : undefined,
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
                  <AssertionDetail key={i} assertion={assertion} locale={locale} />
                ))}
                {line.scoreEntries.map((entry, i) => (
                  <ScoreEntryDetail key={i} entry={entry} />
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
              {a.aborted ? <span className="nre-assertion-abort"> · ⤓ {localeText(locale, "attemptSource.abortReason")}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {data.unmappedScoreEntries && data.unmappedScoreEntries.length > 0 ? (
        <div className="nre-attempt-source-unmapped-score-entries">
          <div className="nre-attempt-source-unmapped-head">{localeText(locale, "attemptAssertions.scoreEntries")}</div>
          {data.unmappedScoreEntries.map(({ group, items }) => (
            <div key={group || "·"} className="nre-score-entries-group">
              {group ? <div className="nre-score-entry-group">{group}</div> : null}
              {items.map((entry, i) => (
                <ScoreEntryDetail key={i} entry={entry} />
              ))}
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
