import { Either, Schema } from "effect";
import {
  defineRecordAttachmentFamily,
  makeRecordAttachmentWrite,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
  type RecordBlobRef,
  type RecordBlobSource,
} from "../../record/attachment/index.ts";
import {
  defineBuiltinJsonRecordAttachment,
} from "../../record/attachment/internal.ts";
import {
  AssertionEntryIdSchema,
  AssertionsExactParseOptions,
  BoundedJsonObjectV1Schema,
  createAssertionsRecordSchemas,
  projectAssertionsDocumentV1,
  type ThirdPartyCriterionRegistryV1,
} from "./codec.ts";
import {
  createAssertionsDocumentBuilderV1,
  type AssertionEntryInputV1,
  type AssertionsDocumentBuilderV1,
  type AssertionsEntryIdSourceV1,
  type AssertionsProducerErrorV1,
} from "./producer.ts";
import type {
  AssertionEntryId,
  AssertionEntryV1,
  AssertionEntryOuterV1,
  AssertionMaterialV1,
  AssertionsDocumentOuterV1,
  AssertionsProjectionV1,
  BoundedJsonValueV1,
} from "./model.ts";

/**
 * The Record attachment runtime keeps the real ref authority private. This
 * positional schema only lets the Assertions schema carry a package ref;
 * generic Record closure validation still rejects every ref not minted by the
 * current Attachment builder.
 */
const RecordBlobRefPositionSchema: Schema.Schema<
  RecordBlobRef,
  RecordBlobRef,
  never
> = Schema.declare<RecordBlobRef>(
  (value): value is RecordBlobRef => typeof value === "object" && value !== null,
);

/**
 * Producer preflight needs to validate the strict writer document before the
 * real Attachment builder exists. This is deliberately not a RecordBlobRef:
 * final payloads replace it with a ref minted by `blobs.add` below.
 */
interface AssertionsProvisionalBlobRefV1 {
  readonly kind: "assertions-provisional-blob-ref";
}

const AssertionsProvisionalBlobRefV1Schema: Schema.Schema<
  AssertionsProvisionalBlobRefV1
> = Schema.Struct({
  kind: Schema.Literal("assertions-provisional-blob-ref"),
});

export const assertionsRecordSchemasV1 = createAssertionsRecordSchemas(
  RecordBlobRefPositionSchema,
);

const assertionsProducerSchemasV1 = createAssertionsRecordSchemas(
  AssertionsProvisionalBlobRefV1Schema,
);

/** Complete payload-order projection required by Record's closure validator. */
export function assertionBlobRefsV1(
  document: AssertionsDocumentOuterV1<RecordBlobRef>,
): readonly RecordBlobRef[] {
  const refs: RecordBlobRef[] = [];
  const collect = (material: AssertionMaterialV1<RecordBlobRef>): void => {
    if (material.kind === "blob") refs.push(material.ref);
  };
  for (const entry of document.entries) {
    collect(entry.subject);
    for (const material of entry.evidence) collect(material);
  }
  return Object.freeze(refs);
}

function requireDefinition<Result, Failure>(
  result: Either.Either<Result, Failure>,
  message: string,
): Result {
  if (Either.isLeft(result)) {
    throw new Error(message);
  }
  return result.right;
}

export const assertionsAttachmentDefinitionV1 = requireDefinition(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: "niceeval.assertions",
    schemaId: "niceeval.assertions/v1",
    schema: assertionsRecordSchemasV1.outerDocument,
    blobRefs: assertionBlobRefsV1,
  }),
  "Assertions v1 RecordAttachment definition must be valid",
);

export const assertionsAttachmentFamilyV1 = requireDefinition(
  defineRecordAttachmentFamily({
    current: assertionsAttachmentDefinitionV1,
    migrations: [],
  }),
  "Assertions v1 RecordAttachment family must be valid",
);

export type AssertionMaterialInputV1<E, R> =
  | {
      readonly kind: "snapshot";
      readonly value: BoundedJsonValueV1;
    }
  | {
      readonly kind: "blob";
      readonly source: RecordBlobSource<E, R>;
      readonly encoding: "utf-8" | "binary";
      readonly byteLength: number;
      readonly preview: string;
    };

export interface AssertionsAttachmentEntryInputV1<E, R> {
  readonly display: AssertionEntryInputV1<RecordBlobRef>["display"];
  readonly criterion: AssertionEntryInputV1<RecordBlobRef>["criterion"];
  readonly subject: AssertionMaterialInputV1<E, R>;
  readonly evidence: readonly AssertionMaterialInputV1<E, R>[];
  readonly coverage: AssertionEntryInputV1<RecordBlobRef>["coverage"];
  readonly limitations: AssertionEntryInputV1<RecordBlobRef>["limitations"];
  readonly result: AssertionEntryInputV1<RecordBlobRef>["result"];
}

export interface AssertionsAttachmentProducerV1<E, R> {
  readonly append: (
    entry: AssertionsAttachmentEntryInputV1<E, R>,
  ) => Either.Either<AssertionEntryId, AssertionsProducerErrorV1>;
  readonly seal: () => Either.Either<
    RecordAttachmentWrite<"attempt", E, R>,
    AssertionsProducerErrorV1
  >;
}

function makeProvisionalBlobRefV1(): AssertionsProvisionalBlobRefV1 {
  return Object.freeze({ kind: "assertions-provisional-blob-ref" });
}

function provisionalMaterial<E, R>(
  material: AssertionMaterialInputV1<E, R>,
): AssertionMaterialV1<AssertionsProvisionalBlobRefV1> {
  return material.kind === "snapshot"
    ? Object.freeze({ kind: "snapshot", value: material.value })
    : Object.freeze({
        kind: "blob",
        ref: makeProvisionalBlobRefV1(),
        encoding: material.encoding,
        byteLength: material.byteLength,
        preview: material.preview,
      });
}

function provisionalEntry<E, R>(
  entry: AssertionsAttachmentEntryInputV1<E, R>,
): AssertionEntryInputV1<AssertionsProvisionalBlobRefV1> {
  return Object.freeze({
    display: entry.display,
    criterion: entry.criterion,
    subject: provisionalMaterial(entry.subject),
    evidence: Object.freeze(entry.evidence.map(provisionalMaterial)),
    coverage: entry.coverage,
    limitations: entry.limitations,
    result: entry.result,
  });
}

interface AssertionsAttachmentEntrySourcesV1<E, R> {
  readonly subject: AssertionMaterialInputV1<E, R>;
  readonly evidence: readonly AssertionMaterialInputV1<E, R>[];
}

function captureEntrySources<E, R>(
  entry: AssertionsAttachmentEntryInputV1<E, R>,
): AssertionsAttachmentEntrySourcesV1<E, R> {
  return Object.freeze({
    subject: entry.subject,
    evidence: Object.freeze([...entry.evidence]),
  });
}

function materializeMaterial<E, R>(
  material: AssertionMaterialV1<AssertionsProvisionalBlobRefV1>,
  source: AssertionMaterialInputV1<E, R>,
  blobs: RecordAttachmentBlobBuilder,
  drafts: RecordAttachmentBlobDraft<E, R>[],
): AssertionMaterialV1<RecordBlobRef> {
  if (material.kind === "snapshot") {
    if (source.kind !== "snapshot") {
      throw new Error("Assertions producer changed a sealed material kind");
    }
    return Object.freeze({ kind: "snapshot", value: material.value });
  }
  if (source.kind !== "blob") {
    throw new Error("Assertions producer changed a sealed material kind");
  }
  const draft = blobs.add(source.source);
  drafts.push(draft);
  return Object.freeze({
    kind: "blob",
    ref: draft.ref,
    encoding: material.encoding,
    byteLength: material.byteLength,
    preview: material.preview,
  });
}

function outerCriterion(
  criterion: AssertionEntryV1<AssertionsProvisionalBlobRefV1>["criterion"],
): AssertionEntryOuterV1<RecordBlobRef>["criterion"] {
  const decoded = Schema.decodeUnknownEither(
    BoundedJsonObjectV1Schema,
    AssertionsExactParseOptions,
  )(criterion);
  if (Either.isLeft(decoded)) {
    throw new Error("An Assertions v1 writer criterion must be bounded JSON");
  }
  return decoded.right;
}

function materializeDocument<E, R>(
  sources: readonly AssertionsAttachmentEntrySourcesV1<E, R>[],
  sealedEntries: readonly AssertionEntryV1<AssertionsProvisionalBlobRefV1>[],
  blobs: RecordAttachmentBlobBuilder,
): {
  readonly payload: AssertionsDocumentOuterV1<RecordBlobRef>;
  readonly blobs: readonly RecordAttachmentBlobDraft<E, R>[];
} {
  const drafts: RecordAttachmentBlobDraft<E, R>[] = [];
  const materializedEntries: AssertionEntryOuterV1<RecordBlobRef>[] = [];
  for (const [index, sealed] of sealedEntries.entries()) {
    const source = sources[index];
    if (source === undefined) {
      throw new Error("Assertions producer lost a sealed entry source");
    }
    if (source.evidence.length !== sealed.evidence.length) {
      throw new Error("Assertions producer changed sealed evidence cardinality");
    }
    materializedEntries.push(Object.freeze({
      entryId: sealed.entryId,
      display: sealed.display,
      criterion: outerCriterion(sealed.criterion),
      subject: materializeMaterial(sealed.subject, source.subject, blobs, drafts),
      evidence: Object.freeze(
        sealed.evidence.map((material, evidenceIndex) => {
          const evidenceSource = source.evidence[evidenceIndex];
          if (evidenceSource === undefined) {
            throw new Error("Assertions producer lost a sealed evidence source");
          }
          return materializeMaterial(material, evidenceSource, blobs, drafts);
        }),
      ),
      coverage: sealed.coverage,
      limitations: sealed.limitations,
      result: sealed.result,
    }));
  }
  return Object.freeze({
    payload: Object.freeze({ entries: Object.freeze(materializedEntries) }),
    blobs: Object.freeze(drafts),
  });
}

/**
 * Collects completed facts in declaration order, then mints every blob ref
 * inside one generic RecordAttachment write. Callers never receive a raw ref,
 * path, key, or bytes channel, so cross-Attachment closure is impossible.
 */
export function createAssertionsAttachmentProducerV1<E, R>(input: {
  readonly entryIds: AssertionsEntryIdSourceV1;
}): AssertionsAttachmentProducerV1<E, R> {
  const documentBuilder: AssertionsDocumentBuilderV1<AssertionsProvisionalBlobRefV1> =
    createAssertionsDocumentBuilderV1({
      documentSchema: assertionsProducerSchemasV1.document,
      entryIds: input.entryIds,
    });
  const sources: AssertionsAttachmentEntrySourcesV1<E, R>[] = [];
  let sealed:
    | Either.Either<RecordAttachmentWrite<"attempt", E, R>, AssertionsProducerErrorV1>
    | undefined;

  const producer: AssertionsAttachmentProducerV1<E, R> = {
    append(entry) {
      const appended = documentBuilder.append(provisionalEntry(entry));
      if (Either.isRight(appended)) sources.push(captureEntrySources(entry));
      return appended;
    },
    seal() {
      if (sealed !== undefined) return sealed;
      const document = documentBuilder.seal();
      if (Either.isLeft(document)) {
        sealed = Either.left(document.left);
        return sealed;
      }
      const write = makeRecordAttachmentWrite(
        assertionsAttachmentFamilyV1,
        (blobs) => materializeDocument(sources, document.right.entries, blobs),
      );
      const closure = validateRecordAttachmentWrite(write);
      if (Either.isLeft(closure)) {
        throw new Error("Assertions producer generated an invalid RecordAttachment closure");
      }
      sealed = Either.right(write);
      return sealed;
    },
  };
  return Object.freeze(producer);
}

export interface AssertionsProjectorDefinitionV1 {
  readonly family: typeof assertionsAttachmentFamilyV1;
  readonly project: (
    value: RecordAttachmentValue<AssertionsDocumentOuterV1<RecordBlobRef>>,
  ) => AssertionsProjectionV1<RecordBlobRef>;
}

/** Typed, synchronous projection over one already-materialized Attachment value. */
export function defineAssertionsProjectorV1(
  registry: ThirdPartyCriterionRegistryV1,
): AssertionsProjectorDefinitionV1 {
  return Object.freeze({
    family: assertionsAttachmentFamilyV1,
    project(value: RecordAttachmentValue<AssertionsDocumentOuterV1<RecordBlobRef>>) {
      return projectAssertionsDocumentV1(value.payload, registry);
    },
  });
}
