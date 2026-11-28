// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import { inspectionByteContinuation } from "./continuation.ts";
import { inspectionShellWord as word, inspectionIdAspect } from "./addressing.ts";
import type { InspectionLink, InspectionOperation } from "./protocol.ts";

function option(flag: string, value: string): readonly string[] {
  return value.startsWith("-") ? [flag + "=" + value] : [flag, value];
}

/** Projects navigation from the identities already exposed by this result page. */
export function inspectionLinks(operation: InspectionOperation, document: unknown): readonly InspectionLink[] {
  const links: InspectionLink[] = [];
  const seen = new Set<string>();
  const add = (rel: InspectionLink["rel"], args: readonly string[]) => {
    const command = "niceeval show " + args.map(word).join(" ");
    if (seen.has(command)) return;
    seen.add(command);
    links.push({ rel, command });
  };
  const locator = "locator" in operation ? operation.locator : undefined;
  if (locator !== undefined && operation.kind === "attempt.get") {
    for (const rel of ["execution", "diff", "source", "timing", "usage"] as const) add(rel, [locator, rel]);
  }
  if (operation.kind === "attempt.assertion.detail") add("attempt", [operation.locator]);
  if (
    operation.kind === "attempt.assertions" &&
    document !== null &&
    typeof document === "object" &&
    Reflect.get(document, "assertions")?.length === 0
  ) {
    add("execution", [operation.locator, "execution"]);
  }
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "archive" && (operation.kind === "attempt.trace" || operation.kind === "attempt.trace.detail"))
        continue;
      if (typeof child === "string" && child.length > 0) {
        if (["locator", "attemptLocator"].includes(key) && child.startsWith("@")) add("attempt", [child]);
        if (["runId", "originRunId", "sourceRunId"].includes(key)) add("run", [`run:${child}`]);
        if (key === "experimentId") add("experiment", [`exp:${child}`]);
        if (locator !== undefined) {
          if (
            key === "entryId" &&
            !(
              operation.kind === "attempt.assertion.detail" &&
              operation.entryId === child &&
              operation.projection !== "compact"
            )
          )
            add("assertion", [locator, child, "--full"]);
          if (key === "changeId") add("file-change", [locator, child]);
          if (key === "artifactId" && child.startsWith("art_")) add("artifact", [locator, child]);
          if (
            ["itemId", "toolOccurrenceId", "commandId", "eventId", "evidenceId", "turnId", "contentId", "id"].includes(
              key,
            ) &&
            operation.kind !== "attempt.trace.keys" &&
            inspectionIdAspect(child) === "execution"
          )
            add("execution-item", [locator, child]);
        }
      }
      visit(child);
    }
  };
  visit(document);
  if (document !== null && typeof document === "object") {
    const nextPage = (body: unknown, args: readonly string[]) => {
      if (body === null || typeof body !== "object") return;
      const continuation = Reflect.get(body, "continuation");
      if (typeof continuation === "string") add("next-page", [...args, "--continuation", continuation]);
    };
    if (operation.kind === "attempt.trace.keys") {
      nextPage(document, [
        operation.locator,
        "execution",
        "keys",
        ...option("--trace", operation.traceId),
        ...(operation.keys ?? []).flatMap((key) => option("--key", key)),
      ]);
      const first = Reflect.get(document, "rows")?.find((row: { readonly kind: string }) => row.kind === "event");
      if (typeof first?.eventId === "string") add("execution-item", [operation.locator, first.eventId]);
    } else if (operation.kind === "attempt.assertion.detail") {
      nextPage(Reflect.get(document, "assertion"), [
        operation.locator,
        operation.entryId,
        ...(operation.projection === "compact" ? [] : ["--full"]),
      ]);
    } else if (operation.kind === "attempt.usage") {
      nextPage(Reflect.get(document, "usage"), [operation.locator, "usage"]);
    } else if (operation.kind === "experiment.get") {
      nextPage(Reflect.get(document, "experiment")?.modelUsage, [`exp:${operation.experimentId}`]);
    } else if (operation.kind === "experiments.assertions") {
      nextPage(Reflect.get(document, "matrix"), [
        ...[...new Set(operation.experimentIds)].sort().map((id) => `exp:${id}`),
        "assertions",
        ...(operation.evalIdPrefix === undefined ? [] : ["--eval", operation.evalIdPrefix]),
      ]);
    }
  }
  if (operation.kind === "attempt.diff" && document !== null && typeof document === "object") {
    const continuation = Reflect.get(document, "diff")?.continuation;
    if (typeof continuation === "string") {
      add("next-page", [operation.locator, operation.changeId ?? "diff", "--continuation", continuation]);
    }
  }
  if (document !== null && typeof document === "object") {
    const continuation =
      operation.kind === "run.list"
        ? Reflect.get(document, "continuation")
        : operation.kind === "attempt.trace"
          ? Reflect.get(Reflect.get(document, "trace")?.execution ?? {}, "continuation")
          : operation.kind === "attempt.timing"
            ? Reflect.get(Reflect.get(document, "timing") ?? {}, "continuation")
            : undefined;
    if (typeof continuation === "string")
      add("next-page", [
        ...(operation.kind === "run.list"
          ? ["runs"]
          : [locator!, operation.kind === "attempt.timing" ? "timing" : "execution"]),
        ...(operation.kind === "attempt.trace" && operation.traceId !== undefined
          ? option("--trace", operation.traceId)
          : []),
        ...(operation.kind === "attempt.trace" && operation.fromEventId !== undefined
          ? ["--from", operation.fromEventId]
          : []),
        ...(operation.kind === "attempt.trace" && operation.actorId !== undefined
          ? option("--actor", operation.actorId)
          : []),
        ...(operation.kind === "attempt.trace" && operation.eventType !== undefined
          ? option("--type", operation.eventType)
          : []),
        "--continuation",
        continuation,
      ]);
  }
  if (locator !== undefined && document !== null && typeof document === "object") {
    const body =
      operation.kind === "attempt.artifacts"
        ? Reflect.get(document, "artifacts")?.collection
        : operation.kind === "attempt.artifact"
          ? Reflect.get(document, "artifact")
          : operation.kind === "attempt.trace.detail"
            ? Reflect.get(document, "detail")
            : undefined;
    const id =
      operation.kind === "attempt.artifacts"
        ? "artifacts"
        : operation.kind === "attempt.artifact"
          ? operation.artifactId
          : operation.kind === "attempt.trace.detail" && operation.selector.kind === "execution-evidence"
            ? operation.selector.evidenceId
            : undefined;
    if (id !== undefined && body !== null && typeof body === "object" && typeof body.nextOffset === "number") {
      const source = Reflect.get(document, "source");
      const token = inspectionByteContinuation(
        { source: source.kind, cutoff: source.publicationCutoffIdentity, locator, id },
        body.nextOffset,
      );
      add("next-page", [locator, id, "--continuation", token]);
    }
  }
  return links;
}
