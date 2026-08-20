import { Either, ParseResult, Schema } from "effect";
import {
  AssertionEntryIdSchema,
  AssertionsExactParseOptions,
  MAX_ASSERTION_DOCUMENT_BYTES,
  isAssertionsRawDataGraph,
} from "./codec.ts";
import type {
  BoundedJsonObject,
  BoundedJsonValue,
  AssertionDisplay,
  AssertionEntryId,
  AssertionEntry,
  AssertionLimitation,
  AssertionMaterial,
  AssertionCoverage,
  AssertionsDocument,
  SealedAssertionResult,
  WritableCriterionEnvelope,
} from "./model.ts";

export interface AssertionEntryInput<BlobRef> {
  readonly display: AssertionDisplay;
  readonly criterion: WritableCriterionEnvelope;
  readonly subject: AssertionMaterial<BlobRef>;
  readonly evidence: readonly AssertionMaterial<BlobRef>[];
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
  readonly result: SealedAssertionResult;
}

export interface AssertionsEntryIdSource {
  /** Must return a fresh `ae_[a-z0-9]{20}` candidate for this Attachment. */
  readonly next: () => string;
}

export type AssertionsProducerError =
  | {
      readonly code: "assertion-entry-id-invalid";
      readonly entryId: string;
    }
  | {
      readonly code: "assertion-entry-id-duplicate";
      readonly entryId: string;
    }
  | { readonly code: "assertions-document-sealed" }
  | {
      readonly code: "assertions-document-invalid";
      readonly message: string;
    };

const UTF8 = new TextEncoder();

function encodedBytes(value: unknown): number {
  return UTF8.encode(JSON.stringify(value)).byteLength;
}

const DIAGNOSTIC_ROOT_KEYS = Object.freeze([
  "code",
  "message",
  "path",
  "expected",
  "received",
  "reason",
  "locator",
] as const);

function compactDiagnostic(
  diagnostic: BoundedJsonObject,
  mode: "root" | "minimal",
): BoundedJsonObject {
  if (mode === "minimal") {
    return Object.freeze({
      code: "diagnostic-truncated",
      message: "matcher diagnostic details were omitted to fit the Assertions document limit",
      path: Object.freeze([]),
      truncation: Object.freeze({
        code: "diagnostic-truncated",
        reason: "document-limit",
      }),
    });
  }
  const root: globalThis.Record<string, BoundedJsonValue> = {};
  for (const key of DIAGNOSTIC_ROOT_KEYS) {
    const value = diagnostic[key];
    if (value !== undefined) root[key] = value;
  }
  root.truncation = Object.freeze({
    code: "diagnostic-truncated",
    reason: "document-limit",
  });
  return Object.freeze(root);
}

function replaceDiagnostic(
  result: SealedAssertionResult,
  mode: "root" | "minimal",
): SealedAssertionResult {
  if (result.diagnostic === undefined) return result;
  const diagnostic = compactDiagnostic(result.diagnostic, mode);
  switch (result.state) {
    case "matched": return Object.freeze({ ...result, diagnostic });
    case "mismatched": return Object.freeze({ ...result, diagnostic });
    case "unavailable": return Object.freeze({ ...result, diagnostic });
    case "errored": return Object.freeze({ ...result, diagnostic });
    case "not-applicable": return Object.freeze({ ...result, diagnostic });
  }
}

function compactEntries<BlobRef>(
  entries: readonly AssertionEntry<BlobRef>[],
  mode: "root" | "minimal",
): readonly AssertionEntry<BlobRef>[] {
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    result: replaceDiagnostic(entry.result, mode),
  })));
}

function invalidDocument(message: string): AssertionsProducerError {
  return Object.freeze({ code: "assertions-document-invalid" as const, message });
}

function firstSchemaIssue(error: ParseResult.ParseError): string | undefined {
  try {
    const issue = ParseResult.ArrayFormatter.formatErrorSync(error)[0];
    if (issue === undefined) return undefined;
    const path = issue.path.length === 0 ? "document" : issue.path.map(String).join(".");
    const expected = issue.message.split(", actual ", 1)[0] ?? issue.message;
    const message = expected.length <= 512
      ? expected
      : `${expected.slice(0, 511)}…`;
    return `${path}: ${message}`;
  } catch {
    return undefined;
  }
}

export interface AssertionsDocumentBuilder<BlobRef> {
  /** Appends exactly one completed Assertion in declaration/display order. */
  readonly append: (
    entry: AssertionEntryInput<BlobRef>,
  ) => Either.Either<AssertionEntryId, AssertionsProducerError>;
  /**
   * Checks the writer-only exact document schema once and prevents subsequent
   * appends. Repeated calls return the same sealed document without running
   * an evaluator or minting another entry ID.
   */
  readonly seal: (input?: { readonly maximumBytes?: number }) => Either.Either<
    AssertionsDocument<BlobRef>,
    AssertionsProducerError
  >;
}

/**
 * Assertion producers own normalization and ID allocation. This builder owns
 * neither Record paths nor blob streams: the later Attachment adapter supplies
 * Record's local builder, so an entry cannot borrow another Attachment's ref.
 */
export function createAssertionsDocumentBuilder<BlobRef, Encoded>(input: {
  readonly documentSchema: Schema.Schema<AssertionsDocument<BlobRef>, Encoded>;
  readonly entryIds: AssertionsEntryIdSource;
}): AssertionsDocumentBuilder<BlobRef> {
  const entryIds = new Set<string>();
  const entries: AssertionEntry<BlobRef>[] = [];
  let sealed: AssertionsDocument<BlobRef> | undefined;

  const builder: AssertionsDocumentBuilder<BlobRef> = {
    append(
      entry: AssertionEntryInput<BlobRef>,
    ): Either.Either<AssertionEntryId, AssertionsProducerError> {
      if (sealed !== undefined) {
        return Either.left({ code: "assertions-document-sealed" });
      }
      const entryIdText = input.entryIds.next();
      const entryId = Schema.decodeUnknownEither(
        AssertionEntryIdSchema,
        AssertionsExactParseOptions,
      )(entryIdText);
      if (Either.isLeft(entryId)) {
        return Either.left({
          code: "assertion-entry-id-invalid",
          entryId: entryIdText,
        });
      }
      if (entryIds.has(entryId.right)) {
        return Either.left({
          code: "assertion-entry-id-duplicate",
          entryId: entryIdText,
        });
      }
      entryIds.add(entryId.right);
      entries.push(Object.freeze({ entryId: entryId.right, ...entry }));
      return Either.right(entryId.right);
    },
    seal(
      sealInput: { readonly maximumBytes?: number } = {},
    ): Either.Either<AssertionsDocument<BlobRef>, AssertionsProducerError> {
      if (sealed !== undefined) {
        return Either.right(sealed);
      }
      const maximumBytes = sealInput.maximumBytes ?? MAX_ASSERTION_DOCUMENT_BYTES;
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > MAX_ASSERTION_DOCUMENT_BYTES) {
        return Either.left(invalidDocument(
          `Assertions framing has no positive entry budget within the ${MAX_ASSERTION_DOCUMENT_BYTES}-byte limit. ` +
          "Reduce assertion source sites or assertion count and retry.",
        ));
      }
      let document: AssertionsDocument<BlobRef> = Object.freeze({
        entries: Object.freeze([...entries]),
      });
      if (!isAssertionsRawDataGraph(document)) {
        return Either.left(invalidDocument(
          "Assertions could not be saved because an entry contains a cyclic or non-JSON value. " +
          "Upgrade NiceEval and retry; if this persists, report assertions-document-invalid.",
        ));
      }
      let documentBytes = encodedBytes(document);
      if (documentBytes > maximumBytes) {
        document = Object.freeze({ entries: compactEntries(document.entries, "root") });
        documentBytes = encodedBytes(document);
      }
      if (documentBytes > maximumBytes) {
        document = Object.freeze({ entries: compactEntries(document.entries, "minimal") });
        documentBytes = encodedBytes(document);
      }
      if (documentBytes > maximumBytes) {
        return Either.left(invalidDocument(
          `Assertions could not be saved after diagnostic compaction because entry framing is ` +
          `${documentBytes} bytes; ${maximumBytes} bytes remain after source sites within the ` +
          `${MAX_ASSERTION_DOCUMENT_BYTES}-byte limit. Large subject and evidence snapshots are already ` +
          "stored as blobs; reduce assertion count or matcher/display identity and retry.",
        ));
      }
      const encoded = Schema.encodeUnknownEither(
        input.documentSchema,
        AssertionsExactParseOptions,
      )(document);
      if (Either.isLeft(encoded)) {
        const issue = firstSchemaIssue(encoded.left);
        return Either.left(invalidDocument(
          `Assertions could not be saved${issue === undefined ? "" : ` because ${issue}`}. ` +
          "Upgrade NiceEval and retry; if this persists, report assertions-document-invalid.",
        ));
      }
      sealed = document;
      return Either.right(document);
    },
  };
  return Object.freeze(builder);
}
