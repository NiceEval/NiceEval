import { Either, ParseResult, Schema, SchemaAST, identity } from "effect";
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
  SourceSchema extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> {
  readonly schema: SourceSchema;
  readonly limits: RecordSchemaLimits;
  readonly decode: (input: unknown) => Either.Either<Value, RecordSchemaFailure>;
  readonly encode: (value: Value) => Either.Either<RecordSchemaWire<Blob>, RecordSchemaFailure>;
}

interface RecordSchemaBlobRef<Blob extends object> {
  /** The one package-minted Declaration that Attachment codecs may contain. */
  readonly schema: Schema.Schema<Blob, Blob, never>;
  readonly isBlobRef: (value: object) => value is Blob;
}

export interface CompileRecordSchemaCodecInput<
  SourceSchema extends Schema.Schema.AnyNoContext,
  Blob extends object = never,
> {
  readonly schema: SourceSchema;
  readonly limits: RecordSchemaLimits;
  /** Omitted for Core; Attachment supplies the one minted BlobRef declaration. */
  readonly blobRef?: RecordSchemaBlobRef<Blob>;
}

interface AstAuditState {
  readonly blobRefDeclaration: SchemaAST.AST | undefined;
  readonly states: WeakMap<object, "pending" | "allowed" | "rejected">;
  failure: string | undefined;
}

const schemaFailure: RecordSchemaFailure = Object.freeze({
  kind: "schema" as const,
  issues: Object.freeze([]),
});

function schemaParseFailure(error: ParseResult.ParseError): RecordSchemaFailure {
  try {
    const issues = ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) =>
      Object.freeze({
        path: Object.freeze([...issue.path]),
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

/**
 * Effect encodes `Schema.optional(T)` as an optional signature whose value is
 * `T | undefined`. The missing-property marker is valid only at that optional
 * boundary: canonicalization still rejects a literal `undefined` on the wire.
 */
function isAllowedOptionalValue(ast: SchemaAST.AST, state: AstAuditState): boolean {
  if (ast._tag === "UndefinedKeyword") return true;
  if (ast._tag !== "Union") return isAllowedAst(ast, state);

  let hasUndefinedBranch = false;
  for (const member of ast.types) {
    if (member._tag === "UndefinedKeyword") {
      hasUndefinedBranch = true;
      continue;
    }
    if (!isAllowedAst(member, state)) return false;
  }
  return hasUndefinedBranch || isAllowedAst(ast, state);
}

function isAllowedPropertySignature(
  signature: SchemaAST.PropertySignature,
  state: AstAuditState,
): boolean {
  return typeof signature.name === "string" &&
    signature.name.length > 0 &&
    (signature.isOptional
      ? isAllowedOptionalValue(signature.type, state)
      : isAllowedAst(signature.type, state));
}

function isAllowedIndexSignature(
  signature: SchemaAST.IndexSignature,
  state: AstAuditState,
): boolean {
  let parameter: SchemaAST.AST = signature.parameter;
  while (parameter._tag === "Refinement") parameter = parameter.from;
  return parameter._tag === "StringKeyword" &&
    isAllowedAst(signature.parameter, state) &&
    isAllowedAst(signature.type, state);
}

function isAllowedTypeLiteral(ast: SchemaAST.TypeLiteral, state: AstAuditState): boolean {
  return ast.propertySignatures.every((signature) => isAllowedPropertySignature(signature, state)) &&
    ast.indexSignatures.every((signature) => isAllowedIndexSignature(signature, state));
}

function isAllowedIdentityTransformation(
  ast: SchemaAST.Transformation,
  state: AstAuditState,
): boolean {
  if (
    ast.transformation._tag !== "TypeLiteralTransformation" ||
    ast.from._tag !== "TypeLiteral" ||
    ast.to._tag !== "TypeLiteral"
  ) {
    return false;
  }
  const fromKeys = new Set(ast.from.propertySignatures.map((signature) => signature.name));
  const toKeys = new Set(ast.to.propertySignatures.map((signature) => signature.name));
  const renames = new Map<PropertyKey, PropertyKey>();
  const isIdentity = ast.transformation.propertySignatureTransformations.every((transformation) =>
    typeof transformation.from === "string" &&
    transformation.from.length > 0 &&
    typeof transformation.to === "string" &&
    transformation.to.length > 0 &&
    fromKeys.has(transformation.from) &&
    toKeys.has(transformation.to) &&
    transformation.decode === identity &&
    transformation.encode === identity &&
    (renames.set(transformation.from, transformation.to), true)
  );
  if (!isIdentity || renames.size === 0) return false;

  const toByName = new Map(ast.to.propertySignatures.map((signature) => [signature.name, signature]));
  if (toByName.size !== ast.to.propertySignatures.length) return false;
  for (const from of ast.from.propertySignatures) {
    const to = toByName.get(renames.get(from.name) ?? from.name);
    if (
      to === undefined ||
      from.isOptional !== to.isOptional ||
      from.isReadonly !== to.isReadonly ||
      !matchesTypeSide(from.type, to.type, new WeakSet())
    ) {
      return false;
    }
  }
  if (ast.from.indexSignatures.length !== ast.to.indexSignatures.length) return false;
  for (let index = 0; index < ast.from.indexSignatures.length; index += 1) {
    const from = ast.from.indexSignatures[index]!;
    const to = ast.to.indexSignatures[index]!;
    if (
      from.parameter !== to.parameter ||
      from.isReadonly !== to.isReadonly ||
      !matchesTypeSide(from.type, to.type, new WeakSet())
    ) {
      return false;
    }
  }
  // `matchesTypeSide` audits the complete target against the encoded source.
  // Auditing the target again as an independent graph would not terminate for
  // Effect's freshly materialized recursive `typeAST(Suspend)` nodes.
  return isAllowedAst(ast.from, state);
}

/** Proves that `to` is exactly Effect's `SchemaAST.typeAST(from)` shape. */
function matchesTypeSide(
  from: SchemaAST.AST,
  to: SchemaAST.AST,
  seen: WeakSet<object>,
): boolean {
  if (from._tag === "Transformation") {
    if (seen.has(from)) return true;
    seen.add(from);
    return matchesTypeSide(from.to, to, seen);
  }
  if (from === to) return true;
  if (from._tag !== to._tag) return false;
  if (seen.has(from)) return true;
  seen.add(from);

  switch (from._tag) {
    case "Literal":
      return to._tag === "Literal" && from.literal === to.literal;
    case "StringKeyword":
    case "NumberKeyword":
    case "BooleanKeyword":
    case "UndefinedKeyword":
      return true;
    case "Refinement":
      return to._tag === "Refinement" &&
        from.filter === to.filter &&
        matchesTypeSide(from.from, to.from, seen);
    case "Suspend":
      return to._tag === "Suspend" && matchesTypeSide(from.f(), to.f(), seen);
    case "Union":
      return to._tag === "Union" &&
        from.types.length === to.types.length &&
        from.types.every((member, index) => matchesTypeSide(member, to.types[index]!, seen));
    case "TupleType":
      return to._tag === "TupleType" &&
        from.isReadonly === to.isReadonly &&
        from.elements.length === to.elements.length &&
        from.rest.length === to.rest.length &&
        from.elements.every((element, index) => {
          const target = to.elements[index]!;
          return element.isOptional === target.isOptional &&
            matchesTypeSide(element.type, target.type, seen);
        }) &&
        from.rest.every((element, index) => matchesTypeSide(element.type, to.rest[index]!.type, seen));
    case "TypeLiteral": {
      if (
        to._tag !== "TypeLiteral" ||
        from.propertySignatures.length !== to.propertySignatures.length ||
        from.indexSignatures.length !== to.indexSignatures.length
      ) {
        return false;
      }
      return from.propertySignatures.every((property, index) => {
        const target = to.propertySignatures[index]!;
        return property.name === target.name &&
          property.isOptional === target.isOptional &&
          property.isReadonly === target.isReadonly &&
          matchesTypeSide(property.type, target.type, seen);
      }) && from.indexSignatures.every((signature, index) => {
        const target = to.indexSignatures[index]!;
        return signature.parameter === target.parameter &&
          signature.isReadonly === target.isReadonly &&
          matchesTypeSide(signature.type, target.type, seen);
      });
    }
    case "Declaration":
      return to._tag === "Declaration" &&
        from.decodeUnknown === to.decodeUnknown &&
        from.encodeUnknown === to.encodeUnknown &&
        from.typeParameters.length === to.typeParameters.length &&
        from.typeParameters.every((parameter, index) =>
          matchesTypeSide(parameter, to.typeParameters[index]!, seen)
        );
    default:
      return false;
  }
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
      case "StringKeyword":
      case "NumberKeyword":
      case "BooleanKeyword":
        allowed = true;
        break;
      case "TypeLiteral":
        allowed = isAllowedTypeLiteral(ast, state);
        break;
      case "TupleType":
        allowed = ast.elements.every((element) =>
          element.isOptional
            ? isAllowedOptionalValue(element.type, state)
            : isAllowedAst(element.type, state)
        ) &&
          ast.rest.every((element) => isAllowedAst(element.type, state));
        break;
      case "Union":
        allowed = ast.types.every((member) => isAllowedAst(member, state));
        break;
      case "Refinement":
        allowed = isAllowedAst(ast.from, state);
        break;
      case "Suspend":
        allowed = isAllowedAst(ast.f(), state);
        break;
      case "Transformation":
        allowed = isAllowedIdentityTransformation(ast, state);
        break;
      case "Declaration":
        allowed = state.blobRefDeclaration !== undefined && ast === state.blobRefDeclaration;
        break;
      default:
        allowed = false;
        break;
    }
  } catch {
    allowed = false;
  }
  if (!allowed && state.failure === undefined) state.failure = ast._tag;
  state.states.set(ast, allowed ? "allowed" : "rejected");
  return allowed;
}

function assertSchemaAst<Blob extends object>(input: CompileRecordSchemaCodecInput<Schema.Schema.AnyNoContext, Blob>): void {
  const blobRefDeclaration = input.blobRef?.schema.ast;
  if (blobRefDeclaration !== undefined && blobRefDeclaration._tag !== "Declaration") {
    throw new TypeError("Record Attachment BlobRef must be an Effect Schema Declaration");
  }
  const state: AstAuditState = {
    blobRefDeclaration,
    states: new WeakMap(),
    failure: undefined,
  };
  if (!isAllowedAst(input.schema.ast, state)) {
    throw new TypeError(
      `Record schema may contain only canonical JSON nodes, identity Schema.fromKey transformations, and its minted Attachment BlobRef (rejected ${state.failure ?? "AST"})`,
    );
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
  SourceSchema extends Schema.Schema.AnyNoContext,
  Blob extends object = never,
>(input: CompileRecordSchemaCodecInput<SourceSchema, Blob>): RecordSchemaCodec<Schema.Schema.Type<SourceSchema>, Blob, SourceSchema> {
  assertSchemaAst(input);
  const limits = assertLimits(input.limits);
  const options: RecordCanonicalizationOptions<Blob> = input.blobRef === undefined
    ? {}
    : { isBlobRef: input.blobRef.isBlobRef };
  const decodeUnknown = Schema.decodeUnknownEither(input.schema, RecordSchemaParseOptions);
  const encodeUnknown = Schema.encodeUnknownEither(input.schema, RecordSchemaParseOptions);

  const canonicalize = (inputValue: unknown): Either.Either<RecordSchemaWire<Blob>, RecordSchemaFailure> => {
    const canonical = canonicalizeRecordValue<Blob>(inputValue, limits, options);
    return Either.isLeft(canonical)
      ? Either.left(canonicalFailure(canonical.left))
      : Either.right(canonical.right);
  };

  return Object.freeze({
    schema: input.schema,
    limits,
    decode: (inputValue: unknown): Either.Either<Schema.Schema.Type<SourceSchema>, RecordSchemaFailure> => {
      const canonical = canonicalize(inputValue);
      if (Either.isLeft(canonical)) return Either.left(canonical.left);
      const decoded = decodeUnknown(canonical.right);
      if (Either.isLeft(decoded)) return Either.left(schemaParseFailure(decoded.left));
      // The Type side is a second trust boundary: even a malformed custom AST
      // must not manufacture class instances, accessors, or a Core BlobRef.
      const canonicalType = canonicalize(decoded.right);
      return Either.isLeft(canonicalType)
        ? Either.left(canonicalType.left)
        : Either.right(deepFreeze(
          canonicalType.right as Schema.Schema.Type<SourceSchema>,
          options.isBlobRef,
        ));
    },
    encode: (value: Schema.Schema.Type<SourceSchema>): Either.Either<RecordSchemaWire<Blob>, RecordSchemaFailure> => {
      // Schema transformations may otherwise read accessors before the encoded
      // result reaches canonicalization. Clone the Type-side graph through the
      // same hostile-JS boundary first; opaque Attachment refs remain intact.
      const canonicalType = canonicalize(value);
      if (Either.isLeft(canonicalType)) return Either.left(canonicalType.left);
      const encoded = encodeUnknown(canonicalType.right);
      return Either.isLeft(encoded)
        ? Either.left(schemaParseFailure(encoded.left))
        : canonicalize(encoded.right);
    },
  });
}
