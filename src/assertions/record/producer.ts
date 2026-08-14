import { Either, Schema } from "effect";
import {
  AssertionEntryIdSchema,
  AssertionsExactParseOptions,
} from "./codec.ts";
import type {
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
  | { readonly code: "assertions-document-invalid" };

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
  readonly seal: () => Either.Either<
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
    seal(): Either.Either<AssertionsDocument<BlobRef>, AssertionsProducerError> {
      if (sealed !== undefined) {
        return Either.right(sealed);
      }
      const document: AssertionsDocument<BlobRef> = Object.freeze({
        entries: Object.freeze([...entries]),
      });
      const encoded = Schema.encodeUnknownEither(
        input.documentSchema,
        AssertionsExactParseOptions,
      )(document);
      if (Either.isLeft(encoded)) {
        return Either.left({ code: "assertions-document-invalid" });
      }
      sealed = document;
      return Either.right(document);
    },
  };
  return Object.freeze(builder);
}
