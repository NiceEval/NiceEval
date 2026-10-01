import { useEffect, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Result } from "effect";
import { useTranslation } from "react-i18next";

import { decodeInspectionOperation, type InspectionOperationFor, type InspectionSuccessDocumentFor } from "@niceeval/inspection/public.ts";
import { useCurrentGeneration, useInspectionQuery } from "../../data/index.ts";
import { attemptOperations } from "../../data/operations.ts";

type Outline = InspectionSuccessDocumentFor<"attempt.trace">["trace"]["execution"];
type Selector = InspectionOperationFor<"attempt.trace.detail">["selector"];
type PreviewBlock = Extract<Outline["events"][number]["display"], { state: "present" }>["blocks"][number];
type DetailBlock = NonNullable<Extract<InspectionSuccessDocumentFor<"attempt.trace.detail">["detail"], { kind: "execution-event" }>["event"]["display"]>[number];
type ImageBlock = Extract<PreviewBlock, { kind: "image" }>;
const MAX_INLINE_IMAGE_BYTES = 16 * 1024 * 1024;

function DisplayImage({ locator, block }: { readonly locator: string; readonly block: ImageBlock }): ReactElement {
  const { t } = useTranslation();
  const generation = useCurrentGeneration();
  const element = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string>();
  const [decodeFailed, setDecodeFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (element.current !== null) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const bytes = useQuery({
    queryKey: ["execution-display-image", generation.identity, locator, block.artifactId],
    enabled: visible && block.byteLength <= MAX_INLINE_IMAGE_BYTES,
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const output = new Uint8Array(block.byteLength);
      let offset = 0;
      do {
        const operation = decodeInspectionOperation({
          kind: "attempt.artifact", locator, artifactId: block.artifactId, offset, limit: 256 * 1024,
        });
        if (Result.isFailure(operation) || operation.success.kind !== "attempt.artifact") throw new Error("Image artifact request is invalid.");
        const { artifact } = await generation.inspectRepository<"attempt.artifact">(operation.success);
        if (artifact.state !== "available" || artifact.byteLength !== block.byteLength ||
          artifact.mediaType !== block.mediaType || artifact.sha256 !== block.sha256 || artifact.offset !== offset) {
          throw new Error("Image artifact does not match the sealed display descriptor.");
        }
        const chunk = Uint8Array.from(atob(artifact.base64), (character) => character.charCodeAt(0));
        if (offset + chunk.byteLength > output.byteLength || chunk.byteLength === 0 && offset < output.byteLength) {
          throw new Error("Image artifact byte range is invalid.");
        }
        output.set(chunk, offset);
        offset += chunk.byteLength;
        if (artifact.nextOffset === null) {
          if (offset !== output.byteLength) throw new Error("Image artifact is incomplete.");
          break;
        }
        if (artifact.nextOffset !== offset || offset >= output.byteLength) throw new Error("Image artifact continuation is invalid.");
      } while (offset < output.byteLength);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", output));
      const sha256 = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (sha256 !== block.sha256) throw new Error("Image artifact bytes do not match the sealed digest.");
      return output;
    },
  });
  useEffect(() => {
    setDecodeFailed(false);
    setUrl(undefined);
    if (bytes.data === undefined) return;
    const nextUrl = URL.createObjectURL(new Blob([bytes.data], { type: block.mediaType }));
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [bytes.data, block.mediaType]);
  return <figure ref={element}>
    {url === undefined || decodeFailed ? <p>{block.alt}</p> : <img src={url} alt={block.alt} style={{ maxWidth: "100%" }} onError={() => setDecodeFailed(true)} />}
    <figcaption>{block.mediaType} · {block.byteLength} bytes · <code>{block.artifactId}</code></figcaption>
    {decodeFailed ? <p>{t("executionTrace.imageDecodeFailed")}</p> : null}
    {bytes.isError ? <p role="alert">{bytes.error.message}</p> : null}
    {block.byteLength > MAX_INLINE_IMAGE_BYTES ? <>
      <p>{t("executionTrace.imageTooLarge")}</p>
      <pre>{JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator, artifactId: block.artifactId } }, null, 2)}</pre>
    </> : null}
  </figure>;
}

function DisplayBlock({ locator, block }: { readonly locator: string; readonly block: PreviewBlock | DetailBlock }): ReactElement {
  const { t } = useTranslation();
  const renderText = (value: string | { readonly preview: string; readonly omittedBytes: number }) => <>
    {typeof value === "string" ? value : value.preview}
    {typeof value === "string" || value.omittedBytes === 0 ? null : <span> {t("executionTrace.moreBytes", { count: value.omittedBytes })}</span>}
  </>;
  switch (block.kind) {
    case "text": return <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{renderText(block.text)}</p>;
    case "message": return <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{block.speaker ?? block.role}: </strong>{renderText(block.text)}</p>;
    case "fields": return <dl>{block.fields.map((field, index) => <div key={index}>
      <dt>{field.label}</dt>
      <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{typeof field.value === "object" && field.value !== null
        ? renderText(field.value) : typeof field.value === "string" ? field.value : JSON.stringify(field.value)}</dd>
    </div>)}</dl>;
    case "code": return <pre style={{ overflow: "auto", whiteSpace: "pre" }}><code>{renderText(block.text)}</code></pre>;
    case "image": return <DisplayImage locator={locator} block={block} />;
  }
}

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
    {(detail.event.display ?? []).map((block, index) => <DisplayBlock key={index} locator={locator} block={block} />)}
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
        {event.display.state === "absent" ? null : event.display.blocks.map((block, index) => <DisplayBlock key={index} locator={locator} block={block} />)}
        {event.scopeMemberships.map((scope) => <span key={scope.scopeId}>{scope.scopeId}: {scope.state}{" "}</span>)}
      </li>)}</ol>
      {outline.hasMore ? <p>{t("executionTrace.omitted", { count: outline.omittedEventCount })}</p> : null}
      {outline.continuation === undefined ? null : <button type="button" onClick={() => setContinuation(outline.continuation)}>{t("executionTrace.nextPage")}</button>}
    </>}
    {continuation === undefined ? null : <button type="button" onClick={() => setContinuation(undefined)}>{t("executionTrace.firstPage")}</button>}
    {selector === undefined ? null : <TraceDetail locator={locator} selector={selector} select={setSelector} />}
  </section>;
}
