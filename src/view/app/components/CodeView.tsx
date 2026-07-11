import { useCallback, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, MessageCircle, XCircle } from "lucide-react";
import type { T } from "../shared.ts";
import type { Assertion, CodeSource, SourceTurn, TranscriptEvent } from "../types.ts";
import { highlightTs, indexAsserts, indexTurns, locKey } from "../lib/transcript-data.tsx";
import { formatScore } from "../lib/format.ts";
import { InputBlock, ToolBlock, Transcript } from "./Transcript.tsx";

/** soft 断言没过阈值不影响 verdict,颜色上跟 gate 失败(红)区分开,用 warn(黄)。 */
function assertTone(a: Assertion): "good" | "warn" | "bad" {
  if (a.passed) return "good";
  return a.severity === "soft" ? "warn" : "bad";
}

export function CodeView({ sources, events, assertions, t }: { sources: CodeSource[]; events: TranscriptEvent[]; assertions: Assertion[]; t: T }) {
  const turns = useMemo(() => indexTurns(events), [events]);
  const asserts = useMemo(() => indexAsserts(assertions), [assertions]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((k: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  // 哪些 loc 被源码行覆盖到了;没覆盖到的(读不到源码的文件)放底部兜底。
  const sourceKeys = new Set<string>();
  for (const f of sources) {
    const n = f.content.split("\n").length;
    for (let i = 1; i <= n; i++) sourceKeys.add(locKey(f.path, i));
  }
  const orphanAsserts = [...asserts.byKey.entries()]
    .filter(([k]) => !sourceKeys.has(k))
    .flatMap(([, v]) => v)
    .concat(asserts.noloc);

  return (
    <div className="codeview">
      {sources.map((file) => (
        <CodeFile
          key={file.path}
          file={file}
          turns={turns.byKey}
          asserts={asserts.byKey}
          open={open}
          toggle={toggle}
          t={t}
        />
      ))}
      {orphanAsserts.length ? (
        <div className="code-orphans">
          <div className="code-orphans-head">{t("code.otherAssertions")}</div>
          <AssertDetail asserts={orphanAsserts} t={t} />
        </div>
      ) : null}
    </div>
  );
}

export function CodeFile({
  file,
  turns,
  asserts,
  open,
  toggle,
  t,
}: {
  file: CodeSource;
  turns: Map<string, SourceTurn>;
  asserts: Map<string, Assertion[]>;
  open: Set<string>;
  toggle: (key: string) => void;
  t: T;
}) {
  const lines = file.content.replace(/\n$/, "").split("\n");
  return (
    <div className="code-file">
      <div className="code-file-head">{file.path}</div>
      <div className="code-lines">
        {lines.map((text: string, i: number) => {
          const n = i + 1;
          const k = locKey(file.path, n);
          return (
            <CodeLine
              key={n}
              n={n}
              text={text}
              turn={turns.get(k)}
              asserts={asserts.get(k)}
              isOpen={open.has(k)}
              onToggle={() => toggle(k)}
              t={t}
            />
          );
        })}
      </div>
    </div>
  );
}

export function CodeLine({
  n,
  text,
  turn,
  asserts,
  isOpen,
  onToggle,
  t,
}: {
  n: number;
  text: string;
  turn?: SourceTurn;
  asserts?: Assertion[];
  isOpen: boolean;
  onToggle: () => void;
  t: T;
}) {
  const hasReply = !!turn;
  const hasAsserts = !!(asserts && asserts.length);
  // 只有 gate 断言没过才算这一行真的"fail";只剩 soft 断言没过阈值时是"warn"(不影响 verdict)。
  const status = hasAsserts
    ? asserts?.every((a: Assertion) => a.passed)
      ? "pass"
      : asserts?.some((a: Assertion) => !a.passed && a.severity === "gate")
        ? "fail"
        : "warn"
    : null;
  const clickable = hasReply || hasAsserts;
  const rowCls =
    "code-line" +
    (status ? ` line-${status}` : "") +
    (hasReply && !status ? " line-send" : "") +
    (clickable ? " line-clickable" : "") +
    (isOpen ? " is-open" : "");
  return (
    <>
      <div
        className={rowCls}
        onClick={clickable ? onToggle : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      >
        <span className="ln">{n}</span>
        <span className="gmark">
          {hasAsserts ? (
            status === "pass" ? (
              <CheckCircle2 className="gstat good" aria-hidden="true" />
            ) : status === "warn" ? (
              <AlertCircle className="gstat warn" aria-hidden="true" />
            ) : (
              <XCircle className="gstat bad" aria-hidden="true" />
            )
          ) : hasReply ? (
            <MessageCircle className="gsend" aria-hidden="true" />
          ) : null}
        </span>
        <code className="ctext">{highlightTs(text)}</code>
        <span className="lbadges">
          {hasAsserts ? asserts?.map((a: Assertion, i: number) => <AssertBadge key={i} a={a} />) : null}
          {hasReply ? (
            <span className="reply-hint">{isOpen ? t("code.hide") : t("code.reply")}</span>
          ) : clickable ? (
            <ChevronRight className={`line-chev${isOpen ? " is-open" : ""}`} aria-hidden="true" />
          ) : null}
        </span>
      </div>
      {isOpen && hasReply && turn ? <ReplyPanel turn={turn} t={t} /> : null}
      {isOpen && hasAsserts && asserts ? <AssertDetail asserts={asserts} t={t} /> : null}
    </>
  );
}

/** 行尾分数徽章:judge / 带阈值的断言显示分数(过绿不过红);纯 gate 断言靠行色 + gutter 勾叉。 */
export function AssertBadge({ a }: { a: Assertion }) {
  const showPct = a.threshold !== undefined || (a.score > 0 && a.score < 1);
  if (!showPct) return null;
  return (
    <span className={`abadge ${assertTone(a)}`}>
      {formatScore(a.score)}
      {a.threshold !== undefined ? <span className="abadge-th">/{formatScore(a.threshold)}</span> : null}
    </span>
  );
}

export function ReplyPanel({ turn, t }: { turn: SourceTurn; t: T }) {
  if (!turn.replies.length) return <div className="line-detail reply-empty">{t("code.noReply")}</div>;
  return (
    <div className="line-detail reply-panel">
      {turn.replies.map((r, j) => {
        if (r.kind === "text")
          return (
            <div key={j} className="reply-assistant">
              <span className="reply-role">{t("transcript.assistant")}</span>
              <div className="reply-text">{r.text}</div>
            </div>
          );
        if (r.kind === "thinking")
          return (
            <details key={j} className="reply-think">
              <summary>{t("transcript.thinking")}</summary>
              <div className="reply-think-text">{r.text}</div>
            </details>
          );
        if (r.kind === "error")
          return <div key={j} className="reply-err">! {r.text}</div>;
        if (r.kind === "tool")
          // 和 Transcript 同一个组件:摘要行显示工具名(入参)→ 出参预览,展开看完整出入参。
          return <ToolBlock key={j} call={r.ev} result={r.result} t={t} />;
        if (r.kind === "input") return <InputBlock key={j} event={{ type: "input.requested", request: r.ev.request }} t={t} />;
        return null;
      })}
    </div>
  );
}

export function AssertDetail({ asserts, t }: { asserts: Assertion[]; t: T }) {
  return (
    <div className="line-detail assert-detail">
      {asserts.map((a: Assertion, i: number) => (
        <div key={i} className="assert-row">
          <span className={`abadge ${assertTone(a)}`}>{a.passed ? t("assert.pass") : t("assert.fail")}</span>
          <span className="assert-name">{a.name}</span>
          {a.severity === "soft" ? <span className="assert-sev">{t("assert.soft")}</span> : null}
          {a.threshold !== undefined ? (
            <span className="assert-score">
              {formatScore(a.score)} / {formatScore(a.threshold)}
            </span>
          ) : null}
          {a.detail ? <div className="assert-reason">{a.detail}</div> : null}
          {a.evidence ? (
            <details className="assert-evidence">
              <summary>{t("assert.evidence")}</summary>
              <pre className="assert-evidence-pre">{a.evidence}</pre>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * 没源码可叠时(此 run 早于 source-loc,或源码不可读:远程沙箱等)。不退回老的分组视图——
 * 用代码视图同一套视觉语言:一句说明 + checks(绿过/红不过)+ 原始会话流。重跑即可看到代码视图。
 */
export function NoSourceBody({ assertions, events, message, t }: { assertions: Assertion[]; events: TranscriptEvent[]; message?: string; t: T }) {
  const checks = assertions || [];
  return (
    <div className="nosource">
      <div className="nosource-note">
        {message ?? t("code.noSource")}
      </div>
      {checks.length ? (
        <div className="nosource-block">
          <div className="nosource-head">{t("code.checks")}</div>
          <AssertDetail asserts={checks} t={t} />
        </div>
      ) : null}
      {events?.length ? (
        <div className="nosource-block">
          <div className="nosource-head">{t("code.conversation")}</div>
          <Transcript events={events} t={t} />
        </div>
      ) : null}
    </div>
  );
}
