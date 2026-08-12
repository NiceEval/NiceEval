import { Either, Schema } from "effect";
import {
  AssertionEntryIdSchema,
  AssertionsExactParseOptions,
} from "./codec.ts";
import type {
  AssertionDisplayV1,
  AssertionEntryId,
  AssertionEntryV1,
  AssertionLimitationV1,
  AssertionMaterialV1,
  AssertionCoverageV1,
  AssertionsDocumentV1,
  SealedAssertionResultV1,
  WritableCriterionEnvelopeV1,
} from "./model.ts";

export interface AssertionEntryInputV1<BlobRef> {
  readonly display: AssertionDisplayV1;
  readonly criterion: WritableCriterionEnvelopeV1;
  readonly subject: AssertionMaterialV1<BlobRef>;
  readonly evidence: readonly AssertionMaterialV1<BlobRef>[];
  readonly coverage: AssertionCoverageV1;
  readonly limitations: readonly AssertionLimitationV1[];
  readonly result: SealedAssertionResultV1;
}

export interface AssertionsEntryIdSourceV1 {
  /** Must return a fresh `ae_[a-z0-9]{20}` candidate for this Attachment. */
  readonly next: () => string;
}

export type AssertionsProducerErrorV1 =
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

export interface AssertionsDocumentBuilderV1<BlobRef> {
  /** Appends exactly one completed Assertion in declaration/display order. */
  readonly append: (
    entry: AssertionEntryInputV1<BlobRef>,
  ) => Either.Either<AssertionEntryId, AssertionsProducerErrorV1>;
  /**
   * Checks the writer-only exact document schema once and prevents subsequent
   * appends. Repeated calls return the same sealed document without running
   * an evaluator or minting another entry ID.
   */
  readonly seal: () => Either.Either<
    AssertionsDocumentV1<BlobRef>,
    AssertionsProducerErrorV1
  >;
}

/**
 * Assertion producers own normalization and ID allocation. This builder owns
 * neither Record paths nor blob streams: the later Attachment adapter supplies
 * Record's local builder, so an entry cannot borrow another Attachment's ref.
 */
export function createAssertionsDocumentBuilderV1<BlobRef, Encoded>(input: {
  readonly documentSchema: Schema.Schema<AssertionsDocumentV1<BlobRef>, Encoded>;
  readonly entryIds: AssertionsEntryIdSourceV1;
}): AssertionsDocumentBuilderV1<BlobRef> {
  const entryIds = new Set<string>();
  const entries: AssertionEntryV1<BlobRef>[] = [];
  let sealed: AssertionsDocumentV1<BlobRef> | undefined;

  const builder: AssertionsDocumentBuilderV1<BlobRef> = {
    append(
      entry: AssertionEntryInputV1<BlobRef>,
    ): Either.Either<AssertionEntryId, AssertionsProducerErrorV1> {
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
    seal(): Either.Either<AssertionsDocumentV1<BlobRef>, AssertionsProducerErrorV1> {
      if (sealed !== undefined) {
        return Either.right(sealed);
      }
      const document: AssertionsDocumentV1<BlobRef> = Object.freeze({
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
