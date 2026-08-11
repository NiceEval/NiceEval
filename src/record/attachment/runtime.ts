import { Effect, Either, Schema, Stream } from "effect";
import { RecordExactParseOptions } from "../codec/core.ts";
import {
  RecordAttachmentNameSchema,
  RecordAttachmentSchemaIdSchema,
} from "../codec/identifiers.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import {
  isNiceEvalRecordAttachmentName,
  parseRecordAttachmentSchemaId,
  recordAttachmentNameTextOfSchemaId,
  type RecordAttachmentName,
  type RecordAttachmentSchemaId,
} from "../model/identifiers.ts";
import {
  recordAttachmentClosureInvalid,
  recordAttachmentDefinitionInvalid,
  recordAttachmentFamilyInvalid,
  recordAttachmentIssue,
  recordAttachmentMigrationDefinitionInvalid,
  recordAttachmentPayloadInvalid,
  recordAttachmentRegistryInvalid,
  type RecordAttachmentClosureInvalid,
  type RecordAttachmentDefinitionError,
  type RecordAttachmentFamilyError,
  type RecordAttachmentIssue,
  type RecordAttachmentMigrationDefinitionError,
  type RecordAttachmentPayloadInvalid,
  type RecordAttachmentRegistryError,
} from "./errors.ts";
import {
  recordAttachmentBlobBuilderBrand,
  recordAttachmentBlobDraftBrand,
  recordAttachmentBlobRefBrand,
  recordAttachmentBlobSourceBrand,
  recordAttachmentDefinitionBrand,
  recordAttachmentFamilyBrand,
  recordAttachmentMigrationBrand,
  recordAttachmentMigrationEdgeBrand,
  recordAttachmentRegistryBrand,
  recordAttachmentTypeWitness,
  recordAttachmentValueBrand,
  recordAttachmentWriteBrand,
  type AnyRecordAttachmentFamily,
  type DeclareRecordAttachmentMigrationUnavailableInput,
  type DefineJsonRecordAttachmentInput,
  type DefineRecordAttachmentFamilyInput,
  type DefineRecordAttachmentMigrationInput,
  type JsonRecordAttachmentDefinition,
  type RecordAttachmentBlobBuild,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentBlobs,
  type RecordAttachmentFamily,
  type RecordAttachmentJson,
  type RecordAttachmentMigration,
  type RecordAttachmentMigrationEdge,
  type RecordAttachmentMigrationResolution,
  type RecordAttachmentMigrationTarget,
  type RecordAttachmentPayloadSnapshot,
  type RecordAttachmentRegistry,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
  type RecordBlobDrafts,
  type RecordBlobRef,
  type RecordBlobSource,
  type RecordBlobErrors,
  type RecordBlobRequirements,
} from "./types.ts";

type ObjectRecord = Record<PropertyKey, unknown>;

interface BlobRefRuntime {
  readonly builder: BuilderRuntime | undefined;
}

interface BlobSourceRuntime {
  readonly stream: Stream.Stream<Uint8Array, unknown, unknown>;
}

interface BuilderRuntime {
  readonly drafts: RecordAttachmentBlobDraft<unknown, unknown>[];
}

interface DraftRuntime {
  readonly builder: BuilderRuntime;
  readonly ref: RecordBlobRef;
  readonly source: BlobSourceRuntime | undefined;
}

interface DefinitionRuntime {
  readonly definition: JsonRecordAttachmentDefinition<RecordAttachmentOwner, unknown>;
  readonly owner: RecordAttachmentOwner;
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
  readonly schema: Schema.Schema.AnyNoContext;
  readonly blobRefs: (payload: unknown) => readonly RecordBlobRef[];
  readonly builtIn: boolean;
}

interface WriteRuntime {
  readonly definition: DefinitionRuntime | undefined;
  readonly builder: BuilderRuntime | undefined;
  readonly build: { readonly payload: unknown; readonly blobs: unknown } | undefined;
}

interface MigrationEdgeRuntime {
  readonly edge: RecordAttachmentMigrationEdge<RecordAttachmentOwner>;
  readonly from: DefinitionRuntime | undefined;
  readonly to: DefinitionRuntime | undefined;
  readonly kind: "converter" | "unavailable";
  readonly convert:
    | ((
        source: RecordAttachmentValue<unknown>,
        target: RecordAttachmentMigrationTarget<RecordAttachmentOwner, unknown>,
      ) => Effect.Effect<RecordAttachmentWrite<RecordAttachmentOwner, unknown, unknown>, unknown, unknown>)
    | undefined;
  readonly reason: string | undefined;
  readonly valid: boolean;
}

interface FamilyRuntime {
  readonly current: DefinitionRuntime;
  readonly bySchemaId: ReadonlyMap<string, DefinitionRuntime>;
  readonly edgesFrom: ReadonlyMap<string, MigrationEdgeRuntime>;
}

interface RegistryRuntime {
  readonly families: ReadonlyMap<string, AnyRecordAttachmentFamily>;
}

interface ValueRuntime {
  readonly definition: DefinitionRuntime;
  readonly refs: readonly RecordBlobRef[];
  readonly bytes: ReadonlyMap<RecordBlobRef, Uint8Array>;
}

const blobRefs = new WeakMap<object, BlobRefRuntime>();
const blobSources = new WeakMap<object, BlobSourceRuntime>();
const blobDrafts = new WeakMap<object, DraftRuntime>();
const definitions = new WeakMap<object, DefinitionRuntime>();
const writes = new WeakMap<object, WriteRuntime>();
const migrationEdges = new WeakMap<object, MigrationEdgeRuntime>();
const families = new WeakMap<object, FamilyRuntime>();
const registries = new WeakMap<object, RegistryRuntime>();
const values = new WeakMap<object, ValueRuntime>();

const recordBlobHandleInvalid = Object.freeze({
  code: "record-blob-handle-invalid" as const,
});

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return isObject(value);
}

function readOwn(value: unknown, key: PropertyKey): unknown {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

function freezeArray<Value>(items: readonly Value[]): readonly Value[] {
  return Object.freeze([...items]);
}

function definitionRuntime<Owner extends RecordAttachmentOwner, Payload>(
  definition: JsonRecordAttachmentDefinition<Owner, Payload>,
): DefinitionRuntime | undefined {
  return isObject(definition) ? definitions.get(definition) : undefined;
}

function familyRuntime<Owner extends RecordAttachmentOwner, Payload>(
  family: RecordAttachmentFamily<Owner, Payload>,
): FamilyRuntime | undefined {
  return isObject(family) ? families.get(family) : undefined;
}

function isRecordBlobRef(value: unknown): value is RecordBlobRef {
  return isObject(value) && blobRefs.has(value);
}

function isRecordAttachmentBlobDraft(
  value: unknown,
): value is RecordAttachmentBlobDraft<unknown, unknown> {
  return isObject(value) && blobDrafts.has(value);
}

function payloadInvalidForDefinition(): RecordAttachmentPayloadInvalid {
  return recordAttachmentPayloadInvalid([
    recordAttachmentIssue("record-attachment-schema-invalid", ["definition"]),
  ]);
}

function closureInvalidForWrite(): RecordAttachmentClosureInvalid {
  return recordAttachmentClosureInvalid([
    recordAttachmentIssue("record-attachment-closure-mismatch", ["write"]),
  ]);
}

function validOwner(value: unknown): value is RecordAttachmentOwner {
  return value === "run" || value === "attempt";
}

function decimalCompare(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function incrementDecimal(value: string): string {
  const digits = value.split("");
  let carry = 1;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = digits[index];
    if (digit === undefined) {
      break;
    }
    const next = Number(digit) + carry;
    if (next === 10) {
      digits[index] = "0";
      carry = 1;
    } else {
      digits[index] = String(next);
      carry = 0;
      break;
    }
  }
  return carry === 1 ? `1${digits.join("")}` : digits.join("");
}

function schemaVersion(schemaId: RecordAttachmentSchemaId): string | undefined {
  return parseRecordAttachmentSchemaId(schemaId)?.version;
}

function makeBlobRef(builder: BuilderRuntime | undefined): RecordBlobRef {
  const ref = {
    [recordAttachmentBlobRefBrand]: () => recordAttachmentTypeWitness<void>(),
  } as unknown as RecordBlobRef;
  blobRefs.set(ref, Object.freeze({ builder }));
  return Object.freeze(ref);
}

/**
 * @internal Reader/storage integration mints hydrated refs without accepting a
 * disk key at the public API boundary.
 */
export function makeRecordBlobRef(): RecordBlobRef {
  return makeBlobRef(undefined);
}

/** Build a source capability from an Effect stream; raw bytes never enter this API. */
export function makeRecordBlobSource<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
): RecordBlobSource<E, R> {
  const source = {
    stream,
    [recordAttachmentBlobSourceBrand]: () =>
      recordAttachmentTypeWitness<{ readonly error: E; readonly requirements: R }>(),
  } as unknown as RecordBlobSource<E, R>;
  blobSources.set(
    source,
    Object.freeze({
      stream: stream as Stream.Stream<Uint8Array, unknown, unknown>,
    }),
  );
  return Object.freeze(source);
}

function makeBuilder(): {
  readonly builder: RecordAttachmentBlobBuilder;
  readonly runtime: BuilderRuntime;
} {
  const runtime: BuilderRuntime = { drafts: [] };
  const builder = {
    add<E, R>(source: RecordBlobSource<E, R>): RecordAttachmentBlobDraft<E, R> {
      const sourceRuntime = isObject(source) ? blobSources.get(source) : undefined;
      const ref = makeBlobRef(runtime);
      const draft = {
        ref,
        [recordAttachmentBlobDraftBrand]: () =>
          recordAttachmentTypeWitness<{ readonly error: E; readonly requirements: R }>(),
      } as unknown as RecordAttachmentBlobDraft<E, R>;
      const untypedDraft = draft as RecordAttachmentBlobDraft<unknown, unknown>;
      blobDrafts.set(
        draft,
        Object.freeze({ builder: runtime, ref, source: sourceRuntime }),
      );
      runtime.drafts.push(untypedDraft);
      return Object.freeze(draft);
    },
    [recordAttachmentBlobBuilderBrand]: () => recordAttachmentTypeWitness<void>(),
  } as unknown as RecordAttachmentBlobBuilder;
  return Object.freeze({ builder: Object.freeze(builder), runtime });
}

function isJsonArrayIndex(key: string): boolean {
  if (key === "0") {
    return true;
  }
  if (!/^[1-9][0-9]*$/.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < 4_294_967_295;
}

/**
 * Schema validates the declared shape. This guard additionally keeps the
 * encoded boundary JSON-only: no functions, symbols, exotic prototypes,
 * native bytes, sparse arrays, or accessor properties. Package refs are the
 * intentional in-memory exception until storage assigns owner-local keys.
 */
function isAttachmentJson(value: unknown, active = new WeakSet<object>()): boolean {
  if (isRecordBlobRef(value)) {
    return true;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      break;
    default:
      return false;
  }
  if (value === null || !isObject(value)) {
    return value === null;
  }
  if (active.has(value)) {
    return false;
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return false;
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") {
          continue;
        }
        if (typeof key !== "string" || !isJsonArrayIndex(key)) {
          return false;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          return false;
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index) || !isAttachmentJson(value[index], active)) {
          return false;
        }
      }
      return true;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return false;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        return false;
      }
      if (!isAttachmentJson(descriptor.value, active)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    active.delete(value);
  }
}

function cloneAttachmentJson(value: RecordAttachmentJson): RecordAttachmentJson {
  if (isRecordBlobRef(value) || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneAttachmentJson);
  }
  const clone: Record<string, RecordAttachmentJson> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      value: cloneAttachmentJson(child),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clone;
}

function deepFreezePayload<Payload>(
  value: Payload,
  seen = new WeakSet<object>(),
): RecordAttachmentPayloadSnapshot<Payload> {
  if (!isObject(value) || isRecordBlobRef(value) || seen.has(value)) {
    return value as RecordAttachmentPayloadSnapshot<Payload>;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreezePayload(item, seen);
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && "value" in descriptor) {
        deepFreezePayload(descriptor.value, seen);
      }
    }
  }
  Object.freeze(value);
  return value as RecordAttachmentPayloadSnapshot<Payload>;
}

function definitionErrorForInput(
  input: unknown,
  builtIn: boolean,
): Either.Either<
  {
    readonly owner: RecordAttachmentOwner;
    readonly name: RecordAttachmentName;
    readonly schemaId: RecordAttachmentSchemaId;
    readonly schema: Schema.Schema.AnyNoContext;
    readonly blobRefs: (payload: unknown) => readonly RecordBlobRef[];
  },
  RecordAttachmentDefinitionError
> {
  const rawOwner = readOwn(input, "owner");
  const rawName = readOwn(input, "name");
  const rawSchemaId = readOwn(input, "schemaId");
  const rawSchema = readOwn(input, "schema");
  const rawBlobRefs = readOwn(input, "blobRefs");

  const nameText = typeof rawName === "string" ? rawName : "";
  const name = Schema.decodeUnknownEither(
    RecordAttachmentNameSchema,
    RecordExactParseOptions,
  )(rawName);
  if (Either.isLeft(name)) {
    return Either.left(
      Object.freeze({ code: "record-attachment-name-invalid" as const, name: nameText }),
    );
  }

  const schemaIdText = typeof rawSchemaId === "string" ? rawSchemaId : "";
  const schemaId = Schema.decodeUnknownEither(
    RecordAttachmentSchemaIdSchema,
    RecordExactParseOptions,
  )(rawSchemaId);
  if (Either.isLeft(schemaId)) {
    return Either.left(
      Object.freeze({
        code: "record-attachment-schema-id-invalid" as const,
        schemaId: schemaIdText,
      }),
    );
  }

  if (!builtIn && isNiceEvalRecordAttachmentName(name.right)) {
    return Either.left(
      Object.freeze({ code: "niceeval-namespace-reserved" as const, name: nameText }),
    );
  }
  if (builtIn && !isNiceEvalRecordAttachmentName(name.right)) {
    return Either.left(
      recordAttachmentDefinitionInvalid([
        recordAttachmentIssue("record-attachment-schema-id-mismatch", ["name"]),
      ]),
    );
  }

  const schemaName = recordAttachmentNameTextOfSchemaId(schemaId.right);
  const owner = validOwner(rawOwner) ? rawOwner : undefined;
  const schema = Schema.isSchema(rawSchema)
    ? (rawSchema as Schema.Schema.AnyNoContext)
    : undefined;
  const blobRefsCallback =
    typeof rawBlobRefs === "function"
      ? (rawBlobRefs as (payload: unknown) => readonly RecordBlobRef[])
      : undefined;
  const issues: RecordAttachmentIssue[] = [];
  if (owner === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-owner-invalid", ["owner"]));
  }
  if (schemaName !== name.right) {
    issues.push(recordAttachmentIssue("record-attachment-schema-id-mismatch", ["schemaId"]));
  }
  if (schema === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["schema"]));
  }
  if (blobRefsCallback === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-blob-refs-invalid", ["blobRefs"]));
  }
  if (
    issues.length > 0 ||
    owner === undefined ||
    schema === undefined ||
    blobRefsCallback === undefined
  ) {
    return Either.left(recordAttachmentDefinitionInvalid(issues));
  }

  return Either.right({
    owner,
    name: name.right,
    schemaId: schemaId.right,
    schema,
    blobRefs: blobRefsCallback,
  });
}

function defineJsonRecordAttachmentWithNamespace<
  Owner extends RecordAttachmentOwner,
  S extends Schema.Schema.AnyNoContext,
>(
  input: DefineJsonRecordAttachmentInput<Owner, S>,
  builtIn: boolean,
): Either.Either<
  JsonRecordAttachmentDefinition<Owner, Schema.Schema.Type<S>>,
  RecordAttachmentDefinitionError
> {
  const parsed = definitionErrorForInput(input, builtIn);
  if (Either.isLeft(parsed)) {
    return Either.left(parsed.left);
  }
  const definition = {
    owner: parsed.right.owner as Owner,
    name: parsed.right.name,
    schemaId: parsed.right.schemaId,
    blobRefs: input.blobRefs,
    [recordAttachmentDefinitionBrand]: () =>
      recordAttachmentTypeWitness<{ readonly owner: Owner; readonly payload: Schema.Schema.Type<S> }>(),
  } as unknown as JsonRecordAttachmentDefinition<Owner, Schema.Schema.Type<S>>;
  definitions.set(
    definition,
    Object.freeze({
      definition: definition as unknown as JsonRecordAttachmentDefinition<
        RecordAttachmentOwner,
        unknown
      >,
      owner: parsed.right.owner,
      name: parsed.right.name,
      schemaId: parsed.right.schemaId,
      schema: parsed.right.schema,
      blobRefs: parsed.right.blobRefs as (payload: unknown) => readonly RecordBlobRef[],
      builtIn,
    }),
  );
  return Either.right(Object.freeze(definition));
}

/** Define a third-party JSON Attachment. `niceeval.*` remains package-reserved. */
export function defineJsonRecordAttachment<
  const Owner extends RecordAttachmentOwner,
  S extends Schema.Schema.AnyNoContext,
>(
  input: DefineJsonRecordAttachmentInput<Owner, S>,
): Either.Either<
  JsonRecordAttachmentDefinition<Owner, Schema.Schema.Type<S>>,
  RecordAttachmentDefinitionError
> {
  return defineJsonRecordAttachmentWithNamespace(input, false);
}

/** @internal Built-ins use the same validation but are the only `niceeval.*` authority. */
export function defineBuiltinJsonRecordAttachment<
  const Owner extends RecordAttachmentOwner,
  S extends Schema.Schema.AnyNoContext,
>(
  input: DefineJsonRecordAttachmentInput<Owner, S>,
): Either.Either<
  JsonRecordAttachmentDefinition<Owner, Schema.Schema.Type<S>>,
  RecordAttachmentDefinitionError
> {
  return defineJsonRecordAttachmentWithNamespace(input, true);
}

/** Exact decode at the JSON boundary. Registered in-memory refs are allowed only for integration hydration. */
export function decodeJsonRecordAttachmentPayload<
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  definition: JsonRecordAttachmentDefinition<Owner, Payload>,
  input: unknown,
): Either.Either<Payload, RecordAttachmentPayloadInvalid> {
  const runtime = definitionRuntime(definition);
  if (runtime === undefined) {
    return Either.left(payloadInvalidForDefinition());
  }
  if (!isAttachmentJson(input)) {
    return Either.left(
      recordAttachmentPayloadInvalid([
        recordAttachmentIssue("record-attachment-json-invalid", []),
      ]),
    );
  }
  const decoded = Schema.decodeUnknownEither(runtime.schema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(
        recordAttachmentPayloadInvalid([
          recordAttachmentIssue("record-attachment-schema-invalid", []),
        ]),
      )
    : Either.right(decoded.right as Payload);
}

/** Exact encode at the JSON boundary. No Schema parse tree is leaked as public data. */
export function encodeJsonRecordAttachmentPayload<
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  definition: JsonRecordAttachmentDefinition<Owner, Payload>,
  payload: Payload,
): Either.Either<RecordAttachmentJson, RecordAttachmentPayloadInvalid> {
  const runtime = definitionRuntime(definition);
  if (runtime === undefined) {
    return Either.left(payloadInvalidForDefinition());
  }
  const encoded = Schema.encodeUnknownEither(runtime.schema, RecordExactParseOptions)(payload);
  if (Either.isLeft(encoded)) {
    return Either.left(
      recordAttachmentPayloadInvalid([
        recordAttachmentIssue("record-attachment-schema-invalid", []),
      ]),
    );
  }
  if (!isAttachmentJson(encoded.right)) {
    return Either.left(
      recordAttachmentPayloadInvalid([
        recordAttachmentIssue("record-attachment-json-invalid", []),
      ]),
    );
  }
  return Either.right(encoded.right as RecordAttachmentJson);
}

function appendIssues(
  destination: RecordAttachmentIssue[],
  source: readonly RecordAttachmentIssue[],
  prefix: readonly string[] = [],
): void {
  for (const issue of source) {
    destination.push(recordAttachmentIssue(issue.code, [...prefix, ...issue.path]));
  }
}

function validateProjectedRefs(
  definition: DefinitionRuntime,
  payload: unknown,
  builder: BuilderRuntime | undefined,
  issues: RecordAttachmentIssue[],
): readonly RecordBlobRef[] | undefined {
  // `blobRefs` is a trusted extension callback. Deliberately do not catch it:
  // a callback throw is a defect, not an Attachment data state.
  const projected = definition.blobRefs(payload);
  if (!Array.isArray(projected)) {
    issues.push(recordAttachmentIssue("record-attachment-blob-refs-invalid", ["blobRefs"]));
    return undefined;
  }

  const refs: RecordBlobRef[] = [];
  const seen = new Set<RecordBlobRef>();
  for (const [index, ref] of projected.entries()) {
    const runtime = isObject(ref) ? blobRefs.get(ref) : undefined;
    if (runtime === undefined || (builder !== undefined && runtime.builder !== builder)) {
      issues.push(recordAttachmentIssue("record-attachment-blob-ref-illegal", ["payload", String(index)]));
      continue;
    }
    if (seen.has(ref)) {
      issues.push(recordAttachmentIssue("record-attachment-blob-ref-duplicate", ["payload", String(index)]));
      continue;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function validateWriteRuntime(runtime: WriteRuntime): Either.Either<void, RecordAttachmentClosureInvalid> {
  if (runtime.definition === undefined || runtime.builder === undefined || runtime.build === undefined) {
    return Either.left(closureInvalidForWrite());
  }

  const issues: RecordAttachmentIssue[] = [];
  const encoded = Schema.encodeUnknownEither(
    runtime.definition.schema,
    RecordExactParseOptions,
  )(runtime.build.payload);
  if (Either.isLeft(encoded)) {
    issues.push(recordAttachmentIssue("record-attachment-payload-invalid", ["payload"]));
  } else if (!isAttachmentJson(encoded.right)) {
    issues.push(recordAttachmentIssue("record-attachment-json-invalid", ["payload"]));
  }

  const projected = validateProjectedRefs(
    runtime.definition,
    runtime.build.payload,
    runtime.builder,
    issues,
  );
  const projectedSet = new Set<RecordBlobRef>(projected ?? []);

  if (!Array.isArray(runtime.build.blobs)) {
    issues.push(recordAttachmentIssue("record-attachment-closure-mismatch", ["blobs"]));
  } else {
    const submitted = new Map<RecordBlobRef, number>();
    for (const [index, draft] of runtime.build.blobs.entries()) {
      const draftRuntime = isObject(draft) ? blobDrafts.get(draft) : undefined;
      if (
        draftRuntime === undefined ||
        draftRuntime.builder !== runtime.builder ||
        !isRecordBlobRef(draftRuntime.ref)
      ) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-illegal", ["blobs", String(index)]));
        continue;
      }
      if (draftRuntime.source === undefined) {
        issues.push(recordAttachmentIssue("record-attachment-closure-mismatch", ["blobs", String(index)]));
        continue;
      }
      const count = (submitted.get(draftRuntime.ref) ?? 0) + 1;
      submitted.set(draftRuntime.ref, count);
      if (count > 1) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-duplicate", ["blobs", String(index)]));
      }
      if (!projectedSet.has(draftRuntime.ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-extra", ["blobs", String(index)]));
      }
    }

    if (projected !== undefined) {
      for (const [index, ref] of projected.entries()) {
        if ((submitted.get(ref) ?? 0) === 0) {
          issues.push(recordAttachmentIssue("record-attachment-blob-ref-missing", ["payload", String(index)]));
        }
      }
    }

    for (const draft of runtime.builder.drafts) {
      const draftRuntime = blobDrafts.get(draft);
      if (draftRuntime === undefined) {
        throw new Error("RecordAttachment builder registry lost a draft it minted");
      }
      if (!projectedSet.has(draftRuntime.ref) && (submitted.get(draftRuntime.ref) ?? 0) === 0) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-extra", ["builder"]));
      }
    }
  }

  return issues.length === 0
    ? Either.right(undefined)
    : Either.left(recordAttachmentClosureInvalid(issues));
}

function makeRecordAttachmentWriteForDefinition<
  Owner extends RecordAttachmentOwner,
  Payload,
  const Blobs extends RecordBlobDrafts,
>(
  definition: JsonRecordAttachmentDefinition<Owner, Payload> | undefined,
  build: (
    blobs: RecordAttachmentBlobBuilder,
  ) => RecordAttachmentBlobBuild<Payload, Blobs>,
): RecordAttachmentWrite<
  Owner,
  RecordBlobErrors<Blobs>,
  RecordBlobRequirements<Blobs>
> {
  const builder = definition === undefined ? undefined : makeBuilder();
  // Do not execute a builder for a forged family/definition. For a genuine
  // builder, its callback is trusted and a throw must remain a defect.
  const result = builder === undefined ? undefined : build(builder.builder);
  const buildRuntime = isObjectRecord(result)
    ? Object.freeze({
        payload: readOwn(result, "payload"),
        blobs: readOwn(result, "blobs"),
      })
    : undefined;
  const write = {
    [recordAttachmentWriteBrand]: () =>
      recordAttachmentTypeWitness<{
        readonly owner: Owner;
        readonly error: RecordBlobErrors<Blobs>;
        readonly requirements: RecordBlobRequirements<Blobs>;
      }>(),
  } as unknown as RecordAttachmentWrite<
    Owner,
    RecordBlobErrors<Blobs>,
    RecordBlobRequirements<Blobs>
  >;
  writes.set(
    write,
    Object.freeze({
      definition: definition === undefined ? undefined : definitionRuntime(definition),
      builder: builder?.runtime,
      build: buildRuntime,
    }),
  );
  return Object.freeze(write);
}

/**
 * The only public generic writer builder. It captures its family, minted refs,
 * and sources; callers cannot provide a name, path, key, or raw bytes.
 */
export function makeRecordAttachmentWrite<
  Owner extends RecordAttachmentOwner,
  Payload,
  const Blobs extends RecordBlobDrafts,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
  build: (
    blobs: RecordAttachmentBlobBuilder,
  ) => RecordAttachmentBlobBuild<Payload, Blobs>,
): RecordAttachmentWrite<
  Owner,
  RecordBlobErrors<Blobs>,
  RecordBlobRequirements<Blobs>
> {
  const runtime = familyRuntime(family);
  const definition = runtime?.current.definition as
    | JsonRecordAttachmentDefinition<Owner, Payload>
    | undefined;
  return makeRecordAttachmentWriteForDefinition(definition, build);
}

/** Pure closure check used by the writer before any Stream is consumed. */
export function validateRecordAttachmentWrite<
  Owner extends RecordAttachmentOwner,
  E,
  R,
>(
  write: RecordAttachmentWrite<Owner, E, R>,
): Either.Either<void, RecordAttachmentClosureInvalid> {
  return isObject(write)
    ? validateWriteRuntime(writes.get(write) ?? Object.freeze({
        definition: undefined,
        builder: undefined,
        build: undefined,
      }))
    : Either.left(closureInvalidForWrite());
}

/** @internal The integration writer consumes this only after closure validation. */
export interface RecordAttachmentWriteContents<
  Owner extends RecordAttachmentOwner,
  Payload,
  E,
  R,
> {
  readonly definition: JsonRecordAttachmentDefinition<Owner, Payload>;
  readonly payload: Payload;
  readonly blobs: readonly {
    readonly ref: RecordBlobRef;
    readonly stream: Stream.Stream<Uint8Array, E, R>;
  }[];
}

/** @internal Extract captured sources without exposing a raw write facade. */
export function recordAttachmentWriteContents<
  Owner extends RecordAttachmentOwner,
  Payload,
  E,
  R,
>(
  write: RecordAttachmentWrite<Owner, E, R>,
): Either.Either<
  RecordAttachmentWriteContents<Owner, Payload, E, R>,
  RecordAttachmentClosureInvalid
> {
  const checked = validateRecordAttachmentWrite(write);
  if (Either.isLeft(checked) || !isObject(write)) {
    return Either.left(Either.isLeft(checked) ? checked.left : closureInvalidForWrite());
  }
  const runtime = writes.get(write);
  if (runtime?.definition === undefined || runtime.build === undefined || !Array.isArray(runtime.build.blobs)) {
    throw new Error("RecordAttachment write passed closure validation without retained contents");
  }
  const captured: { readonly ref: RecordBlobRef; readonly stream: Stream.Stream<Uint8Array, E, R> }[] = [];
  for (const draft of runtime.build.blobs) {
    const draftRuntime = isObject(draft) ? blobDrafts.get(draft) : undefined;
    if (draftRuntime?.source === undefined) {
      throw new Error("RecordAttachment write passed closure validation with an invalid source");
    }
    captured.push(
      Object.freeze({
        ref: draftRuntime.ref,
        stream: draftRuntime.source.stream as Stream.Stream<Uint8Array, E, R>,
      }),
    );
  }
  return Either.right(
    Object.freeze({
      definition: runtime.definition.definition as unknown as JsonRecordAttachmentDefinition<
        Owner,
        Payload
      >,
      payload: runtime.build.payload as Payload,
      blobs: freezeArray(captured),
    }),
  );
}

/** @internal Materialized owner-local bytes supplied by the reader integration. */
export interface RecordAttachmentMaterializedBlob {
  readonly ref: RecordBlobRef;
  readonly bytes: Uint8Array;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function validateMaterializedClosure(
  definition: DefinitionRuntime,
  payload: unknown,
  blobs: unknown,
): Either.Either<
  { readonly payload: unknown; readonly refs: readonly RecordBlobRef[]; readonly bytes: ReadonlyMap<RecordBlobRef, Uint8Array> },
  RecordAttachmentPayloadInvalid | RecordAttachmentClosureInvalid
> {
  const encoded = Schema.encodeUnknownEither(
    definition.schema,
    RecordExactParseOptions,
  )(payload);
  if (Either.isLeft(encoded)) {
    return Either.left(
      recordAttachmentPayloadInvalid([
        recordAttachmentIssue("record-attachment-schema-invalid", []),
      ]),
    );
  }
  if (!isAttachmentJson(encoded.right)) {
    return Either.left(
      recordAttachmentPayloadInvalid([
        recordAttachmentIssue("record-attachment-json-invalid", []),
      ]),
    );
  }

  const normalizedEncoded = cloneAttachmentJson(encoded.right as RecordAttachmentJson);
  const decoded = Schema.decodeUnknownEither(
    definition.schema,
    RecordExactParseOptions,
  )(normalizedEncoded);
  if (Either.isLeft(decoded)) {
    throw new Error("RecordAttachment Schema encoded a value it cannot decode");
  }

  const issues: RecordAttachmentIssue[] = [];
  const projected = validateProjectedRefs(definition, decoded.right, undefined, issues);
  const expected = new Set<RecordBlobRef>(projected ?? []);
  const materialized = new Map<RecordBlobRef, Uint8Array>();

  if (!Array.isArray(blobs)) {
    issues.push(recordAttachmentIssue("record-attachment-closure-mismatch", ["blobs"]));
  } else {
    for (const [index, entry] of blobs.entries()) {
      const ref = readOwn(entry, "ref");
      const bytes = readOwn(entry, "bytes");
      if (!isRecordBlobRef(ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-illegal", ["blobs", String(index), "ref"]));
        continue;
      }
      if (!isUint8Array(bytes)) {
        issues.push(recordAttachmentIssue("record-attachment-snapshot-bytes-invalid", ["blobs", String(index), "bytes"]));
        continue;
      }
      if (materialized.has(ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-duplicate", ["blobs", String(index)]));
        continue;
      }
      materialized.set(ref, new Uint8Array(bytes));
      if (!expected.has(ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-extra", ["blobs", String(index)]));
      }
    }
  }

  if (projected !== undefined) {
    for (const [index, ref] of projected.entries()) {
      if (!materialized.has(ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-missing", ["payload", String(index)]));
      }
    }
  }

  return issues.length === 0
    ? Either.right(
        Object.freeze({
          payload: decoded.right,
          refs: freezeArray(projected ?? []),
          bytes: materialized,
        }),
      )
    : Either.left(recordAttachmentClosureInvalid(issues));
}

/**
 * @internal Create the self-contained value returned by an available reader
 * state. It performs no I/O and defensively copies all supplied bytes.
 */
export function makeRecordAttachmentValue<
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  definition: JsonRecordAttachmentDefinition<Owner, Payload>,
  payload: Payload,
  blobs: readonly RecordAttachmentMaterializedBlob[],
): Either.Either<
  RecordAttachmentValue<Payload>,
  RecordAttachmentPayloadInvalid | RecordAttachmentClosureInvalid
> {
  const runtime = definitionRuntime(definition);
  if (runtime === undefined) {
    return Either.left(payloadInvalidForDefinition());
  }
  const checked = validateMaterializedClosure(runtime, payload, blobs);
  if (Either.isLeft(checked)) {
    return Either.left(checked.left);
  }

  const snapshotBytes = new Map<RecordBlobRef, Uint8Array>();
  for (const [ref, bytes] of checked.right.bytes) {
    snapshotBytes.set(ref, bytes);
  }
  const refs = freezeArray(checked.right.refs);
  const snapshotBlobs: RecordAttachmentBlobs = Object.freeze({
    refs: () => freezeArray(refs),
    bytes: (ref: RecordBlobRef) => {
      const bytes = isObject(ref) ? snapshotBytes.get(ref) : undefined;
      return bytes === undefined
        ? Either.left(recordBlobHandleInvalid)
        : Either.right(new Uint8Array(bytes));
    },
  });
  const value = {
    payload: deepFreezePayload(checked.right.payload as Payload),
    blobs: snapshotBlobs,
    [recordAttachmentValueBrand]: () => recordAttachmentTypeWitness<Payload>(),
  } as unknown as RecordAttachmentValue<Payload>;
  values.set(
    value,
    Object.freeze({ definition: runtime, refs, bytes: snapshotBytes }),
  );
  return Either.right(Object.freeze(value));
}

/** @internal Rejects a forged value before storage/migration integration accesses it. */
export function isRecordAttachmentValue(
  value: unknown,
): value is RecordAttachmentValue<unknown> {
  return isObject(value) && values.has(value);
}

/** @internal Exact runtime accessor for migration and projection integration. */
export function recordAttachmentValueDefinition<Payload>(
  value: RecordAttachmentValue<Payload>,
): JsonRecordAttachmentDefinition<RecordAttachmentOwner, Payload> | undefined {
  const runtime = isObject(value) ? values.get(value) : undefined;
  if (runtime === undefined) {
    return undefined;
  }
  return runtime.definition.definition as unknown as JsonRecordAttachmentDefinition<
    RecordAttachmentOwner,
    Payload
  >;
}

function migrationPairIssues(
  from: DefinitionRuntime | undefined,
  to: DefinitionRuntime | undefined,
): RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (from === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["from"]));
  }
  if (to === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["to"]));
  }
  if (from === undefined || to === undefined) {
    return issues;
  }
  if (from.owner !== to.owner) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["owner"]));
  }
  if (from.name !== to.name) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["name"]));
  }
  const fromVersion = schemaVersion(from.schemaId);
  const toVersion = schemaVersion(to.schemaId);
  if (
    fromVersion === undefined ||
    toVersion === undefined ||
    incrementDecimal(fromVersion) !== toVersion
  ) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["schemaId"]));
  }
  return issues;
}

function migrationInputDefinitions(input: unknown): {
  readonly from: DefinitionRuntime | undefined;
  readonly to: DefinitionRuntime | undefined;
} {
  const fromValue = readOwn(input, "from");
  const toValue = readOwn(input, "to");
  return Object.freeze({
    from: isObject(fromValue) ? definitions.get(fromValue) : undefined,
    to: isObject(toValue) ? definitions.get(toValue) : undefined,
  });
}

function migrationTarget<Owner extends RecordAttachmentOwner, To>(
  definition: JsonRecordAttachmentDefinition<Owner, To>,
): RecordAttachmentMigrationTarget<Owner, To> {
  const target: RecordAttachmentMigrationTarget<Owner, To> = {
    create<const Blobs extends RecordBlobDrafts>(
      build: (
        blobs: RecordAttachmentBlobBuilder,
      ) => RecordAttachmentBlobBuild<To, Blobs>,
    ): RecordAttachmentWrite<
      Owner,
      RecordBlobErrors<Blobs>,
      RecordBlobRequirements<Blobs>
    > {
      return makeRecordAttachmentWriteForDefinition(definition, build);
    },
  };
  return Object.freeze(target);
}

/** Define one lossless adjacent edge. The converter is stored but never run here. */
export function defineRecordAttachmentMigration<
  Owner extends RecordAttachmentOwner,
  From,
  To,
  E,
  R,
>(
  input: DefineRecordAttachmentMigrationInput<Owner, From, To, E, R>,
): Either.Either<
  RecordAttachmentMigration<Owner, E, R>,
  RecordAttachmentMigrationDefinitionError
> {
  const pair = migrationInputDefinitions(input);
  const convert = readOwn(input, "convert");
  const issues = migrationPairIssues(pair.from, pair.to);
  if (typeof convert !== "function") {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["convert"]));
  }
  if (issues.length > 0 || pair.from === undefined || pair.to === undefined || typeof convert !== "function") {
    return Either.left(recordAttachmentMigrationDefinitionInvalid(issues));
  }
  const migration = {
    [recordAttachmentMigrationEdgeBrand]: () => recordAttachmentTypeWitness<Owner>(),
    [recordAttachmentMigrationBrand]: () =>
      recordAttachmentTypeWitness<{ readonly error: E; readonly requirements: R }>(),
  } as unknown as RecordAttachmentMigration<Owner, E, R>;
  migrationEdges.set(
    migration,
    Object.freeze({
      edge: migration as unknown as RecordAttachmentMigrationEdge<RecordAttachmentOwner>,
      from: pair.from,
      to: pair.to,
      kind: "converter" as const,
      convert: convert as unknown as MigrationEdgeRuntime["convert"],
      reason: undefined,
      valid: true,
    }),
  );
  return Either.right(Object.freeze(migration));
}

/** Declare a settled, adjacent non-lossless edge. Family construction validates it. */
export function declareRecordAttachmentMigrationUnavailable<
  Owner extends RecordAttachmentOwner,
  From,
  To,
>(
  input: DeclareRecordAttachmentMigrationUnavailableInput<Owner, From, To>,
): RecordAttachmentMigrationEdge<Owner> {
  const pair = migrationInputDefinitions(input);
  const rawReason = readOwn(input, "reason");
  const reason = typeof rawReason === "string" ? rawReason : undefined;
  const issues = migrationPairIssues(pair.from, pair.to);
  if (reason === undefined || reason.trim().length === 0) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["reason"]));
  }
  const edge = {
    [recordAttachmentMigrationEdgeBrand]: () => recordAttachmentTypeWitness<Owner>(),
  } as unknown as RecordAttachmentMigrationEdge<Owner>;
  migrationEdges.set(
    edge,
    Object.freeze({
      edge: edge as unknown as RecordAttachmentMigrationEdge<RecordAttachmentOwner>,
      from: pair.from,
      to: pair.to,
      kind: "unavailable" as const,
      convert: undefined,
      reason,
      valid: issues.length === 0,
    }),
  );
  return Object.freeze(edge);
}

function familyEdgeIssues(
  current: DefinitionRuntime,
  edge: MigrationEdgeRuntime,
  path: readonly string[],
): RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!edge.valid || edge.from === undefined || edge.to === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", path));
    return issues;
  }
  if (edge.from.owner !== current.owner || edge.to.owner !== current.owner) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", [...path, "owner"]));
  }
  if (edge.from.name !== current.name || edge.to.name !== current.name) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", [...path, "name"]));
  }
  const fromVersion = schemaVersion(edge.from.schemaId);
  const toVersion = schemaVersion(edge.to.schemaId);
  const currentVersion = schemaVersion(current.schemaId);
  if (
    fromVersion === undefined ||
    toVersion === undefined ||
    currentVersion === undefined ||
    incrementDecimal(fromVersion) !== toVersion ||
    decimalCompare(toVersion, currentVersion) > 0
  ) {
    issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", [...path, "schemaId"]));
  }
  return issues;
}

/**
 * Define one complete family. Every historic version to the current definition
 * must be linked by exactly one adjacent edge; disconnected, duplicate, forked,
 * skipped, reverse, and future edges are all rejected before storage observes it.
 */
export function defineRecordAttachmentFamily<
  Owner extends RecordAttachmentOwner,
  Current,
>(
  input: DefineRecordAttachmentFamilyInput<Owner, Current>,
): Either.Either<RecordAttachmentFamily<Owner, Current>, RecordAttachmentFamilyError> {
  const currentValue = readOwn(input, "current");
  const current = isObject(currentValue) ? definitions.get(currentValue) : undefined;
  const migrationsValue = readOwn(input, "migrations");
  const issues: RecordAttachmentIssue[] = [];
  if (current === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-family-invalid", ["current"]));
  }
  if (!Array.isArray(migrationsValue)) {
    issues.push(recordAttachmentIssue("record-attachment-family-invalid", ["migrations"]));
  }
  if (current === undefined || !Array.isArray(migrationsValue)) {
    return Either.left(recordAttachmentFamilyInvalid(issues));
  }

  const byFrom = new Map<string, MigrationEdgeRuntime>();
  const bySchemaId = new Map<string, DefinitionRuntime>();
  bySchemaId.set(current.schemaId, current);
  for (const [index, candidate] of migrationsValue.entries()) {
    const edge = isObject(candidate) ? migrationEdges.get(candidate) : undefined;
    const path = ["migrations", String(index)];
    if (edge === undefined) {
      issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", path));
      continue;
    }
    appendIssues(issues, familyEdgeIssues(current, edge, path));
    if (!edge.valid || edge.from === undefined || edge.to === undefined) {
      continue;
    }
    const fromVersion = schemaVersion(edge.from.schemaId);
    if (fromVersion === undefined) {
      continue;
    }
    const prior = byFrom.get(fromVersion);
    if (prior !== undefined) {
      const code = prior.to?.definition === edge.to.definition
        ? "record-attachment-migration-edge-duplicate"
        : "record-attachment-migration-edge-fork";
      issues.push(recordAttachmentIssue(code, path));
      continue;
    }
    byFrom.set(fromVersion, edge);
    for (const definition of [edge.from, edge.to]) {
      const priorDefinition = bySchemaId.get(definition.schemaId);
      if (priorDefinition !== undefined && priorDefinition.definition !== definition.definition) {
        issues.push(recordAttachmentIssue("record-attachment-migration-edge-fork", path));
      } else {
        bySchemaId.set(definition.schemaId, definition);
      }
    }
  }

  const currentVersion = schemaVersion(current.schemaId);
  if (currentVersion === undefined) {
    issues.push(recordAttachmentIssue("record-attachment-family-invalid", ["current", "schemaId"]));
  } else {
    let version = "1";
    let traversed = 0;
    let lastEdge: MigrationEdgeRuntime | undefined;
    while (version !== currentVersion) {
      const edge = byFrom.get(version);
      if (edge === undefined) {
        issues.push(recordAttachmentIssue("record-attachment-migration-edge-missing", ["migrations", version]));
        break;
      }
      const next = edge.to === undefined ? undefined : schemaVersion(edge.to.schemaId);
      if (next === undefined || decimalCompare(next, version) <= 0) {
        issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["migrations", version]));
        break;
      }
      traversed += 1;
      lastEdge = edge;
      version = next;
    }
    if (traversed !== byFrom.size) {
      issues.push(recordAttachmentIssue("record-attachment-family-invalid", ["migrations"]));
    }
    if (
      currentVersion !== "1" &&
      (lastEdge?.to === undefined || lastEdge.to.definition !== current.definition)
    ) {
      issues.push(recordAttachmentIssue("record-attachment-migration-edge-invalid", ["migrations", "current"]));
    }
  }

  if (issues.length > 0) {
    return Either.left(recordAttachmentFamilyInvalid(issues));
  }
  const family = {
    [recordAttachmentFamilyBrand]: () =>
      recordAttachmentTypeWitness<{ readonly owner: Owner; readonly payload: Current }>(),
  } as unknown as RecordAttachmentFamily<Owner, Current>;
  families.set(
    family,
    Object.freeze({ current, bySchemaId, edgesFrom: byFrom }),
  );
  return Either.right(Object.freeze(family));
}

/** Resolve a known historical schema against a genuine current family. */
export function resolveRecordAttachmentMigration<
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
  sourceSchemaId: RecordAttachmentSchemaId,
): RecordAttachmentMigrationResolution | undefined {
  const runtime = familyRuntime(family);
  if (runtime === undefined) {
    return undefined;
  }
  if (sourceSchemaId === runtime.current.schemaId) {
    return Object.freeze({ state: "current" as const });
  }
  const source = runtime.bySchemaId.get(sourceSchemaId);
  if (source === undefined || source.name !== runtime.current.name) {
    return Object.freeze({ state: "unsupported" as const });
  }
  const edges: RecordAttachmentMigrationEdge<RecordAttachmentOwner>[] = [];
  let schemaId = source.schemaId;
  while (schemaId !== runtime.current.schemaId) {
    const version = schemaVersion(schemaId);
    const edge = version === undefined ? undefined : runtime.edgesFrom.get(version);
    if (edge === undefined || edge.to === undefined) {
      throw new Error("RecordAttachment family registry lost a validated migration edge");
    }
    if (edge.kind === "unavailable") {
      return Object.freeze({
        state: "migration-unavailable" as const,
        from: sourceSchemaId,
        to: runtime.current.schemaId,
        reason: edge.reason ?? "migration unavailable",
      });
    }
    edges.push(edge.edge);
    schemaId = edge.to.schemaId;
  }
  return Object.freeze({
    state: "migration-required" as const,
    from: sourceSchemaId,
    to: runtime.current.schemaId,
    edges: freezeArray(edges),
  });
}

/**
 * @internal Run one trusted converter at the integration boundary. `suspend`
 * turns a callback throw into an Effect defect while preserving its explicit E
 * failures and any fiber interruption without catch/recovery.
 */
export function runRecordAttachmentMigration<
  Owner extends RecordAttachmentOwner,
  From,
  E,
  R,
>(
  migration: RecordAttachmentMigration<Owner, E, R>,
  source: RecordAttachmentValue<From>,
): Effect.Effect<RecordAttachmentWrite<Owner, E, R>, E, R> {
  return Effect.suspend(() => {
    const runtime = isObject(migration) ? migrationEdges.get(migration) : undefined;
    if (
      runtime === undefined ||
      !runtime.valid ||
      runtime.kind !== "converter" ||
      runtime.to === undefined ||
      runtime.convert === undefined ||
      !isRecordAttachmentValue(source)
    ) {
      return Effect.die(new Error("RecordAttachment migration capability is invalid"));
    }
    const target = migrationTarget(
      runtime.to.definition as unknown as JsonRecordAttachmentDefinition<Owner, unknown>,
    );
    return runtime.convert(
      source as unknown as RecordAttachmentValue<unknown>,
      target as unknown as RecordAttachmentMigrationTarget<RecordAttachmentOwner, unknown>,
    ) as Effect.Effect<RecordAttachmentWrite<Owner, E, R>, E, R>;
  });
}

function registryKey(owner: RecordAttachmentOwner, name: RecordAttachmentName): string {
  return `${owner}\u0000${name}`;
}

/** Define a pure installed-family registry without touching storage or services. */
export function defineRecordAttachmentRegistry(
  input:
    | readonly AnyRecordAttachmentFamily[]
    | { readonly families: readonly AnyRecordAttachmentFamily[] },
): Either.Either<RecordAttachmentRegistry, RecordAttachmentRegistryError> {
  const candidates = Array.isArray(input) ? input : readOwn(input, "families");
  const issues: RecordAttachmentIssue[] = [];
  if (!Array.isArray(candidates)) {
    return Either.left(
      recordAttachmentRegistryInvalid([
        recordAttachmentIssue("record-attachment-family-invalid", ["families"]),
      ]),
    );
  }
  const registered = new Map<string, AnyRecordAttachmentFamily>();
  for (const [index, candidate] of candidates.entries()) {
    const runtime = isObject(candidate) ? families.get(candidate) : undefined;
    if (runtime === undefined) {
      issues.push(recordAttachmentIssue("record-attachment-family-invalid", ["families", String(index)]));
      continue;
    }
    const key = registryKey(runtime.current.owner, runtime.current.name);
    if (registered.has(key)) {
      issues.push(recordAttachmentIssue("record-attachment-registry-family-duplicate", ["families", String(index)]));
      continue;
    }
    registered.set(key, candidate as AnyRecordAttachmentFamily);
  }
  if (issues.length > 0) {
    return Either.left(recordAttachmentRegistryInvalid(issues));
  }
  const registry = {
    [recordAttachmentRegistryBrand]: () => recordAttachmentTypeWitness<void>(),
  } as unknown as RecordAttachmentRegistry;
  registries.set(registry, Object.freeze({ families: registered }));
  return Either.right(Object.freeze(registry));
}

/** @internal Exact lookup used by reader/migration integration. */
export function recordAttachmentRegistryFamily(
  registry: RecordAttachmentRegistry,
  owner: RecordAttachmentOwner,
  name: RecordAttachmentName,
): AnyRecordAttachmentFamily | undefined {
  const runtime = isObject(registry) ? registries.get(registry) : undefined;
  return runtime?.families.get(registryKey(owner, name));
}

/** @internal Runtime guard for package-private integration boundaries. */
export function isJsonRecordAttachmentDefinition(
  value: unknown,
): value is JsonRecordAttachmentDefinition<RecordAttachmentOwner, unknown> {
  return isObject(value) && definitions.has(value);
}

/** @internal Runtime guard for genuine family capabilities. */
export function isRecordAttachmentFamily(
  value: unknown,
): value is RecordAttachmentFamily<RecordAttachmentOwner, unknown> {
  return isObject(value) && families.has(value);
}

/** @internal Returns the exact registered current definition, never a field copy. */
export function recordAttachmentFamilyCurrentDefinition<
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
): JsonRecordAttachmentDefinition<Owner, Payload> | undefined {
  const runtime = familyRuntime(family);
  return runtime?.current.definition as unknown as
    | JsonRecordAttachmentDefinition<Owner, Payload>
    | undefined;
}

/** @internal Reads owner only from a genuine family registry record. */
export function recordAttachmentFamilyOwner<
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
): Owner | undefined {
  return familyRuntime(family)?.current.owner as Owner | undefined;
}

/** @internal Runtime guard for a genuine installed registry. */
export function isRecordAttachmentRegistry(
  value: unknown,
): value is RecordAttachmentRegistry {
  return isObject(value) && registries.has(value);
}
