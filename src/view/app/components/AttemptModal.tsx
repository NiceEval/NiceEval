import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactLoadState, T } from "../shared.ts";
import type { Assertion, Span, ViewResult } from "../types.ts";
import { artifactUrl } from "../lib/artifact-url.ts";
import { asEvents, asSources, asSpans } from "../lib/guards.ts";
import { verdictClass, verdictLabel } from "../lib/verdict.ts";
import { AssertDetail, assertTone, CodeView, NoSourceBody } from "./CodeView.tsx";
import { formatScore } from "../lib/format.ts";
import { CopyAttemptPrompt } from "./CopyControls.tsx";
import { Trace } from "./Trace.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Badge } from "./ui/badge.tsx";

export function AttemptModal({ result, onClose, t }: { result: ViewResult; onClose: () => void; t: T }) {
  const allAssertions = result.assertions || [];
  const base = result.artifactBase;
  const [data, setData] = useState<ArtifactLoadState>({ sources: null, events: null, status: "loading" });
  const trace = useTraceSpans(base, result.hasTrace);

  // Esc / 焦点陷阱 / 背景滚动锁 / 点遮罩关闭 都交给 Radix Dialog;这里只保留 artifact 拉取。
  useEffect(() => {
    if (!base) { setData({ sources: null, events: null, status: "none" }); return; }
    let alive = true;
    const grab = (name: string, has?: boolean): Promise<unknown> =>
      has
        ? fetch( artifactUrl(`${base}/${name}`))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null);
    Promise.all([grab("sources.json", result.hasSources), grab("events.json", result.hasEvents)]).then(([sources, events]) => {
      if (alive) setData({ sources: asSources(sources), events: asEvents(events), status: "ready" });
    });
    return () => { alive = false; };
  }, [base, result.hasSources, result.hasEvents]);

  const verdict = result.verdict;
  const hasCode = Boolean(data.sources?.length);

  // 区块顺序对齐 docs/feature/reports/view.md「Attempt 详情」:判定与断言(errored 的结构化错误
  // 就是判定原因,归这一区)→ 紧凑时间树 → diagnostics → usage → 源码/对话 → trace 入口。
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-line px-[18px] pb-[11px] pt-[13px]">
          <div className="flex min-w-0 flex-col gap-[3px]">
            <Badge tone={verdictClass(verdict)}>{verdictLabel(verdict, t)}</Badge>
            <DialogTitle asChild>
              <span className="truncate text-sm font-[640] text-text">{result.id}</span>
            </DialogTitle>
            {result.description ? <span className="truncate text-xs text-muted">{result.description}</span> : null}
          </div>
          <CopyAttemptPrompt result={result} t={t} />
          <DialogClose
            aria-label={t("action.close")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent text-sm text-muted transition-colors hover:border-line hover:bg-panel-2 hover:text-text"
          >
            x
          </DialogClose>
        </div>
        <div className="flex-1 overflow-y-auto px-[18px] pb-[18px] pt-[14px]">
          {data.status !== "loading" && !hasCode ? <AssertionSection assertions={allAssertions} t={t} /> : null}
          {result.error ? (
            <div className="modal-error">
              <ErrorDetailBlock error={result.error} />
            </div>
          ) : null}
          {result.phases && result.phases.length > 0 ? <PhaseTimingBlock phases={result.phases} trace={trace} t={t} /> : null}
          {result.diagnostics && result.diagnostics.length > 0 ? (
            <AttemptDiagnostics diagnostics={result.diagnostics} t={t} />
          ) : null}
          <UsageDiffLine result={result} />
          {data.status === "loading" ? <div className="conv-loading">{t("trace.loading")}</div> : null}
          {hasCode ? (
            <CodeView sources={data.sources ?? []} events={data.events || []} assertions={allAssertions} t={t} />
          ) : data.status !== "loading" ? (
            // hasSources 为真却取不到 → 源码捕获过,是 artifact 文件在当前托管里缺失;和「从未捕获」分开提示。
            // 断言明细此时由断言区(detailMode)内嵌呈现,这里只保留说明与会话流,不再重复 checks。
            <NoSourceBody
              assertions={[]}
              events={data.events || []}
              message={t(result.hasSources && base ? "code.sourceUnavailable" : "code.noSource")}
              t={t}
            />
          ) : null}
          {trace.available ? (
            <FullTraceEntry trace={trace} t={t} />
          ) : data.status !== "loading" ? (
            <div className="mt-3 text-xs text-muted">
              {t("trace.enableHint")}
              <a href={t("trace.enableHintUrl")} target="_blank" rel="noreferrer" className="underline">
                {t("trace.enableHintLink")}
              </a>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── 判定与断言 ───────────────────────── */

/** 断言的源码位置标注(fallback 下无代码可跳,纯文本)。 */
function locLabel(a: Assertion): React.ReactNode {
  const loc = a.loc;
  if (!loc) return null;
  const short = loc.file.split("/").pop() ?? loc.file;
  return (
    <span className="assert-loc" title={`${loc.file}:${loc.line}`}>
      {short}:{loc.line}
    </span>
  );
}

/**
 * 断言区 = 源码视图的 fallback(见 docs/feature/reports/view.md「Attempt 详情」):断言明细
 * 单点住在源码行里,只有源码不可用(未捕获或 artifact 缺失)时这里才出现,呈现同一份事实——
 * failed / unavailable 与没过阈值的 soft 每条一行、一次展开明细,第一条 failed 默认展开;
 * passed 按 group 收进默认折叠区,只显示数量。
 */
function AssertionSection({ assertions, t }: { assertions: Assertion[]; t: T }) {
  if (!assertions.length) return null;
  const attention = assertions.filter((a) => a.outcome !== "passed");
  const passed = assertions.filter((a) => a.outcome === "passed");
  const firstFailed = attention.findIndex((a) => a.outcome === "failed");
  const openIdx = firstFailed === -1 ? 0 : firstFailed;
  const groups = new Map<string, Assertion[]>();
  for (const a of passed) {
    const g = a.groupPath?.join(" > ") ?? "";
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  return (
    <div className="attempt-asserts">
      <div className="modal-sect">{t("code.checks")}</div>
      {attention.length ? (
        <div className="attempt-asserts-open">
          {attention.map((a, i) => (
            <FailureRow key={i} a={a} defaultOpen={i === openIdx} t={t} />
          ))}
        </div>
      ) : null}
      {passed.length ? (
        <details className="asserts-passed">
          <summary>{t("assert.passedCollapsed", { count: passed.length })}</summary>
          {[...groups.entries()].map(([g, list]) => (
            <details key={g || "·"} className="asserts-passed-group">
              <summary>
                {g || "—"} · {list.length}
              </summary>
              <AssertDetail asserts={list.map(stripGroupPath)} t={t} anchor={locLabel} />
            </details>
          ))}
        </details>
      ) : null}
    </div>
  );
}

/** 折叠区已按 group 分组,行内不再重复组前缀。 */
function stripGroupPath(a: Assertion): Assertion {
  const { groupPath: _gp, ...rest } = a;
  return rest as Assertion;
}

/** fallback 断言区里的一行:标题(徽章/名字/matcher/分数/位置),明细一次展开可见。 */
function FailureRow({ a, defaultOpen, t }: { a: Assertion; defaultOpen: boolean; t: T }) {
  return (
    <details className="fail-row" open={defaultOpen || undefined}>
      <summary className="fail-sum">
        <span className={`abadge ${assertTone(a)}`}>
          {a.outcome === "unavailable" ? t("assert.unavailable") : t("assert.fail")}
        </span>
        <span className="fail-name">
          {a.groupPath?.length ? `${a.groupPath.join(" > ")} · ` : ""}
          {a.name}
        </span>
        {a.detail && a.detail !== a.name ? <span className="fail-matcher">{a.detail}</span> : null}
        {a.optional ? <span className="assert-sev">{t("assert.optional")}</span> : null}
        {a.severity === "soft" ? <span className="assert-sev">{t("assert.soft")}</span> : null}
        {a.outcome !== "unavailable" && a.threshold !== undefined ? (
          <span className="assert-score">
            {formatScore(a.score)} / {formatScore(a.threshold)}
          </span>
        ) : null}
        {locLabel(a)}
      </summary>
      <div className="fail-body">
        {a.outcome === "unavailable" ? <div className="assert-reason">{a.reason}</div> : null}
        {a.outcome !== "unavailable" && a.expected !== undefined ? (
          <div className="assert-reason">expected: {a.expected}</div>
        ) : null}
        {a.outcome !== "unavailable" && a.received !== undefined ? (
          <div className="assert-reason">received: {a.received}</div>
        ) : null}
        {a.outcome !== "unavailable" && a.evidence ? (
          <details className="assert-evidence">
            <summary>{t("assert.evidence")}</summary>
            <pre className="assert-evidence-pre">{a.evidence}</pre>
          </details>
        ) : null}
      </div>
    </details>
  );
}

/* ───────────────────────── 结构化错误与 diagnostics ───────────────────────── */

/** errored attempt 的结构化 error 明细(见 docs/feature/reports/view.md「结构化错误」)。结构化
 *  `AttemptError`:operation / code / message + 可选 cause / stack。字段标签是低层技术标识,与终端
 *  `niceeval show` 一样保持英文,不进 view 的 i18n 词典。 */
function ErrorDetailBlock({ error }: { error: NonNullable<ViewResult["error"]> }) {
  const rows: [string, string][] = [
    ["phase", error.phase],
    ["code", error.code],
    ["message", error.message],
  ];
  if (error.cause) rows.push(["cause", error.cause.name ? `${error.cause.name} · ${error.cause.message}` : error.cause.message]);
  const stack = error.stack?.replace(/\n+$/, "") ?? "";
  return (
    <div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </Fragment>
        ))}
      </dl>
      {stack ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted">{stack}</pre>
      ) : null}
    </div>
  );
}

/** attempt 级诊断,按 lifecycle 阶段分组(teardown/cleanup 等,与 verdict 独立;
 *  见 docs/feature/reports/view.md「Attempt 详情」)。 */
function AttemptDiagnostics({ diagnostics, t }: { diagnostics: NonNullable<ViewResult["diagnostics"]>; t: T }) {
  const groups = new Map<string, typeof diagnostics>();
  for (const d of diagnostics) {
    const list = groups.get(d.phase) ?? [];
    groups.set(d.phase, [...list, d]);
  }
  return (
    <div className="mt-3">
      <div className="modal-sect">{t("attempt.diagnostics")}</div>
      {[...groups.entries()].map(([phase, list]) => (
        <div key={phase} className="mt-1">
          <div className="text-[11px] text-muted">{phase}</div>
          <ul className="mt-0.5 space-y-1 pl-3">
            {list.map((d, i) => (
              <li key={i} className="text-xs">
                <span className="text-muted">
                  {d.level} · {d.code}
                </span>
                <div className="min-w-0 break-words">
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

/* ───────────────────────── 统一时间树 ───────────────────────── */

const CLOSING_PHASES = new Set(["eval.teardown", "agent.teardown", "sandbox.teardown", "sandbox.suspend", "sandbox.stop"]);

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

type PhaseEntry = NonNullable<ViewResult["phases"]>[number];
type TimingChild = NonNullable<PhaseEntry["children"]>[number];

/** trace.json 的共享按需装载:时间树的 turn 挂接与底部 trace 入口用同一份,只 fetch 一次。 */
interface TraceHook {
  available: boolean;
  status: "idle" | "loading" | "ready" | "failed";
  spans: Span[] | null;
  load: () => void;
}

function useTraceSpans(base: string | undefined, hasTrace: boolean | undefined): TraceHook {
  const [state, setState] = useState<{ spans: Span[] | null; status: TraceHook["status"] }>({ spans: null, status: "idle" });
  const started = useRef(false);
  const available = Boolean(base && hasTrace);
  const load = useCallback(() => {
    if (started.current || !base) return;
    started.current = true;
    setState({ spans: null, status: "loading" });
    fetch(artifactUrl(`${base}/trace.json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => setState({ spans: asSpans(body) ?? [], status: "ready" }))
      .catch(() => setState({ spans: null, status: "failed" }));
  }, [base]);
  return useMemo(() => ({ available, load, ...state }), [available, load, state]);
}

const seriesClass = (i: number, failed?: true): string => (failed ? "phase-seg-bad" : `phase-seg-${(i % 6) + 1}`);

/**
 * 统一时间树(见 docs/feature/reports/view.md「Attempt 详情」):主链先画一条分解条,列表里
 * 每个 phase 的 children(hook / 沙箱命令 / session/turn)默认收合、可逐个展开;首屏只占主链
 * 几行,不挤占断言区与源码。收尾段单列,不计入总耗时。
 */
function PhaseTimingBlock({ phases, trace, t }: { phases: NonNullable<ViewResult["phases"]>; trace: TraceHook; t: T }) {
  const main = phases.filter((p) => !CLOSING_PHASES.has(p.name));
  const closing = phases.filter((p) => CLOSING_PHASES.has(p.name));
  const total = main.reduce((sum, p) => sum + p.durationMs, 0);
  return (
    <div className="attempt-timing">
      <div className="modal-sect">{t("attempt.timing")}</div>
      {total > 0 ? (
        <div className="phase-bar" aria-hidden="true">
          {main.map((p, i) => (
            <div
              key={i}
              className={`phase-seg ${seriesClass(i, p.failed)}`}
              style={{ flexGrow: Math.max(p.durationMs, total / 200) }}
              title={`${p.name} ${fmtMs(p.durationMs)}`}
            />
          ))}
        </div>
      ) : null}
      <ul className="phase-list">
        {main.map((p, i) => (
          <PhaseRow key={i} phase={p} dotClass={seriesClass(i, p.failed)} trace={trace} t={t} />
        ))}
      </ul>
      {closing.length > 0 ? (
        <div className="phase-closing">
          <div className="phase-closing-head">{t("attempt.teardown")}</div>
          <ul className="phase-list">
            {closing.map((p, i) => (
              <PhaseRow key={i} phase={p} trace={trace} t={t} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PhaseRow({ phase, dotClass, trace, t }: { phase: PhaseEntry; dotClass?: string; trace: TraceHook; t: T }) {
  const kids = phase.children ?? [];
  // 失败 phase 默认展开:失败线索直接给出,其余保持收合(契约:children 默认收合)。
  const [open, setOpen] = useState(Boolean(phase.failed));
  const head = (
    <>
      {dotClass ? <span className={`phase-dot ${dotClass}`} /> : <span className="phase-dot phase-dot-none" />}
      <span className="phase-name">{phase.name}</span>
      <span className="phase-dur num">{fmtMs(phase.durationMs)}</span>
      {phase.failed ? <span className="phase-fail">✗</span> : null}
      {kids.length > 0 ? <span className="phase-kids num">{countNodes(kids)}</span> : null}
    </>
  );
  if (kids.length === 0) return <li className="phase-row">{head}</li>;
  return (
    <li>
      <details className="phase-details" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="phase-row">{head}</summary>
        {open ? (
          <ul className="timing-kids">
            {kids.map((node) => (
              <TimingNodeRow key={node.id} node={node} trace={trace} t={t} />
            ))}
          </ul>
        ) : null}
      </details>
    </li>
  );
}

function countNodes(nodes: TimingChild[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children ?? []), 0);
}

function TimingNodeRow({ node, trace, t }: { node: TimingChild; trace: TraceHook; t: T }) {
  const kids = node.children ?? [];
  // turn 带 traceId 且这次运行有 trace.json 时,展开即挂接同一轮的 agent/model/tool spans。
  const hooksTrace = node.kind === "turn" && Boolean(node.traceId) && trace.available;
  const [open, setOpen] = useState(Boolean(node.failed) && (kids.length > 0 || hooksTrace));
  const label =
    node.kind === "command" && node.command ? `shell · ${node.command.display}` : node.kind === "turn" ? `turn ${node.label}` : node.label;
  const head = (
    <>
      <span className="tnode-label" title={label}>{label}</span>
      <span className="phase-dur num">{fmtMs(node.durationMs)}</span>
      {node.failed ? <span className="phase-fail">✗</span> : null}
    </>
  );
  if (kids.length === 0 && !hooksTrace) return <li className="tnode-row">{head}</li>;
  return (
    <li>
      <details className="phase-details" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="tnode-row">{head}</summary>
        {open ? (
          <>
            {kids.length > 0 ? (
              <ul className="timing-kids">
                {kids.map((child) => (
                  <TimingNodeRow key={child.id} node={child} trace={trace} t={t} />
                ))}
              </ul>
            ) : null}
            {hooksTrace ? <TurnSpans traceId={node.traceId!} trace={trace} t={t} /> : null}
          </>
        ) : null}
      </details>
    </li>
  );
}

function TurnSpans({ traceId, trace, t }: { traceId: string; trace: TraceHook; t: T }) {
  useEffect(() => { trace.load(); }, [trace]);
  if (trace.status === "idle" || trace.status === "loading") return <div className="tnode-meta">{t("trace.loading")}</div>;
  if (trace.status === "failed") return <div className="tnode-meta">{t("trace.loadFailed")}</div>;
  const spans = (trace.spans ?? []).filter((s) => s.traceId === traceId);
  if (!spans.length) return <div className="tnode-meta">{t("trace.noSpans")}</div>;
  return (
    <div className="tnode-trace">
      <Trace spans={spans} t={t} />
    </div>
  );
}

/** 底部 trace 入口:被测 agent 的完整原始 span 瀑布,与时间树共享同一次 trace.json 拉取。 */
function FullTraceEntry({ trace, t }: { trace: TraceHook; t: T }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="trace-details"
      open={open}
      onToggle={(e) => {
        const isOpen = e.currentTarget.open;
        setOpen(isOpen);
        if (isOpen) trace.load();
      }}
    >
      <summary>{t("trace.timing")}</summary>
      <div className="trace-slot">
        {trace.status === "failed" ? (
          <div className="trace-span-meta">{t("trace.loadFailed")}</div>
        ) : trace.status !== "ready" ? (
          <div className="trace-span-meta">{t("trace.loading")}</div>
        ) : (
          <Trace spans={trace.spans ?? []} t={t} />
        )}
      </div>
    </details>
  );
}

/* ───────────────────────── usage 行 ───────────────────────── */

/** usage / sandbox 元信息 chips(见 docs/feature/reports/view.md「Attempt 详情」)。 */
function UsageDiffLine({ result }: { result: ViewResult }) {
  const chips: React.ReactNode[] = [];
  if (result.usage) {
    const tok = result.usage.inputTokens + result.usage.outputTokens;
    chips.push(
      <span className="meta-chip" key="usage">
        usage <b>{tok.toLocaleString()} tok</b>
        {result.usage.costUSD !== undefined ? <> · ${result.usage.costUSD.toFixed(4)}</> : null}
      </span>,
    );
  }
  if (result.sandbox) {
    chips.push(
      <span className="meta-chip" key="sandbox">
        sandbox <b>{result.sandbox.provider}</b> · {result.sandbox.sandboxId}
        {result.sandbox.kept ? " · kept" : ""}
      </span>,
    );
  }
  if (chips.length === 0) return null;
  return <div className="meta-chips">{chips}</div>;
}
