import { Either, ParseResult, Schema } from "effect";
import {
  AssertionEntryIdSchema,
  AssertionsExactParseOptions,
  MAX_ASSERTION_DOCUMENT_BYTES,
  isAssertionsRawDataGraph,
} from "./codec.ts";
import type {
  AssertionDisplay,
  AssertionEntryId,
  AssertionEntry,
  AssertionCriterionRecord,
  AssertionMaterials,
  AssertionEvaluation,
  AssertionDecision,
  AssertionDecisionPolicy,
  AssertionFactValue,
  ScoreContribution,
  ExplanationRetention,
  AssertionsDocument,
  WritableCriterionEnvelope,
} from "./model.ts";

export interface AssertionEntryInput<BlobRef> {
  readonly display: AssertionDisplay;
  readonly criterion: AssertionCriterionRecord;
  readonly materials: AssertionMaterials<BlobRef>;
  readonly evaluation: AssertionEvaluation;
  readonly decision: AssertionDecision;
  readonly policy: AssertionDecisionPolicy;
  readonly contribution: ScoreContribution;
  readonly explanationRetention: ExplanationRetention;
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

function compactEntries<BlobRef>(
  entries: readonly AssertionEntry<BlobRef>[],
  mode: "root" | "minimal",
): readonly AssertionEntry<BlobRef>[] {
  const childState = (value: AssertionFactValue): string | undefined => {
    if (value.kind !== "fields") return undefined;
    const state = value.fields.find((field) => field.label === "state")?.value;
    return state?.kind === "value" && typeof state.value === "string" ? state.value : undefined;
  };
  const compactFact = (
    value: AssertionFactValue,
    decision: AssertionEntry<BlobRef>["decision"],
  ): AssertionFactValue => {
    switch (value.kind) {
      case "unavailable":
      case "value":
        return value;
      case "text":
        return value.text.length <= 512
          ? value
          : Object.freeze({ kind: "text", text: `${value.text.slice(0, 511)}…` });
      case "list":
        return Object.freeze({ kind: "list", items: Object.freeze(value.items.map((item) => compactFact(item, decision))) });
      case "fields":
        return Object.freeze({
          kind: "fields",
          fields: Object.freeze(value.fields.flatMap((field) => {
            if (
              (mode === "root" || mode === "minimal") &&
              (field.label === "message" || field.label === "expected" || field.label === "received")
            ) return [];
            if (field.label === "children" && field.value.kind === "list") {
              const decisiveState = decision.result === "matched"
                ? "matched"
                : decision.result === "unavailable"
                  ? "unavailable"
                  : decision.result === "mismatched"
                    ? "matched"
                    : undefined;
              const decisive: AssertionFactValue[] = [];
              if (decisiveState !== undefined) {
                for (const item of field.value.items) {
                  if (childState(item) !== decisiveState) continue;
                  if (decisive.length === 0) decisive.push(item);
                  else if (decisive.length === 1) decisive.push(item);
                  else decisive[1] = item;
                }
              }
              const representative = mode === "root" ? field.value.items.slice(0, 2) : [];
              const retained = [...new Set([...representative, ...decisive])];
              return [Object.freeze({
                label: field.label,
                value: Object.freeze({
                  kind: "list" as const,
                  items: Object.freeze(retained.map((item) => compactFact(item, decision))),
                }),
              })];
            }
            return [Object.freeze({ label: field.label, value: compactFact(field.value, decision) })];
          })),
        });
    }
  };
  return Object.freeze(entries.map((entry) => entry.explanationRetention.state === "retained"
    ? Object.freeze({
        ...entry,
        explanationRetention: Object.freeze({
          state: "retained" as const,
          value: compactFact(entry.explanationRetention.value, entry.decision),
        }),
      })
    : entry));
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
          `${MAX_ASSERTION_DOCUMENT_BYTES}-byte limit. Large source and evidence snapshots are already ` +
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
