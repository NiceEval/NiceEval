// 源码行共用呈现:零依赖 TS 高亮、行号位 SVG 图标、tone → CSS class。
// AttemptSource 与 SourceView 各自独立容器,视觉语言对齐(docs/feature/reports/components/primitives/source-view.md)。

import type { ReactElement, ReactNode } from "react";

const TS_HL_RE =
  /(\/\/[^\n]*)|(\/\*[^]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|async|await|function|return|if|else|for|of|in|new|class|extends|typeof|void|true|false|null|undefined)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;

/** 逐行零依赖 TS 高亮;token class 是稳定的 web 展示语义,不改源码文本。 */
export function highlightTs(line: string): ReactNode[] {
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

export type SourceMarkKind = "send" | "good" | "bad" | "warn" | "na";

/** 行号位标记(内联 SVG,零图标依赖);与产品站示例卡同语言。 */
export const MARK_ICONS: Record<SourceMarkKind, ReactElement> = {
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

const MARK_LABELS: Record<SourceMarkKind, string> = {
  send: "send",
  good: "passed",
  bad: "failed",
  warn: "soft failed",
  na: "unavailable",
};

export function SourceLineNo({ line, mark }: { line: number; mark: SourceMarkKind | null }): ReactElement {
  if (mark === null) return <span className="nre-source-ln">{line}</span>;
  const label = MARK_LABELS[mark];
  return (
    <span className="nre-source-ln nre-source-ln-mark" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {MARK_ICONS[mark]}
      </svg>
    </span>
  );
}

export type ContractLineTone = "send" | "passed" | "gate-fail" | "soft-fail" | "unavailable";
export type AttemptLineTone = "good" | "warn" | "bad" | "na";

export function contractToneLineClass(tone: ContractLineTone | undefined, aborted?: boolean): string | undefined {
  if (aborted) return "nre-tone-bad";
  switch (tone) {
    case "send":
      return "nre-source-line-send";
    case "passed":
      return "nre-tone-good";
    case "gate-fail":
      return "nre-tone-bad";
    case "soft-fail":
      return "nre-tone-warn";
    case "unavailable":
      return "nre-tone-na";
    default:
      return undefined;
  }
}

export function contractToneMark(tone: ContractLineTone | undefined, aborted?: boolean): SourceMarkKind | null {
  if (aborted) return "bad";
  switch (tone) {
    case "send":
      return "send";
    case "passed":
      return "good";
    case "gate-fail":
      return "bad";
    case "soft-fail":
      return "warn";
    case "unavailable":
      return "na";
    default:
      return null;
  }
}

export function attemptToneLineClass(tone: AttemptLineTone | undefined, send: boolean): string | undefined {
  if (tone) return `nre-tone-${tone}`;
  if (send) return "nre-source-line-send";
  return undefined;
}

export function attemptToneMark(
  tone: AttemptLineTone | undefined,
  send: boolean,
): SourceMarkKind | null {
  if (tone === "bad") return "bad";
  if (tone === "warn") return "warn";
  if (tone === "na") return "na";
  if (tone === "good") return "good";
  if (send) return "send";
  return null;
}
