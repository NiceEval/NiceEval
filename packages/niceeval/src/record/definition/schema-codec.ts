import { Cause, Exit, Result, Schema, SchemaAST, SchemaIssue } from "effect";
import {
  canonicalizeRecordValue,
  type RecordCanonicalizationFailure,
  type RecordCanonicalizationOptions,
  type RecordJsonWithBlobRefs,
  type RecordSchemaLimits,
} from "./canonical.ts";

export type { RecordSchemaLimits } from "./canonical.ts";

/** The exact parse policy shared by every current Record schema codec. */
export const RecordSchemaParseOptions = Object.freeze({
  errors: "all" as const,
  exact: true,
  onExcessProperty: "error" as const,
});

export type RecordSchemaWire<Blob extends object = never> = RecordJsonWithBlobRefs<Blob>;

type RecordSchema = Schema.ConstraintDecoder<unknown, never> & Schema.ConstraintEncoder<unknown, never>;

export interface RecordSchemaIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

export type RecordSchemaFailure =
  | { readonly kind: "canonical"; readonly failure: RecordCanonicalizationFailure }
  | { readonly kind: "schema"; readonly issues: readonly RecordSchemaIssue[] };

/**
 * A closed bidirectional durable codec. `Value` is the in-memory Schema.Type;
 * `RecordSchemaWire` is the canonical Schema.Encoded boundary.
 */
export interface RecordSchemaCodec<
  Value,
  Blob extends object = never,
  SourceSchema extends RecordSchema = RecordSchema,
> {
  readonly schema: SourceSchema;
  readonly limits: RecordSchemaLimits;
  readonly decode: (input: unknown) => Result.Result<Value, RecordSchemaFailure>;
  readonly encode: (value: Value) => Result.Result<RecordSchemaWire<Blob>, RecordSchemaFailure>;
  /** Compiler-owned closure executor for declared opaque leaves only. */
  readonly enumerateOpaque: (value: Value) => readonly { readonly value: object; readonly metadata: unknown }[];
  /** Declaration metadata collected from the accepted Schema AST (kind/limits/targets). */
  readonly opaqueDeclarationMetadata: readonly unknown[];
  /** Internal schema-driven projector; callback receives only compiled declaration metadata. */
  readonly mapOpaque: (value: Value, map: (value: unknown, metadata: unknown) => RecordOpaqueMapResult) => unknown;
  /** Same projector on the encoded wire side, before declarations can decode. */
  readonly mapOpaqueEncoded: (wire: unknown, map: (value: unknown, metadata: unknown) => RecordOpaqueMapResult) => unknown;
}
export type RecordOpaqueMapResult =
  | { readonly _tag: "unmatched" }
  | { readonly _tag: "matched"; readonly value: unknown };

interface RecordSchemaBlobRef<Blob extends object> {
  /** The one package-minted Declaration that Attachment codecs may contain. */
  readonly schema: Schema.Codec<Blob, Blob>;
  readonly isBlobRef: (value: object) => value is Blob;
}

/** Package-owned opaque declarations; arbitrary Declaration ASTs remain forbidden. */
interface RecordSchemaOpaqueDeclaration {
  readonly schema: RecordSchema;
  readonly isValue: (value: object) => boolean;
  readonly metadata?: unknown;
}
interface RecordSchemaDynamicDeclaration {
  readonly metadata: unknown;
  readonly accepts: (value: object) => boolean;
}

export interface CompileRecordSchemaCodecInput<
  SourceSchema extends RecordSchema,
  Blob extends object = never,
> {
  readonly schema: SourceSchema;
  readonly limits: RecordSchemaLimits;
  /** Omitted for Core; Attachment supplies the one minted BlobRef declaration. */
  readonly blobRef?: RecordSchemaBlobRef<Blob>;
  readonly attachmentDeclarations?: readonly RecordSchemaOpaqueDeclaration[];
  readonly getAttachmentDeclaration?: (ast: SchemaAST.AST) => RecordSchemaDynamicDeclaration | undefined;
  readonly isAttachmentOpaque?: (value: object) => unknown | undefined;
}

interface AstAuditState {
  readonly declarations: ReadonlySet<SchemaAST.AST>;
  readonly getAttachmentDeclaration: ((ast: SchemaAST.AST) => RecordSchemaDynamicDeclaration | undefined) | undefined;
  readonly states: WeakMap<object, "pending" | "allowed" | "rejected">;
  failure: string | undefined;
}

const schemaFailure: RecordSchemaFailure = Object.freeze({
  kind: "schema" as const,
  issues: Object.freeze([]),
});

function schemaParseFailure(error: Schema.SchemaError): RecordSchemaFailure {
  try {
    const issues: RecordSchemaIssue[] = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) =>
      Object.freeze({
        path: Object.freeze((issue.path ?? []).map((segment) =>
          typeof segment === "object" && segment !== null && "key" in segment
            ? segment.key
            : segment
        )),
        message: issue.message,
      })
    );
    return Object.freeze({
      kind: "schema" as const,
      issues: Object.freeze(issues),
    });
  } catch {
    // Formatting diagnostics must never turn a typed schema rejection into a
    // defect. Callers still receive the stable generic schema failure.
    return schemaFailure;
  }
}

/** Schema Exit/Cause remain at this boundary; durable callers receive only Record failures. */
function schemaParseFailureFromExit(exit: Exit.Failure<unknown, Schema.SchemaError>): RecordSchemaFailure {
  if (exit.cause.reasons.length === 1) {
    const [reason] = exit.cause.reasons;
    if (reason !== undefined && Cause.isFailReason(reason) && Schema.isSchemaError(reason.error)) {
      return schemaParseFailure(reason.error);
    }
  }
  throw exit.cause;
}

function canonicalFailure(failure: RecordCanonicalizationFailure): RecordSchemaFailure {
  return Object.freeze({ kind: "canonical" as const, failure });
}

function assertLimits(limits: RecordSchemaLimits): RecordSchemaLimits {
  for (const [name, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError(`Record schema limit ${name} must be a positive safe integer`);
    }
  }
  return Object.freeze({ ...limits });
}

function isJsonLiteral(value: SchemaAST.LiteralValue): boolean {
  return value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0));
}

/** `undefined` is admitted only as Effect's missing-property marker. */
function isAllowedPropertyValue(ast: SchemaAST.AST, state: AstAuditState): boolean {
  if (ast.context?.isOptional !== true) return isAllowedAst(ast, state);
  if (ast._tag === "Never") return true;
  if (ast._tag !== "Union") return isAllowedAst(ast, state);

  let hasMissingMember = false;
  for (const member of ast.types) {
    if (member._tag === "Undefined" || member._tag === "Never") {
      hasMissingMember = true;
      continue;
    }
    if (!isAllowedAst(member, state)) return false;
  }
  return hasMissingMember;
}

function isAllowedObject(ast: SchemaAST.Objects, state: AstAuditState): boolean {
  return ast.propertySignatures.every((signature) =>
    typeof signature.name === "string" && signature.name.length > 0 &&
    isAllowedPropertyValue(signature.type, state)
  ) && ast.indexSignatures.every((signature) =>
    signature.parameter._tag === "String" && isAllowedPropertyValue(signature.type, state)
  );
}

/** `encodeKeys` is the only admitted encoded-side transformation. */
function isAllowedEncoding(ast: SchemaAST.AST, state: AstAuditState): boolean {
  if (ast.encoding === undefined) return true;
  if (ast._tag !== "Objects" || ast.encoding.length !== 1) return false;
  const link = ast.encoding[0]!;
  if (link.transformation._tag !== "Transformation" || link.to._tag !== "Objects") return false;
  if (ast.propertySignatures.length !== link.to.propertySignatures.length ||
    ast.indexSignatures.length !== link.to.indexSignatures.length) return false;
  return isAllowedObject(link.to, state);
}

/**
 * Record schemas are intentionally a JSON-only AST subset. `Suspend` is
 * audited through its target so recursive JSON Records remain possible.
 */
function isAllowedAst(ast: SchemaAST.AST, state: AstAuditState): boolean {
  const previous = state.states.get(ast);
  if (previous === "allowed" || previous === "pending") return true;
  if (previous === "rejected") return false;
  state.states.set(ast, "pending");
  let allowed: boolean;
  try {
    switch (ast._tag) {
      case "Literal":
        allowed = isJsonLiteral(ast.literal);
        break;
      case "Null":
      case "String":
      case "Number":
      case "Boolean":
        allowed = true;
        break;
      case "Objects":
        allowed = isAllowedObject(ast, state);
        break;
      case "Arrays":
        allowed = ast.elements.every((element) => isAllowedAst(element, state)) &&
          ast.rest.every((element) => isAllowedAst(element, state));
        break;
      case "Union":
        allowed = ast.types.every((member) => isAllowedAst(member, state));
        break;
      case "Suspend":
        allowed = isAllowedAst(ast.thunk(), state);
        break;
      case "Declaration":
        allowed = state.declarations.has(ast) || state.getAttachmentDeclaration?.(ast) !== undefined;
        break;
      default:
        allowed = false;
        break;
    }
  } catch {
    allowed = false;
  }
  allowed &&= isAllowedEncoding(ast, state);
  if (!allowed && state.failure === undefined) state.failure = ast._tag;
  state.states.set(ast, allowed ? "allowed" : "rejected");
  return allowed;
}

function assertSchemaAst<Blob extends object>(input: CompileRecordSchemaCodecInput<RecordSchema, Blob>): void {
  const declarations = [...(input.attachmentDeclarations ?? []), ...(input.blobRef === undefined ? [] : [{ schema: input.blobRef.schema, isValue: input.blobRef.isBlobRef }])];
  if (declarations.some((declaration) => declaration.schema.ast._tag !== "Declaration")) throw new TypeError("Record Attachment opaque values must be Effect Schema Declarations");
  const state: AstAuditState = {
    declarations: new Set(declarations.map((declaration) => declaration.schema.ast)),
    getAttachmentDeclaration: input.getAttachmentDeclaration,
    states: new WeakMap(),
    failure: undefined,
  };
  if (!isAllowedAst(input.schema.ast, state)) {
    throw new TypeError(
      `Record schema may contain only canonical JSON nodes, Schema.encodeKeys transformations, and its minted Attachment BlobRef (rejected ${state.failure ?? "AST"})`,
    );
  }
}

function collectOpaqueDeclarationMetadata<
  SourceSchema extends RecordSchema,
  Blob extends object,
>(ast: SchemaAST.AST, input: CompileRecordSchemaCodecInput<SourceSchema, Blob>, output: unknown[], seen = new WeakSet<object>()): void {
  if (seen.has(ast)) return;
  seen.add(ast);
  const fixed = input.attachmentDeclarations?.find((entry) => entry.schema.ast === ast)?.metadata;
  const dynamic = input.getAttachmentDeclaration?.(ast);
  if (fixed !== undefined || dynamic !== undefined) { output.push(fixed ?? dynamic?.metadata); return; }
  switch (ast._tag) {
    case "Objects": for (const property of ast.propertySignatures) collectOpaqueDeclarationMetadata(property.type, input, output, seen); for (const index of ast.indexSignatures) collectOpaqueDeclarationMetadata(index.type, input, output, seen); break;
    case "Arrays": for (const element of ast.elements) collectOpaqueDeclarationMetadata(element, input, output, seen); for (const rest of ast.rest) collectOpaqueDeclarationMetadata(rest, input, output, seen); break;
    case "Union": for (const member of ast.types) collectOpaqueDeclarationMetadata(member, input, output, seen); break;
    case "Suspend": collectOpaqueDeclarationMetadata(ast.thunk(), input, output, seen); break;
  }
}

function deepFreeze<Value>(
  value: Value,
  isBlobRef: ((value: object) => boolean) | undefined,
  seen = new WeakSet<object>(),
): Value {
  if (typeof value !== "object" || value === null || isBlobRef?.(value) === true || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) deepFreeze(descriptor.value, isBlobRef, seen);
  }
  Object.freeze(value);
  return value;
}

/**
 * Compile one exact Effect Schema into the sole Record codec primitive. The
 * canonicalizer stays the final hostile-JS boundary after schema encoding and
 * before schema decoding.
 */
export function compileRecordSchemaCodec<
  SourceSchema extends RecordSchema,
  Blob extends object = never,
>(input: CompileRecordSchemaCodecInput<SourceSchema, Blob>): RecordSchemaCodec<SourceSchema["Type"], Blob, SourceSchema> {
  assertSchemaAst(input);
  const limits = assertLimits(input.limits);
  const declarations = [...(input.attachmentDeclarations ?? []), ...(input.blobRef === undefined ? [] : [{ schema: input.blobRef.schema, isValue: input.blobRef.isBlobRef }])];
  const isOpaque = (value: object): value is Blob => declarations.some((declaration) => declaration.isValue(value)) || input.isAttachmentOpaque?.(value) !== undefined;
  const options: RecordCanonicalizationOptions<Blob> = declarations.length === 0 ? {} : { isBlobRef: isOpaque };
  const decodeUnknown = Schema.decodeUnknownExit(input.schema, RecordSchemaParseOptions);
  const encodeUnknown = Schema.encodeUnknownExit(input.schema, RecordSchemaParseOptions);
  const validateType = Schema.decodeUnknownExit(Schema.toType(input.schema), RecordSchemaParseOptions);
  const opaqueDeclarationMetadata: unknown[] = [];
  collectOpaqueDeclarationMetadata(input.schema.ast, input, opaqueDeclarationMetadata);

  const canonicalize = (inputValue: unknown): Result.Result<RecordSchemaWire<Blob>, RecordSchemaFailure> => {
    const canonical = canonicalizeRecordValue<Blob>(inputValue, limits, options);
    return Result.isFailure(canonical)
      ? Result.fail(canonicalFailure(canonical.failure))
      : Result.succeed(canonical.success);
  };

  const mapOpaque = (
    value: unknown,
    map: (value: unknown, metadata: unknown) => RecordOpaqueMapResult,
    side: "type" | "encoded",
  ): unknown => {
    const declarationFor = (ast: SchemaAST.AST): { readonly metadata: unknown } | undefined => {
      const fixed = declarations.find((declaration) => declaration.schema.ast === ast);
      return fixed === undefined
        ? input.getAttachmentDeclaration?.(ast)
        : { metadata: "metadata" in fixed ? fixed.metadata : undefined };
    };
    const seen = new WeakMap<object, WeakMap<object, unknown>>();
    const walk = (ast: SchemaAST.AST, node: unknown): { readonly matched: boolean; readonly value: unknown } => {
      const declaration = declarationFor(ast);
      if (declaration !== undefined) {
        const mapped = map(node, declaration.metadata);
        return mapped._tag === "matched"
          ? { matched: true, value: mapped.value }
          : { matched: false, value: node };
      }
      if (typeof node !== "object" || node === null) return { matched: false, value: node };
      const cached = seen.get(node)?.get(ast);
      if (cached !== undefined) return { matched: false, value: cached };
      switch (ast._tag) {
        case "Suspend": return walk(ast.thunk(), node);
        case "Objects": {
          const output: Record<string, unknown> = { ...(node as Record<string, unknown>) };
          const cache = seen.get(node) ?? new WeakMap<object, unknown>();
          cache.set(ast, output);
          seen.set(node, cache);
          let matched = false;
          for (const property of ast.propertySignatures) {
            if (typeof property.name !== "string") continue;
            const descriptor = Object.getOwnPropertyDescriptor(node, property.name);
            if (descriptor !== undefined && "value" in descriptor) {
              const child = walk(property.type, descriptor.value);
              matched ||= child.matched;
              output[property.name] = child.value;
            }
          }
          return matched ? { matched: true, value: output } : { matched: false, value: node };
        }
        case "Arrays": {
          if (!Array.isArray(node)) return { matched: false, value: node };
          const output = [...node];
          const cache = seen.get(node) ?? new WeakMap<object, unknown>();
          cache.set(ast, output);
          seen.set(node, cache);
          let matched = false;
          for (let index = 0; index < ast.elements.length; index += 1) {
            const child = walk(ast.elements[index]!, node[index]);
            matched ||= child.matched;
            output[index] = child.value;
          }
          if (ast.rest.length > 0) {
            for (let index = ast.elements.length; index < node.length; index += 1) {
              const child = walk(ast.rest[0]!, node[index]);
              matched ||= child.matched;
              output[index] = child.value;
            }
          }
          return matched ? { matched: true, value: output } : { matched: false, value: node };
        }
        case "Union":
          for (const member of ast.types) {
            const projected = walk(member, node);
            if (projected.matched) return projected;
          }
          return { matched: false, value: node };
        default: return { matched: false, value: node };
      }
    };
    return walk(side === "type" ? input.schema.ast : SchemaAST.toEncoded(input.schema.ast), value).value;
  };

  return Object.freeze({
    schema: input.schema,
    limits,
    opaqueDeclarationMetadata: Object.freeze(opaqueDeclarationMetadata),
    decode: (inputValue: unknown): Result.Result<SourceSchema["Type"], RecordSchemaFailure> => {
      const canonical = canonicalize(inputValue);
      if (Result.isFailure(canonical)) return Result.fail(canonical.failure);
      const decoded = decodeUnknown(canonical.success);
      if (Exit.isFailure(decoded)) return Result.fail(schemaParseFailureFromExit(decoded));
      // The Type side is a second trust boundary: even a malformed custom AST
      // must not manufacture class instances, accessors, or a Core BlobRef.
      const typeChecked = validateType(decoded.value);
      if (Exit.isFailure(typeChecked)) return Result.fail(schemaParseFailureFromExit(typeChecked));
      const canonicalType = canonicalize(typeChecked.value);
      if (Result.isFailure(canonicalType)) return Result.fail(canonicalType.failure);
      const canonicalTypeChecked = validateType(canonicalType.success);
      return Exit.isFailure(canonicalTypeChecked)
        ? Result.fail(schemaParseFailureFromExit(canonicalTypeChecked))
        : Result.succeed(deepFreeze(canonicalTypeChecked.value, options.isBlobRef));
    },
    enumerateOpaque: (value: SourceSchema["Type"]) => {
      const entries: { readonly value: object; readonly metadata: unknown }[] = [];
      const seen = new WeakMap<object, WeakSet<object>>();
      const declarationFor = (ast: SchemaAST.AST): { readonly metadata: unknown; readonly accepts: (value: object) => boolean } | undefined => {
        const fixed = declarations.find((declaration) => declaration.schema.ast === ast);
        return fixed === undefined
          ? input.getAttachmentDeclaration?.(ast)
        : { metadata: "metadata" in fixed ? fixed.metadata : undefined, accepts: fixed.isValue };
      };
      const walk = (ast: SchemaAST.AST, node: unknown): void => {
        const declaration = declarationFor(ast);
        if (declaration !== undefined) {
          if (typeof node === "object" && node !== null && declaration.accepts(node)) entries.push(Object.freeze({ value: node, metadata: declaration.metadata }));
          return;
        }
        if (typeof node !== "object" || node === null) return;
        const seenAsts = seen.get(node) ?? new WeakSet<object>();
        if (seenAsts.has(ast)) return;
        seenAsts.add(ast); seen.set(node, seenAsts);
        switch (ast._tag) {
          case "Suspend": walk(ast.thunk(), node); return;
          case "Objects":
            for (const property of ast.propertySignatures) {
              if (typeof property.name !== "string") continue;
              const descriptor = Object.getOwnPropertyDescriptor(node, property.name);
              if (descriptor !== undefined && "value" in descriptor) walk(property.type, descriptor.value);
            }
            return;
          case "Arrays":
            if (!Array.isArray(node)) return;
            for (let index = 0; index < ast.elements.length; index += 1) walk(ast.elements[index]!, node[index]);
            if (ast.rest.length > 0) for (let index = ast.elements.length; index < node.length; index += 1) walk(ast.rest[0]!, node[index]);
            return;
          case "Union":
            // Declaration leaves carry their own runtime guard, preventing a
            // text/bytes union from double-counting or mislabelling a token.
            for (const member of ast.types) walk(member, node);
            return;
        }
      };
      walk(input.schema.ast, value);
      return Object.freeze(entries);
    },
    mapOpaque: (
      value: SourceSchema["Type"],
      map: (value: unknown, metadata: unknown) => RecordOpaqueMapResult,
    ) => mapOpaque(value, map, "type"),
    mapOpaqueEncoded: (
      wire: unknown,
      map: (value: unknown, metadata: unknown) => RecordOpaqueMapResult,
    ) => mapOpaque(wire, map, "encoded"),
    encode: (value: SourceSchema["Type"]): Result.Result<RecordSchemaWire<Blob>, RecordSchemaFailure> => {
      // Schema transformations may otherwise read accessors before the encoded
      // result reaches canonicalization. Clone the Type-side graph through the
      // same hostile-JS boundary first; opaque Attachment refs remain intact.
      const canonicalType = canonicalize(value);
      if (Result.isFailure(canonicalType)) return Result.fail(canonicalType.failure);
      const encoded = encodeUnknown(canonicalType.success);
      return Exit.isFailure(encoded)
        ? Result.fail(schemaParseFailureFromExit(encoded))
        : canonicalize(encoded.value);
    },
  });
}
