import { useEffect, useState } from "react";
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

  // Esc / 焦点陷阱 / 背景滚动锁 / 点遮罩关闭 都交给 Radix Dialog;这里只保留工件拉取。
  useEffect(() => {
    if (!base) { setData({ sources: null, events: null, status: "none" }); return; }
    let alive = true;
    const grab = (name: string, has?: boolean): Promise<unknown> =>
      has
        ? fetch(artifactUrl(`${base}/${name}`))
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
          {result.error ? <div className="modal-error">{result.error}</div> : null}
          {data.status === "loading" ? <div className="conv-loading">{t("trace.loading")}</div> : null}
          {hasCode ? (
            <CodeView sources={data.sources ?? []} events={data.events || []} assertions={allAssertions} t={t} />
          ) : data.status !== "loading" ? (
            // hasSources 为真却取不到 → 源码捕获过,是工件文件在当前托管里缺失;和「从未捕获」分开提示。
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
