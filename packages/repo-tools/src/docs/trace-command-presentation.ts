import type { TraceCoordinationError, TraceError } from "./trace/index.js";

const TRACE_RECOVERY_COMMAND = "pnpm run repo docs trace recover";

type DocsTraceCommandError = TraceError | TraceCoordinationError;

export function renderDocsTraceError(error: DocsTraceCommandError): string {
  switch (error._tag) {
    case "TraceIoError":
      return `${error._tag}: ${error.operation} ${error.path}: ${error.message}`;
    case "TraceFormatError":
      return `${error._tag}: ${error.path} (${error.subject}): ${error.message}`;
    case "TraceSelectorMissing":
      return `${error._tag}: no ${error.subject} matches ${JSON.stringify(error.selector)}; run pnpm run repo docs ${error.subject} list`;
    case "TraceSelectorAmbiguous":
      return `${error._tag}: ${JSON.stringify(error.selector)} is ambiguous:\n${error.candidates.map((candidate) => `  ${candidate}`).join("\n")}`;
    case "TraceSnapshotChanged":
      return `${error._tag}: docs trace generation changed from ${error.before} to ${error.after} while compiling ${error.path} after ${error.attempts} attempts; retry after the active relation mutation finishes`;
    case "TraceMutationActive":
      return `${error._tag}: docs trace mutation is active at ${error.path} after ${error.attempts} attempts; retry after it finishes`;
    case "TraceInputChanged":
      return `${error._tag}: trace inputs changed while compiling ${error.path} after ${error.attempts} attempts (${error.changed.join(", ")}); retry after the files stop changing`;
    case "TraceRecoveryRequired":
      return `${error._tag}: unfinished Trace publication at ${error.path}; run ${TRACE_RECOVERY_COMMAND}`;
    case "TraceRecoveryConflict":
      return `${error._tag}: ${error.path}: ${error.message}`;
    case "TraceMutationError":
      return `${error._tag}: ${error.operation} failed during ${error.phase}${error.path === undefined ? "" : ` at ${error.path}`}: ${error.message}`;
  }
}

export function docsTraceErrorDocument(error: DocsTraceCommandError): object {
  switch (error._tag) {
    case "TraceIoError":
      return { _tag: error._tag, operation: error.operation, path: error.path, message: error.message };
    case "TraceFormatError":
      return { _tag: error._tag, path: error.path, subject: error.subject, message: error.message };
    case "TraceSelectorMissing":
      return { _tag: error._tag, selector: error.selector, subject: error.subject };
    case "TraceSelectorAmbiguous":
      return { _tag: error._tag, selector: error.selector, candidates: error.candidates };
    case "TraceSnapshotChanged":
      return {
        _tag: error._tag,
        path: error.path,
        before: error.before,
        after: error.after,
        attempts: error.attempts,
      };
    case "TraceMutationActive":
      return { _tag: error._tag, path: error.path, attempts: error.attempts };
    case "TraceInputChanged":
      return { _tag: error._tag, path: error.path, attempts: error.attempts, changed: error.changed };
    case "TraceRecoveryRequired":
      return { _tag: error._tag, path: error.path, nextStep: TRACE_RECOVERY_COMMAND };
    case "TraceRecoveryConflict":
      return { _tag: error._tag, path: error.path, message: error.message };
    case "TraceMutationError":
      return {
        _tag: error._tag,
        operation: error.operation,
        phase: error.phase,
        ...(error.path === undefined ? {} : { path: error.path }),
        message: error.message,
      };
  }
}

export function renderTraceFailure(error: DocsTraceCommandError, json: boolean): string {
  return json
    ? `${JSON.stringify({ ok: false, error: docsTraceErrorDocument(error) }, null, 2)}\n`
    : `${renderDocsTraceError(error)}\n`;
}
