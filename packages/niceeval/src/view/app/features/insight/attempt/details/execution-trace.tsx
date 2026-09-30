import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type { InspectionOperationFor, InspectionSuccessDocumentFor } from "@niceeval/inspection/public.ts";
import { useInspectionQuery } from "../../data/index.ts";
import { attemptOperations } from "../../data/operations.ts";

type Outline = InspectionSuccessDocumentFor<"attempt.trace">["trace"]["execution"];
type Selector = InspectionOperationFor<"attempt.trace.detail">["selector"];

function utf8Preview(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
}

function TraceDetail({ locator, selector, select }: {
  readonly locator: string;
  readonly selector: Selector;
  readonly select: (selector: Selector) => void;
}): ReactElement {
  const { t } = useTranslation();
  const query = useInspectionQuery<"attempt.trace.detail">({ kind: "attempt.trace.detail", locator, selector });
  if (query.isPending) return <p role="status">{t("report.loadingDetails")}</p>;
  if (query.isError) return <div role="alert"><p>{query.error.message}</p><button type="button" onClick={() => void query.refetch()}>{t("report.retry")}</button></div>;
  const detail = query.data.detail;
  if (detail.kind === "execution-evidence") return <div>
    <h4>{detail.label}</h4>
    <p><code>{detail.evidenceId}</code> · <code>{detail.pointer}</code></p>
    <p>{t("executionTrace.byteRange", { offset: detail.offset, total: detail.targetByteLength })} · SHA-256 <code>{detail.targetSha256}</code></p>
    <pre style={{ maxHeight: "28rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{utf8Preview(detail.base64)}</pre>
    {detail.nextOffset === null ? null : <button type="button" onClick={() => select({ kind: "execution-evidence", evidenceId: detail.evidenceId, offset: detail.nextOffset!, limit: 65536 })}>{t("executionTrace.nextBytes")}</button>}
  </div>;
  if (detail.kind !== "execution-event") return <pre>{JSON.stringify(detail, null, 2)}</pre>;
  return <div>
    <h4>{detail.event.summary}</h4>
    <pre style={{ maxHeight: "28rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(detail.event, null, 2)}</pre>
    {detail.evidence.map((evidence) => <div key={evidence.evidenceId}>
      <h5>{evidence.label}</h5>
      <p><code>{evidence.pointer}</code> · <code>{evidence.evidenceId}</code>{evidence.truncated ? ` ${t("attempt.truncated")}` : ""}</p>
      <pre style={{ maxHeight: "16rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{utf8Preview(evidence.base64)}</pre>
      <button type="button" onClick={() => select({ kind: "execution-evidence", evidenceId: evidence.evidenceId })}>{t("executionTrace.openEvidence")}</button>
    </div>)}
  </div>;
}

/** A bounded first-party renderer over the same closed facts consumed by show. */
export function ExecutionTrace({ locator, initial }: { readonly locator: string; readonly initial: Outline }): ReactElement | null {
  const { t } = useTranslation();
  const [continuation, setContinuation] = useState<string>();
  const [selector, setSelector] = useState<Selector>();
  const [identity, setIdentity] = useState("");
  const page = useInspectionQuery<"attempt.trace">(continuation === undefined ? null : { ...attemptOperations(locator)[1], continuation });
  const outline = continuation === undefined ? initial : page.data?.trace.execution;
  if (initial.state === "not-recorded") return null;
  return <section aria-label={t("executionTrace.title")} className="niceeval-col">
    <h3>{t("executionTrace.title")}</h3>
    <p>{initial.state}</p>
    {initial.limitations.length === 0 ? null : <pre>{JSON.stringify(initial.limitations, null, 2)}</pre>}
    {initial.traces.map((trace) => <details key={trace.traceId}>
      <summary>{trace.sourceTraceId} · {trace.collection.state} · {trace.eventCount}</summary>
      <pre style={{ maxHeight: "16rem", overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify({ schema: trace.schema, collection: trace.collection, scopes: trace.scopes }, null, 2)}</pre>
    </details>)}
    <form onSubmit={(event) => { event.preventDefault(); if (identity.trim()) setSelector({ kind: "execution-event", eventId: identity.trim() }); }}>
      <label>{t("executionTrace.stableId")} <input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>{" "}
      <button type="submit" disabled={!identity.trim()}>{t("executionTrace.openEvent")}</button>{" "}
      <button type="button" disabled={!identity.trim()} onClick={() => setSelector({ kind: "execution-evidence", evidenceId: identity.trim() })}>{t("executionTrace.openEvidence")}</button>
    </form>
    {continuation !== undefined && page.isPending ? <p role="status">{t("report.loadingDetails")}</p> : null}
    {page.isError ? <div role="alert"><p>{page.error.message}</p><button type="button" onClick={() => void page.refetch()}>{t("report.retry")}</button></div> : null}
    {outline === undefined ? null : <>
      <ol>{outline.events.map((event) => <li key={event.eventId}>
        <button type="button" onClick={() => setSelector({ kind: "execution-event", eventId: event.eventId })}>{event.summary || event.type}</button>
        <p><code>{event.eventId}</code> · {event.actor?.label ?? event.actor?.id ?? event.source.id} · {event.type}{event.time === undefined ? "" : ` · ${event.time.clockId}: ${event.time.value} ${event.time.unit}`}</p>
        {event.scopeMemberships.map((scope) => <span key={scope.scopeId}>{scope.scopeId}: {scope.state}{" "}</span>)}
      </li>)}</ol>
      {outline.hasMore ? <p>{t("executionTrace.omitted", { count: outline.omittedEventCount })}</p> : null}
      {outline.continuation === undefined ? null : <button type="button" onClick={() => setContinuation(outline.continuation)}>{t("executionTrace.nextPage")}</button>}
    </>}
    {continuation === undefined ? null : <button type="button" onClick={() => setContinuation(undefined)}>{t("executionTrace.firstPage")}</button>}
    {selector === undefined ? null : <TraceDetail locator={locator} selector={selector} select={setSelector} />}
  </section>;
}
