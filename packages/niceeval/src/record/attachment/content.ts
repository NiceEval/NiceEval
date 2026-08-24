import { Schema } from "effect";

/**
 * Package-owned logical content declarations. Both are opaque handles: the
 * text/bytes distinction belongs to capture input, never to durable storage.
 */
const textHandleTypeId: unique symbol = Symbol("@niceeval/record/RecordTextContentHandle");
const bytesHandleTypeId: unique symbol = Symbol("@niceeval/record/RecordBytesContentHandle");
const handles = new WeakMap<object, { readonly kind: "text" | "bytes" }>();

/** Logical handles are deliberately distinct from capture sources and from legacy BlobRefs. */
export interface RecordTextContentHandle { readonly [textHandleTypeId]: typeof textHandleTypeId; }
export interface RecordBytesContentHandle { readonly [bytesHandleTypeId]: typeof bytesHandleTypeId; }
export type RecordContentHandle = RecordTextContentHandle | RecordBytesContentHandle;

export interface RecordContentDeclarationMetadata {
  readonly kind: "text" | "bytes";
  readonly maximumBytes: number | undefined;
}
const contentDeclarations = new WeakMap<object, RecordContentDeclarationMetadata>();

function contentDeclaration<Handle extends RecordContentHandle>(kind: "text" | "bytes", maximumBytes: number | undefined): Schema.Schema<Handle, Handle, never> {
  const schema = Schema.declare<Handle>(
    (value): value is Handle => isRecordContentHandle(value) && handles.get(value)?.kind === kind,
    { identifier: kind === "text" ? "RecordTextContent" : "RecordBytesContent" },
  );
  contentDeclarations.set(schema, Object.freeze({ kind, maximumBytes }));
  contentDeclarations.set(schema.ast, Object.freeze({ kind, maximumBytes }));
  return schema;
}

/** Distinct declaration identities, even though their persisted handle is opaque in both cases. */
export const RecordTextContentSchema = contentDeclaration<RecordTextContentHandle>("text", undefined);
export const RecordBytesContentSchema = contentDeclaration<RecordBytesContentHandle>("bytes", undefined);

/** Attach an explicit package-owned capture bound; the compiler never guesses this from arbitrary AST. */
export const recordContent = Object.freeze({
  /** Zero permits only empty content; negative and unsafe bounds are invalid. */
  maximumBytes(maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new TypeError("Record content maximumBytes must be a non-negative safe integer");
    return <Content extends Schema.Schema.AnyNoContext>(schema: Content): Content => {
      const metadata = contentDeclarations.get(schema);
      if (metadata === undefined) throw new TypeError("Record content maximumBytes requires a package-owned content declaration");
      return contentDeclaration(metadata.kind, maximumBytes) as Content;
    };
  },
});

/** @internal Compiler/Session metadata; source and logical handle remain separate capabilities. */
export function recordContentDeclarationMetadata(schema: object): (RecordContentDeclarationMetadata & { readonly category: "content" }) | undefined {
  const metadata = contentDeclarations.get(schema);
  return metadata === undefined ? undefined : Object.freeze({ ...metadata, category: "content" });
}

export function isRecordContentHandle(value: unknown): value is RecordContentHandle { return typeof value === "object" && value !== null && handles.has(value); }
export function isRecordTextContentHandle(value: unknown): value is RecordTextContentHandle { return isRecordContentHandle(value) && handles.get(value)?.kind === "text"; }
export function isRecordBytesContentHandle(value: unknown): value is RecordBytesContentHandle { return isRecordContentHandle(value) && handles.get(value)?.kind === "bytes"; }
/** @internal Session mints a typed logical field; captured bytes stay in its private invocation map. */
export function mintRecordContentHandle<Kind extends "text" | "bytes">(kind: Kind): Kind extends "text" ? RecordTextContentHandle : RecordBytesContentHandle {
  const handle = Object.freeze(kind === "text"
    ? { [textHandleTypeId]: textHandleTypeId }
    : { [bytesHandleTypeId]: bytesHandleTypeId }) as Kind extends "text" ? RecordTextContentHandle : RecordBytesContentHandle;
  handles.set(handle, Object.freeze({ kind }));
  return handle;
}
