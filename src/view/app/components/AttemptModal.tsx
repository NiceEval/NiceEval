import { Fragment, useEffect, useState } from "react";
import type { ArtifactLoadState, T } from "../shared.ts";
import type { ViewResult } from "../types.ts";
import { artifactUrl } from "../lib/artifact-url.ts";
import { asEvents, asSources } from "../lib/guards.ts";
import { verdictClass, verdictLabel } from "../lib/verdict.ts";
import { CodeView, NoSourceBody } from "./CodeView.tsx";
import { CopyAttemptPrompt } from "./CopyControls.tsx";
import { LazyArtifact } from "./LazyArtifact.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Badge } from "./ui/badge.tsx";

export function AttemptModal({ result, onClose, t }: { result: ViewResult; onClose: () => void; t: T }) {
  const allAssertions = result.assertions || [];
  const base = result.artifactBase;
  const [data, setData] = useState<ArtifactLoadState>({ sources: null, events: null, status: "loading" });

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
          {result.error ? (
            <div className="modal-error">
              <ErrorDetailBlock error={result.error} />
            </div>
          ) : null}
          {result.diagnostics && result.diagnostics.length > 0 ? (
            <AttemptDiagnostics diagnostics={result.diagnostics} />
          ) : null}
          {data.status === "loading" ? <div className="conv-loading">{t("trace.loading")}</div> : null}
          {hasCode ? (
            <CodeView sources={data.sources ?? []} events={data.events || []} assertions={allAssertions} t={t} />
          ) : data.status !== "loading" ? (
            // hasSources 为真却取不到 → 源码捕获过,是 artifact 文件在当前托管里缺失;和「从未捕获」分开提示。
            <NoSourceBody
              assertions={allAssertions}
              events={data.events || []}
              message={t(result.hasSources && base ? "code.sourceUnavailable" : "code.noSource")}
              t={t}
            />
          ) : null}
          {result.hasTrace && base ? (
            <LazyArtifact type="trace" src={`${base}/trace.json`} t={t} />
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

/** errored attempt 的结构化 error 明细(见 docs/feature/reports/view.md「结构化错误」)。结构化
 *  `AttemptError`:operation / code / message + 可选 cause / stack。字段标签是低层技术标识,与终端
 *  `niceeval show` 一样保持英文,不进 view 的 i18n 词典。 */
function ErrorDetailBlock({ error }: { error: NonNullable<ViewResult["error"]> }) {
  const rows: [string, string][] = [
    ["operation", error.operation],
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

/** attempt 级诊断(teardown/cleanup 等,与 verdict 独立;见 docs/feature/reports/view.md)。 */
function AttemptDiagnostics({ diagnostics }: { diagnostics: NonNullable<ViewResult["diagnostics"]> }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-[640] text-text">diagnostics</div>
      <ul className="mt-1 space-y-1">
        {diagnostics.map((d, i) => (
          <li key={i} className="text-xs">
            <span className="text-muted">
              {d.level} · {d.operation} · {d.code}
            </span>
            <div className="min-w-0 break-words">
              {d.message}
              {d.count && d.count > 1 ? ` (${d.count} occurrences)` : ""}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
