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
import type {
  AssertionCoverage,
  AssertionCriterion,
  AssertionLimitation,
  AssertionMaterial,
  AssertionResult,
  AssertionSnapshotObject,
  AssertionSnapshotValue,
  SealedAssertionEntry,
} from "../api.ts";
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
  AssertionCoverageV1,
  AssertionLimitationV1,
  AssertionMaterialV1,
  AssertionsDocumentOuterV1,
  AssertionsProjectionV1,
  BoundedJsonObjectV1,
  BoundedJsonValueV1,
  SealedAssertionResultV1,
  WritableCriterionEnvelopeV1,
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
    }
  | {
      readonly kind: "record-attachment";
      readonly schemaId: "niceeval.diff/v1";
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

function encodeSnapshotValueV1(value: AssertionSnapshotValue): BoundedJsonValueV1 {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(encodeSnapshotValueV1));
  }
  const encoded: globalThis.Record<string, BoundedJsonValueV1> = {};
  for (const [key, nested] of Object.entries(value)) {
    encoded[key] = encodeSnapshotValueV1(nested);
  }
  return Object.freeze(encoded);
}

function encodeSnapshotObjectV1(value: AssertionSnapshotObject): BoundedJsonObjectV1 {
  const encoded: globalThis.Record<string, BoundedJsonValueV1> = {};
  for (const [key, nested] of Object.entries(value)) {
    encoded[key] = encodeSnapshotValueV1(nested);
  }
  return Object.freeze(encoded);
}

function encodeCriterionV1(criterion: AssertionCriterion): WritableCriterionEnvelopeV1 {
  switch (criterion.kind) {
    case "value-match":
      return Object.freeze({
        kind: "builtin" as const,
        id: "value-match/v1" as const,
        data: Object.freeze({ subject: criterion.subject }),
      });
    case "scope-status":
      return Object.freeze({
        kind: "builtin" as const,
        id: "scope-status/v1" as const,
        data: Object.freeze({ scope: criterion.scope, assertion: criterion.assertion }),
      });
    case "occurrence":
      return Object.freeze({
        kind: "builtin" as const,
        id: "occurrence/v1" as const,
        data: Object.freeze({
          scope: criterion.scope,
          occurrence: criterion.occurrence,
          assertion: criterion.assertion,
          ...(criterion.matcher === undefined ? {} : { matcher: criterion.matcher }),
          ...(criterion.quantifier === undefined
            ? {}
            : {
                quantifier: criterion.quantifier.kind === "absent"
                  ? Object.freeze({ kind: "absent" as const })
                  : Object.freeze({ kind: criterion.quantifier.kind, count: criterion.quantifier.count }),
              }),
        }),
      });
    case "judge-measurement":
      return Object.freeze({
        kind: "builtin" as const,
        id: "judge-measurement/v1" as const,
        data: Object.freeze({ recipe: criterion.recipe, scale: criterion.scale }),
      });
    case "sandbox-result": {
      switch (criterion.operation) {
        case "changed-paths":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({ operation: "changed-paths" as const, paths: Object.freeze([...criterion.paths]) }),
          });
        case "no-changes":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({ operation: "no-changes" as const }),
          });
        case "file-changed":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({
              operation: "file-changed" as const,
              path: criterion.path,
              ...(criterion.status === undefined ? {} : { status: criterion.status }),
              ...(criterion.before === undefined ? {} : { before: criterion.before }),
              ...(criterion.after === undefined ? {} : { after: criterion.after }),
            }),
          });
        case "file-deleted":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({ operation: "file-deleted" as const, path: criterion.path }),
          });
        case "not-in-diff":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({
              operation: "not-in-diff" as const,
              pattern: criterion.pattern,
              flags: criterion.flags,
              content: criterion.content,
            }),
          });
      }
    }
    case "direct-score":
      return Object.freeze({
        kind: "builtin" as const,
        id: "direct-score/v1" as const,
        data: Object.freeze({ source: criterion.source }),
      });
    case "third-party":
      return Object.freeze({
        name: criterion.name,
        schemaId: criterion.schemaId,
        data: encodeSnapshotValueV1(criterion.data),
      });
  }
}

function encodeMaterialV1(
  material: AssertionMaterial,
): AssertionMaterialInputV1<never, never> {
  switch (material.kind) {
    case "snapshot":
      return Object.freeze({
        kind: "snapshot" as const,
        value: encodeSnapshotValueV1(material.value),
      });
    case "record-attachment":
      return Object.freeze({
        kind: "record-attachment" as const,
        schemaId: "niceeval.diff/v1" as const,
        preview: material.preview,
      });
  }
}

function encodeCoverageV1(coverage: AssertionCoverage): AssertionCoverageV1 {
  switch (coverage.state) {
    case "complete":
      return Object.freeze({ state: "complete" as const });
    case "partial":
      return Object.freeze({ state: "partial" as const, reason: coverage.reason });
    case "unavailable":
      return Object.freeze({ state: "unavailable" as const, reason: coverage.reason });
    case "not-applicable":
      return Object.freeze({ state: "not-applicable" as const, reason: coverage.reason });
  }
}

function encodeLimitationsV1(
  limitations: readonly AssertionLimitation[],
): readonly AssertionLimitationV1[] {
  return Object.freeze(limitations.map((limitation): AssertionLimitationV1 => {
    switch (limitation.kind) {
      case "redacted":
        return Object.freeze({ kind: "redacted" as const, fieldCount: limitation.fieldCount });
      case "sampled":
        return Object.freeze({
          kind: "sampled" as const,
          captured: limitation.captured,
          ...(limitation.knownTotal === undefined ? {} : { knownTotal: limitation.knownTotal }),
        });
      case "truncated":
        return Object.freeze({ kind: "truncated" as const, omittedBytes: limitation.omittedBytes });
      case "provider-limited":
        return Object.freeze({ kind: "provider-limited" as const });
    }
  }));
}

export function encodeAssertionResultV1(result: AssertionResult): SealedAssertionResultV1 {
  const diagnostic = result.diagnostic === undefined
    ? {}
    : { diagnostic: encodeSnapshotObjectV1(result.diagnostic) };
  switch (result.state) {
    case "matched":
      return Object.freeze({
        state: "matched" as const,
        gate: result.gate,
        score: result.score.state === "earned"
          ? Object.freeze({ state: "earned" as const, points: result.score.points, earned: result.score.earned })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
      });
    case "mismatched":
      return Object.freeze({
        state: "mismatched" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "earned"
          ? Object.freeze({ state: "earned" as const, points: result.score.points, earned: result.score.earned })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
      });
    case "unavailable":
      return Object.freeze({
        state: "unavailable" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "unavailable"
          ? Object.freeze({ state: "unavailable" as const, points: result.score.points, reason: result.score.reason })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
      });
    case "errored":
      return Object.freeze({
        state: "errored" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "unavailable"
          ? Object.freeze({ state: "unavailable" as const, points: result.score.points, reason: result.score.reason })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
      });
    case "not-applicable":
      return Object.freeze({
        state: "not-applicable" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "unavailable"
          ? Object.freeze({ state: "unavailable" as const, points: result.score.points, reason: result.score.reason })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
      });
  }
}

/** Private Runtime → durable Assertions codec bridge. */
export function encodeSealedAssertionEntryV1(
  entry: SealedAssertionEntry,
): AssertionsAttachmentEntryInputV1<never, never> {
  return Object.freeze({
    display: Object.freeze({
      ...(entry.display.key === undefined ? {} : { key: entry.display.key }),
      ...(entry.display.label === undefined ? {} : { label: entry.display.label }),
      groupPath: Object.freeze([...entry.display.groupPath]),
    }),
    criterion: encodeCriterionV1(entry.criterion),
    subject: encodeMaterialV1(entry.subject),
    evidence: Object.freeze(entry.evidence.map(encodeMaterialV1)),
    coverage: encodeCoverageV1(entry.coverage),
    limitations: encodeLimitationsV1(entry.limitations),
    result: encodeAssertionResultV1(entry.result),
  });
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
  switch (material.kind) {
    case "snapshot":
      return Object.freeze({ kind: "snapshot", value: material.value });
    case "record-attachment":
      return Object.freeze({
        kind: "record-attachment",
        schemaId: material.schemaId,
        preview: material.preview,
      });
    case "blob":
      return Object.freeze({
        kind: "blob",
        ref: makeProvisionalBlobRefV1(),
        encoding: material.encoding,
        byteLength: material.byteLength,
        preview: material.preview,
      });
  }
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
  if (material.kind === "record-attachment") {
    if (source.kind !== "record-attachment") {
      throw new Error("Assertions producer changed a sealed material kind");
    }
    return Object.freeze({
      kind: "record-attachment",
      schemaId: material.schemaId,
      preview: material.preview,
    });
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
