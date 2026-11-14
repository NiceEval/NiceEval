// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import { inspectionByteContinuation } from "./continuation.ts";
import { inspectionShellWord as word, inspectionIdAspect } from "./addressing.ts";
import type { InspectionLink, InspectionOperation } from "./protocol.ts";

/** Navigation is a bounded projection of identities already exposed by this result. */
export function inspectionLinks(operation: InspectionOperation, document: unknown): readonly InspectionLink[] {
  const links: InspectionLink[] = [];
  const seen = new Set<string>();
  const add = (rel: InspectionLink["rel"], args: readonly string[]) => {
    const command = "niceeval show " + args.map(word).join(" ");
    if (seen.has(command)) return;
    if (links.length >= 256) {
      if (rel !== "next-page") return;
      links.pop();
    }
    seen.add(command);
    links.push(Object.freeze({ rel, command }));
  };
  const locator = "locator" in operation ? operation.locator : undefined;
  if (locator !== undefined && operation.kind === "attempt.get") {
    for (const rel of ["execution", "diff", "source", "timing", "usage"] as const) add(rel, [locator, rel]);
  }
  const visit = (value: unknown): void => {
    if (links.length >= 256 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && child.length > 0) {
        if (["locator", "attemptLocator"].includes(key) && child.startsWith("@")) add("attempt", [child]);
        if (["runId", "originRunId", "sourceRunId"].includes(key)) add("run", [`run:${child}`]);
        if (key === "experimentId") add("experiment", [`exp:${child}`]);
        if (locator !== undefined) {
          if (key === "entryId") add("assertion", [locator, child, "--full"]);
          if (key === "changeId") add("file-change", [locator, child]);
          if (key === "artifactId" && child.startsWith("art_")) add("artifact", [locator, child]);
          if (
            ["itemId", "toolOccurrenceId", "commandId", "eventId", "evidenceId", "turnId", "contentId", "id"].includes(
              key,
            ) &&
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
    const continuation =
      operation.kind === "run.list"
        ? Reflect.get(document, "continuation")
        : operation.kind === "attempt.trace"
          ? Reflect.get(Reflect.get(document, "trace")?.execution ?? {}, "continuation")
          : undefined;
    if (typeof continuation === "string")
      add("next-page", [
        ...(operation.kind === "run.list" ? ["runs"] : [locator!, "execution"]),
        ...(operation.kind === "attempt.trace" && operation.actorId !== undefined
          ? ["--actor", operation.actorId]
          : []),
        ...(operation.kind === "attempt.trace" && operation.eventType !== undefined
          ? ["--type", operation.eventType]
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
  return Object.freeze(links);
}
