// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import * as Schema from "effect/Schema";
import { NonNegativeSafeIntegerSchema } from "../record/family/common.ts";
import {
  decodeBase64UrlUtf8,
  encodeBase64Bytes,
  encodeBase64UrlUtf8,
  InspectionSha256,
  utf8ByteLength,
} from "./bytes.ts";
import { closeInspectionJson, isInspectionCodecError, type InspectionJson } from "./codec.ts";
import { INSPECTION_RESULT_PAGE_BYTES } from "./limits.ts";
import type { InspectionFactSource } from "./source.ts";
import type { PersistedContentMetadata } from "../record/sqlite/types.ts";
import type { PagedAssertionDetailSchema } from "./assertion-result.ts";

const ContentPosition = Schema.Struct({
  digest: Schema.String,
  ordinal: NonNegativeSafeIntegerSchema,
  chunkOffset: NonNegativeSafeIntegerSchema,
});
const Position = Schema.Struct({
  path: Schema.String,
  row: NonNegativeSafeIntegerSchema,
  offset: NonNegativeSafeIntegerSchema,
  content: Schema.optional(ContentPosition),
});
type ContentPosition = typeof ContentPosition.Type;
const Cursor = Schema.Struct({
  source: Schema.String,
  cutoff: Schema.String,
  origin: Schema.String,
  request: Schema.String,
  version: Schema.Literal(2),
  position: Position,
});
type Position = typeof Position.Type;
type Binding = Omit<typeof Cursor.Type, "position" | "version">;

export interface AssertionPage {
  readonly position: Position | undefined;
  readonly next: (position: Position) => string;
  readonly invalid: () => never;
  readonly fullFits: (value: InspectionJson) => boolean;
}

export function assertionCursor(token: string | undefined, binding: Binding, invalid: () => never) {
  const position = token === undefined ? undefined : readPosition(token);
  function readPosition(token: string): Position {
    try {
      const decoded = Schema.decodeUnknownSync(Cursor, { onExcessProperty: "error" })(
        JSON.parse(decodeBase64UrlUtf8(token)),
      );
      if (
        decoded.source === binding.source &&
        decoded.cutoff === binding.cutoff &&
        decoded.origin === binding.origin &&
        decoded.request === binding.request
      )
        return decoded.position;
    } catch {
      return invalid();
    }
    return invalid();
  }
  return {
    position,
    invalid,
    next: (position: Position) => encodeBase64UrlUtf8(JSON.stringify({ ...binding, version: 2, position })),
  };
}

/** A derived array whose row body is projected only when that row is emitted. */
export class AssertionRows {
  readonly length: number;
  readonly at: (index: number) => InspectionJson;

  constructor(length: number, at: (index: number) => InspectionJson) {
    this.length = length;
    this.at = at;
  }
}

/** The full projection encodes this stored value as a base64 string. */
export class AssertionStoredContent {
  readonly source: InspectionFactSource;
  readonly metadata: PersistedContentMetadata;

  constructor(source: InspectionFactSource, metadata: PersistedContentMetadata) {
    this.source = source;
    this.metadata = metadata;
  }

  read(offset: number, maximum: number, position?: ContentPosition) {
    const { contentId, digest, byteLength, chunkCount } = this.metadata;
    const invalid = () => {
      throw new Error("Assertion Content range does not match the sealed Content");
    };
    if (offset > byteLength || (position?.digest ?? digest) !== digest) return invalid();
    let ordinal = position?.ordinal ?? 0;
    let chunkOffset = position?.chunkOffset ?? 0;
    if (offset === 0 && (ordinal !== 0 || chunkOffset !== 0)) return invalid();
    const output = new Uint8Array(Math.min(maximum, byteLength - offset));
    let written = 0;
    while (written < output.byteLength) {
      const after = ordinal - 1;
      const page = this.source.readContentPage(contentId, after, 1);
      const chunk = page.chunks[0];
      if (
        page.contentId !== contentId ||
        page.afterOrdinal !== after ||
        chunk === undefined ||
        page.chunks.length !== 1 ||
        chunk.ordinal !== ordinal ||
        ordinal >= chunkCount ||
        chunkOffset >= chunk.bytes.byteLength ||
        new InspectionSha256().update(chunk.bytes).digestHex() !== chunk.chunkDigest
      )
        return invalid();
      const size = Math.min(output.byteLength - written, chunk.bytes.byteLength - chunkOffset);
      output.set(chunk.bytes.subarray(chunkOffset, chunkOffset + size), written);
      written += size;
      chunkOffset += size;
      if (chunkOffset === chunk.bytes.byteLength) {
        ordinal++;
        chunkOffset = 0;
      }
    }
    if (offset + written === byteLength && (ordinal !== chunkCount || chunkOffset !== 0)) return invalid();
    return { bytes: output, position: { digest, ordinal, chunkOffset } };
  }
}

// Reserve space for document metadata, links and the next token.
const PAGE_HEADROOM = 8 * 1024;
const encoder = new TextEncoder();

type Section = { readonly path: string; readonly content: unknown };
type Part = (typeof PagedAssertionDetailSchema.Type)["fields"][number];

export interface AssertionPagePlan {
  readonly value: unknown;
  split?: { readonly path: string; readonly bytes: Uint8Array };
}

export function projectAssertionPage(
  entryId: string,
  plan: AssertionPagePlan,
  page: AssertionPage,
):
  | { readonly kind: "paged"; readonly value: typeof PagedAssertionDetailSchema.Type }
  | { readonly kind: "full"; readonly value: InspectionJson } {
  const { value } = plan;
  if (page.position === undefined) {
    let size = 0;
    for (const { path, content } of assertionSections("", value)) {
      size += path.length + 4;
      for (let row = 0; row < rowCount(content); row++) {
        size +=
          content instanceof AssertionStoredContent
            ? 2 + Math.ceil(content.metadata.byteLength / 3) * 4
            : utf8ByteLength(JSON.stringify(rowValue(content, row))) + 1;
        if (size > INSPECTION_RESULT_PAGE_BYTES) break;
      }
      if (size > INSPECTION_RESULT_PAGE_BYTES) break;
    }
    if (size <= INSPECTION_RESULT_PAGE_BYTES) {
      const full = closeJson(materializeRows(value));
      if (page.fullFits(full)) return { kind: "full", value: full };
    }
  }

  const fields: Part[] = [];
  let budget = INSPECTION_RESULT_PAGE_BYTES - PAGE_HEADROOM;
  const beginning = page.position;
  let found = beginning === undefined;
  const more = (position: Position) => ({
    kind: "paged" as const,
    value: { state: "paged" as const, entryId, fields, continuation: page.next(position) },
  });
  for (const { path: sectionPath, content } of assertionSections("", value, beginning?.path)) {
    const selected = sectionPath === beginning?.path;
    if (!found && !selected) return page.invalid();
    found = true;
    const firstRow = selected ? beginning.row : 0;
    if (firstRow >= rowCount(content)) return page.invalid();
    for (let row = firstRow; row < rowCount(content); row++) {
      const path = content instanceof AssertionRows ? sectionPath + "/" + row : sectionPath;
      const current = selected && row === beginning.row;
      const offset = current ? beginning.offset : 0;
      const storedPosition = current ? beginning.content : undefined;
      const overhead = utf8ByteLength(JSON.stringify(path)) + 232;
      const maximum = Math.floor((budget - overhead) / 4) * 3;
      if (maximum <= 0) return more({ path: sectionPath, row, offset });
      const stored = content instanceof AssertionStoredContent;
      if (
        (storedPosition !== undefined && (!stored || storedPosition.digest !== content.metadata.digest)) ||
        (stored && offset > 0 && storedPosition === undefined)
      )
        return page.invalid();
      const value = stored
        ? undefined
        : plan.split?.path === path
          ? plan.split.bytes
          : encoder.encode(JSON.stringify(rowValue(content, row)));
      const byteLength = stored ? content.metadata.byteLength : value!.byteLength;
      if (offset > byteLength || (offset > 0 && offset === byteLength)) return page.invalid();
      const span = stored ? content.read(offset, maximum, storedPosition) : undefined;
      const bytes = span?.bytes ?? value!.subarray(offset, offset + maximum);
      const end = offset + bytes.byteLength;
      const common = {
        path,
        byteLength,
        offset,
        nextOffset: end === byteLength ? null : end,
        base64: encodeBase64Bytes(bytes),
      };
      fields.push(
        stored
          ? { ...common, encoding: "content-base64", sha256: content.metadata.digest }
          : { ...common, encoding: "json" },
      );
      budget -= overhead + common.base64.length;
      if (end < byteLength) {
        if (value !== undefined) plan.split = { path, bytes: value };
        return more({ path: sectionPath, row, offset: end, ...(span ? { content: span.position } : {}) });
      }
      if (plan.split?.path === path) delete plan.split;
    }
  }
  if (fields.length === 0) return page.invalid();
  return { kind: "paged", value: { state: "paged", entryId, fields } };
}

function rowCount(content: unknown): number {
  return content instanceof AssertionRows ? content.length : 1;
}

function rowValue(content: unknown, row: number): InspectionJson {
  return content instanceof AssertionRows ? content.at(row) : closeJson(content);
}

function* assertionSections(path: string, value: unknown, start?: string): Generator<Section> {
  if (
    !(value instanceof AssertionStoredContent) &&
    ([
      "",
      "/entry",
      "/matcher",
      "/matcher/debugger",
      "/matcher/debugger/source",
      "/matcher/debugger/source/final",
      "/matcher/debugger/source/atEvaluation",
    ].includes(path) ||
      path === "/entry/materials" ||
      path.startsWith("/entry/materials/")) &&
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length > 0
  ) {
    for (const key of Object.keys(value).sort()) {
      const child = path + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1");
      if (start !== undefined && child < start && !start.startsWith(child + "/")) continue;
      yield* assertionSections(child, Reflect.get(value, key), start);
    }
  } else {
    yield { path, content: value };
  }
}

function materializeRows(value: unknown): unknown {
  if (value instanceof AssertionRows) return Array.from({ length: value.length }, (_, index) => value.at(index));
  if (value instanceof AssertionStoredContent) return encodeBase64Bytes(value.read(0, value.metadata.byteLength).bytes);
  if (Array.isArray(value)) return value.map(materializeRows);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materializeRows(child)]));
}

function closeJson(value: unknown): InspectionJson {
  const closed = closeInspectionJson(value);
  if (isInspectionCodecError(closed)) throw closed;
  return closed;
}
