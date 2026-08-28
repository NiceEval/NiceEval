import { Result, Schema, SchemaAST } from "effect";

import type { RecordAttachmentOwner } from "../model/core.ts";
import { isRecordAttachmentName } from "../model/identifiers.ts";
import { compileRecordSchemaCodec, type RecordSchemaCodec, type RecordSchemaWire } from "../definition/schema-codec.ts";
import { RecordBytesContentSchema, RecordTextContentSchema, isRecordBytesContentHandle, isRecordContentHandle, isRecordTextContentHandle, recordContentDeclarationMetadata, type RecordContentHandle } from "./content.ts";
import { RecordAttachmentSpiDefinitionError, type RecordAttachmentIssue } from "./errors.ts";

const definitionTypeId: unique symbol = Symbol("@niceeval/record/RecordAttachmentDefinition");
const persistenceTypeId: unique symbol = Symbol("@niceeval/record/RecordAttachmentPersistence");
const referenceTypeId: unique symbol = Symbol("@niceeval/record/RecordAttachmentReference");

const definitions = new WeakMap<object, DefinitionRuntime>();
const definitionAliases = new WeakMap<object, AnyDefinition>();
const persistences = new WeakSet<object>();
const references = new WeakMap<object, ReferenceRuntime>();
const referenceDeclarations = new WeakMap<object, ReferenceDeclarationRuntime>();
const referenceDeclarationRuns = new WeakMap<SchemaAST.DeclarationRun, ReferenceDeclarationRuntime>();

export type RecordAttachmentSchema = Schema.Codec<unknown, unknown, never, never>;

type AnyDefinition = RecordAttachmentDefinition<RecordAttachmentOwner, string, Schema.Top>;

export interface RecordAttachmentReferenceTarget {
  readonly owner: RecordAttachmentOwner;
  readonly family: string;
  readonly schema: Schema.Top;
}

type ResolvedReferenceDefinition<Definition extends RecordAttachmentReferenceTarget> =
  Definition extends AnyDefinition ? Definition : AnyDefinition;

interface DefinitionRuntime {
  readonly codec: RecordSchemaCodec<unknown, RecordContentHandle | RecordAttachmentReference<AnyDefinition, unknown>>;
}
interface ReferenceDeclarationRuntime {
  readonly definition: AnyDefinition;
  readonly valueSchema: Schema.Codec<unknown, unknown, never, never> | undefined;
}
interface ReferenceRuntime extends ReferenceDeclarationRuntime { readonly value: unknown; }

function mintedReferenceDeclarationRuntime(value: object): ReferenceDeclarationRuntime | undefined {
  const direct = referenceDeclarations.get(value);
  if (direct !== undefined || !SchemaAST.isAST(value) || !SchemaAST.isDeclaration(value)) return direct;
  if (
    value.typeParameters.length !== 0 ||
    value.checks !== undefined ||
    value.encoding !== undefined ||
    value.context !== undefined ||
    value.encodingChecks !== undefined ||
    value.encodingRun !== undefined && value.encodingRun !== value.run
  ) return undefined;
  return referenceDeclarationRuns.get(value.run);
}

export interface RecordAttachmentDefinition<
  out Owner extends RecordAttachmentOwner,
  out Family extends string,
  ValueSchema extends Schema.Top,
> {
  readonly owner: Owner;
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate: ((value: Schema.Schema.Type<ValueSchema>) => readonly RecordAttachmentIssue[]) | undefined;
  readonly [definitionTypeId]: () => { readonly owner: Owner; readonly family: Family };
}

/** Durable interpretation revision, deliberately separate from the logical fact definition. */
export interface RecordAttachmentPersistence<
  Definition extends AnyDefinition,
  out Revision extends number,
> {
  readonly attachment: Definition;
  readonly revision: Revision;
  readonly [persistenceTypeId]: () => { readonly attachment: Definition; readonly revision: Revision };
}

/** Exact-definition reference token. Its wire identity is owner/family only. */
export interface RecordAttachmentReference<Definition extends AnyDefinition, Value = unknown> {
  readonly value: Value;
  readonly [referenceTypeId]: typeof referenceTypeId;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function validOwner(value: unknown): value is RecordAttachmentOwner {
  return value === "run" || value === "attempt";
}
function invalid(cause?: unknown): never {
  throw new RecordAttachmentSpiDefinitionError("invalid-family-definition", cause);
}

/** Record persistence is synchronous; reject declarations that retain a service context. */
export function isRecordAttachmentSchema(schema: Schema.Top): schema is RecordAttachmentSchema {
  return schema.ast.context === undefined;
}

/** Defines only the current logical fact: no revision, migration, writer or storage selector. */
export function defineRecordAttachment<
  const Owner extends RecordAttachmentOwner,
  const Family extends string,
  const ValueSchema extends Schema.Top,
>(input: {
  readonly owner: Owner;
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate?: (value: Schema.Schema.Type<ValueSchema>) => readonly RecordAttachmentIssue[];
}): RecordAttachmentDefinition<Owner, Family, ValueSchema> {
  if (!validOwner(input.owner) || !isRecordAttachmentName(input.family) || !isRecordAttachmentSchema(input.schema) || typeof input.validate !== "undefined" && typeof input.validate !== "function") invalid();
  const limits = {
    maximumJsonBytes: 1_048_576, maximumDepth: 64, maximumNodes: 100_000,
    maximumObjectKeys: 10_000, maximumArrayItems: 100_000,
    maximumKeyUtf8Bytes: 16_384, maximumStringUtf8Bytes: 1_048_576,
  };
  const definition = Object.freeze({
    owner: input.owner, family: input.family, schema: input.schema, validate: input.validate,
    [definitionTypeId]: () => ({ owner: input.owner, family: input.family }),
  }) as RecordAttachmentDefinition<Owner, Family, ValueSchema>;
  try {
    definitions.set(definition, Object.freeze({ codec: compileRecordSchemaCodec({
      schema: input.schema,
      limits,
      attachmentDeclarations: [
        { schema: RecordTextContentSchema, isValue: isRecordTextContentHandle, metadata: recordContentDeclarationMetadata(RecordTextContentSchema) },
        { schema: RecordBytesContentSchema, isValue: isRecordBytesContentHandle, metadata: recordContentDeclarationMetadata(RecordBytesContentSchema) },
      ],
      getAttachmentDeclaration: (ast) => {
        const reference = recordAttachmentReferenceDeclarationMetadata(ast);
        if (reference !== undefined) return reference;
        const content = recordContentDeclarationMetadata(ast);
        return content === undefined ? undefined : Object.freeze({
          metadata: content,
          accepts: content.kind === "text" ? isRecordTextContentHandle : isRecordBytesContentHandle,
        });
      },
      isAttachmentOpaque: (value) => isRecordAttachmentReference(value)
        ? { category: "reference" }
        : isRecordContentHandle(value) ? { category: "content" } : undefined,
    }) as RecordSchemaCodec<unknown, RecordContentHandle | RecordAttachmentReference<AnyDefinition, unknown>> }));
  } catch (cause) { invalid(cause); }
  return definition;
}

/** Binds a definition to its one current durable interpretation revision. */
export function defineRecordAttachmentPersistence<
  const Definition extends AnyDefinition,
  const Revision extends number,
>(input: { readonly attachment: Definition; readonly revision: Revision }): RecordAttachmentPersistence<Definition, Revision> {
  if (!isRecordAttachmentDefinition(input.attachment) || !positive(input.revision)) invalid();
  const persistence = Object.freeze({ attachment: input.attachment, revision: input.revision, [persistenceTypeId]: () => ({ attachment: input.attachment, revision: input.revision }) }) as RecordAttachmentPersistence<Definition, Revision>;
  persistences.add(persistence);
  return persistence;
}

export const RecordAttachmentReference = Object.freeze({
  /** Builds a package-owned Schema declaration. Session later mints values matching this exact declaration. */
  to<Definition extends RecordAttachmentReferenceTarget, Value = unknown, Encoded = Value>(definition: Definition, valueSchema?: Schema.Codec<Value, Encoded, never>): Schema.Codec<RecordAttachmentReference<ResolvedReferenceDefinition<Definition>, Value>, RecordAttachmentReference<ResolvedReferenceDefinition<Definition>, Value>, never> {
    const resolved = resolveRecordAttachmentDefinition(definition);
    if (resolved === undefined) invalid();
    type Resolved = ResolvedReferenceDefinition<Definition>;
    const declaration = Schema.declare<RecordAttachmentReference<Resolved, Value>>(
      (value): value is RecordAttachmentReference<Resolved, Value> => {
        const runtime = isRecordAttachmentReference(value) ? references.get(value) : undefined;
        return runtime !== undefined && runtime.definition === resolved &&
          (valueSchema === undefined || !Result.isFailure(Schema.decodeUnknownResult(valueSchema)(runtime.value)));
      },
      { identifier: `RecordAttachmentReference<${resolved.owner}:${resolved.family}>` },
    );
    referenceDeclarations.set(declaration, Object.freeze({ definition: resolved, valueSchema }));
    referenceDeclarations.set(declaration.ast, Object.freeze({ definition: resolved, valueSchema }));
    referenceDeclarationRuns.set(declaration.ast.run, Object.freeze({ definition: resolved, valueSchema }));
    return declaration;
  },
});

export function isRecordAttachmentDefinition(value: unknown): value is AnyDefinition { return typeof value === "object" && value !== null && definitions.has(value); }
/** @internal High-level collection authoring accepts plain-data item declarations only. */
export function recordAttachmentDefinitionHasOpaqueDeclarations(
  definition: AnyDefinition,
): boolean {
  return definitions.get(definition)?.codec.opaqueDeclarationMetadata.length !== 0;
}
/** @internal Registers one package-owned high-level callable as an alias of its exact Attachment definition. */
export function registerRecordAttachmentDefinitionAlias(alias: object, definition: unknown): void {
  if (!isRecordAttachmentDefinition(definition)) invalid();
  definitionAliases.set(alias, definition);
}
/** @internal Resolves exact definitions and package-owned high-level aliases; structural lookalikes never resolve. */
export function resolveRecordAttachmentDefinition(value: unknown): AnyDefinition | undefined {
  if (isRecordAttachmentDefinition(value)) return value;
  return (typeof value === "object" && value !== null) || typeof value === "function"
    ? definitionAliases.get(value)
    : undefined;
}
export function isRecordAttachmentPersistence(value: unknown): value is RecordAttachmentPersistence<AnyDefinition, number> { return typeof value === "object" && value !== null && persistences.has(value); }
export function isRecordAttachmentReference(value: unknown): value is RecordAttachmentReference<AnyDefinition, unknown> { return typeof value === "object" && value !== null && references.has(value); }
/** @internal Schema compiler validates and labels only declarations minted by `to`. */
export function recordAttachmentReferenceDeclarationMetadata(value: object): { readonly metadata: { readonly category: "reference"; readonly definition: AnyDefinition; readonly valueSchema: Schema.Codec<unknown, unknown, never, never> | undefined }; readonly accepts: (value: object) => boolean } | undefined {
  const runtime = mintedReferenceDeclarationRuntime(value);
  return runtime === undefined ? undefined : Object.freeze({
    metadata: Object.freeze({ category: "reference", definition: runtime.definition, valueSchema: runtime.valueSchema }),
    accepts: (candidate) => isRecordAttachmentReference(candidate) && references.get(candidate)?.definition === runtime.definition &&
      (runtime.valueSchema === undefined || !Result.isFailure(Schema.decodeUnknownResult(runtime.valueSchema)(references.get(candidate)?.value))),
  });
}

/** @internal Session-only mint; declaration identity, optional value schema, and exact definition are all checked. */
export function mintRecordAttachmentReference<Definition extends AnyDefinition, Value>(declaration: Schema.Codec<RecordAttachmentReference<Definition, Value>, RecordAttachmentReference<Definition, Value>, never>, value: Value): RecordAttachmentReference<Definition, Value> {
  const runtime = referenceDeclarations.get(declaration);
  if (runtime === undefined) throw new TypeError("Record Attachment reference requires a package-owned declaration");
  if (runtime.valueSchema !== undefined && Result.isFailure(Schema.decodeUnknownResult(runtime.valueSchema)(value))) throw new TypeError("Record Attachment reference value is invalid");
  const token = Object.freeze({ value, [referenceTypeId]: referenceTypeId }) as RecordAttachmentReference<Definition, Value>;
  references.set(token, Object.freeze({ ...runtime, value }));
  return token;
}

/** @internal Host uses these to mint/validate closure without leaking storage capabilities. */
export function enumerateRecordAttachmentClosure(definition: AnyDefinition, value: unknown): Result.Result<{ readonly contents: readonly RecordContentHandle[]; readonly references: readonly RecordAttachmentReference<AnyDefinition, unknown>[] }, { readonly code: "exact-decode-failed" | "invariant-failed" | "content-closure-failed" | "reference-closure-failed" }> {
  const runtime = definitions.get(definition);
  if (runtime === undefined) return Result.fail({ code: "exact-decode-failed" });
  const encoded = runtime.codec.encode(value as never);
  if (Result.isFailure(encoded)) return Result.fail({ code: "exact-decode-failed" });
  const decoded = runtime.codec.decode(encoded.success);
  if (Result.isFailure(decoded)) return Result.fail({ code: "exact-decode-failed" });
  if (definition.validate?.(decoded.success as never).length) return Result.fail({ code: "invariant-failed" });
  const contents: RecordContentHandle[] = [], refs: RecordAttachmentReference<AnyDefinition, unknown>[] = [];
  // The Schema compiler's declaration registry is the closure executor: only
  // values inhabiting a package-owned declaration count, never incidental objects.
  for (const entry of runtime.codec.enumerateOpaque(decoded.success)) {
    const metadata = entry.metadata as { readonly category?: string } | undefined;
    if (isRecordContentHandle(entry.value) && metadata?.category === "content") contents.push(entry.value);
    if (isRecordAttachmentReference(entry.value) && metadata?.category === "reference") refs.push(entry.value);
  }
  if (new Set(contents).size !== contents.length) return Result.fail({ code: "content-closure-failed" });
  if (new Set(refs).size !== refs.length) return Result.fail({ code: "reference-closure-failed" });
  return Result.succeed(Object.freeze({ contents: Object.freeze(contents), references: Object.freeze(refs) }));
}
/** @internal Host-only diagnostic/closure metadata; family code never receives Schema AST. */
export function inspectRecordAttachmentOpaqueClosure(definition: AnyDefinition, value: unknown): Result.Result<readonly { readonly value: object; readonly metadata: unknown }[], { readonly code: "exact-decode-failed" }> {
  const runtime = definitions.get(definition);
  if (runtime === undefined) return Result.fail({ code: "exact-decode-failed" });
  const encoded = runtime.codec.encode(value as never);
  if (Result.isFailure(encoded)) return Result.fail({ code: "exact-decode-failed" });
  const decoded = runtime.codec.decode(encoded.success);
  return Result.isFailure(decoded) ? Result.fail({ code: "exact-decode-failed" }) : Result.succeed(runtime.codec.enumerateOpaque(decoded.success));
}
/** @internal Exact current codec encode for Core's physical encoder; opaque leaves remain sealed tokens. */
export function encodeRecordAttachmentCurrent(definition: AnyDefinition, value: unknown): Result.Result<RecordSchemaWire<RecordContentHandle | RecordAttachmentReference<AnyDefinition, unknown>>, { readonly code: "exact-encode-failed" | "invariant-failed" | "content-closure-failed" | "reference-closure-failed" }> {
  const closure = enumerateRecordAttachmentClosure(definition, value);
  if (Result.isFailure(closure)) {
    switch (closure.failure.code) {
      case "exact-decode-failed": return Result.fail({ code: "exact-encode-failed" });
      case "invariant-failed": return Result.fail({ code: "invariant-failed" });
      case "content-closure-failed": return Result.fail({ code: "content-closure-failed" });
      case "reference-closure-failed": return Result.fail({ code: "reference-closure-failed" });
    }
  }
  const runtime = definitions.get(definition);
  if (runtime === undefined) return Result.fail({ code: "exact-encode-failed" });
  const encoded = runtime.codec.encode(value);
  return Result.isFailure(encoded) ? Result.fail({ code: "exact-encode-failed" }) : Result.succeed(encoded.success);
}
/** @internal Host binds validated storage-neutral leaves by exact declaration, never by paths or marker strings. */
export function hydrateRecordAttachmentCurrent<Definition extends AnyDefinition>(
  definition: Definition,
  wire: unknown,
  binder: {
    readonly content: (token: unknown, declaration: { readonly kind: "text" | "bytes"; readonly maximumBytes: number | undefined }) => Result.Result<RecordContentHandle | undefined, { readonly code: "current-content-bind-failed" }>;
    readonly reference: (token: unknown, declaration: { readonly definition: AnyDefinition; readonly valueSchema: Schema.Codec<unknown, unknown, never, never> | undefined }) => Result.Result<RecordAttachmentReference<AnyDefinition, unknown> | undefined, { readonly code: "current-reference-bind-failed" }>;
  },
): Result.Result<Schema.Schema.Type<Definition["schema"]>, { readonly code: "exact-decode-failed" | "invariant-failed" | "content-closure-failed" | "reference-closure-failed" | "current-content-bind-failed" | "current-reference-bind-failed" }> {
  const runtime = definitions.get(definition);
  if (runtime === undefined) return Result.fail({ code: "exact-decode-failed" });
  let failure: { readonly code: "current-content-bind-failed" } | { readonly code: "current-reference-bind-failed" } | undefined;
  const projected = runtime.codec.mapOpaqueEncoded(wire, (token, metadata) => {
    const declaration = metadata as { readonly category?: string; readonly kind?: "text" | "bytes"; readonly maximumBytes?: number; readonly definition?: AnyDefinition; readonly valueSchema?: Schema.Codec<unknown, unknown, never, never> };
    if (declaration.category === "content" && declaration.kind !== undefined) {
      const bound = binder.content(token, { kind: declaration.kind, maximumBytes: declaration.maximumBytes });
      if (Result.isFailure(bound)) { failure = bound.failure; return { _tag: "unmatched" }; }
      if (bound.success === undefined || declaration.kind === "text" && !isRecordTextContentHandle(bound.success) || declaration.kind === "bytes" && !isRecordBytesContentHandle(bound.success)) return { _tag: "unmatched" };
      return { _tag: "matched", value: bound.success };
    }
    if (declaration.category === "reference" && declaration.definition !== undefined) {
      const bound = binder.reference(token, { definition: declaration.definition, valueSchema: declaration.valueSchema });
      if (Result.isFailure(bound)) { failure = bound.failure; return { _tag: "unmatched" }; }
      return bound.success === undefined ? { _tag: "unmatched" } : { _tag: "matched", value: bound.success };
    }
    return { _tag: "unmatched" };
  });
  if (failure !== undefined) return Result.fail(failure);
  const decoded = runtime.codec.decode(projected);
  if (Result.isFailure(decoded)) return Result.fail({ code: "exact-decode-failed" });
  const closure = enumerateRecordAttachmentClosure(definition, decoded.success);
  if (Result.isFailure(closure)) return Result.fail(closure.failure);
  if (definition.validate?.(decoded.success as never).length) return Result.fail({ code: "invariant-failed" });
  return Result.succeed(decoded.success as Schema.Schema.Type<Definition["schema"]>);
}

/** @internal exact definition capability held by a reference token. */
export function recordAttachmentReferenceDefinition(reference: RecordAttachmentReference<AnyDefinition, unknown>): AnyDefinition | undefined { return references.get(reference)?.definition; }
/** @internal Durable wire identity intentionally omits definition capability and all I/O detail. */
export function recordAttachmentReferenceWire(reference: RecordAttachmentReference<AnyDefinition, unknown>): { readonly owner: RecordAttachmentOwner; readonly family: string; readonly value: unknown } | undefined {
  const runtime = references.get(reference);
  return runtime === undefined ? undefined : Object.freeze({ owner: runtime.definition.owner, family: runtime.definition.family, value: runtime.value });
}
