import { Result, Schema } from "effect";
import { parse, stringify } from "yaml";
import { MemoryContentInvalid } from "./errors.js";
import { MemoryV1Schema, type MemoryDocument } from "./schema.js";

function titleFromBody(id: string, body: string): string {
  return /^#\s+(.+)$/mu.exec(body)?.[1]?.trim() || id;
}

export function decodeMemoryDocument(path: string, id: string, source: string): MemoryDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) {
    return { legacy: true, id, title: titleFromBody(id, source), body: source };
  }
  if (!/^format\s*:/mu.test(match[1])) {
    return { legacy: true, id, title: titleFromBody(id, source), body: source };
  }
  let input: unknown;
  try {
    input = parse(match[1]) as unknown;
  } catch (cause) {
    throw new MemoryContentInvalid({
      operation: "decode",
      path,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (typeof input !== "object" || input === null || !("format" in input)) {
    return { legacy: true, id, title: titleFromBody(id, source), body: source };
  }
  if (input.format !== "niceeval.memory/v1") {
    throw new MemoryContentInvalid({
      operation: "decode",
      path,
      message: `unsupported Memory format ${JSON.stringify(input.format)}`,
    });
  }
  const decoded = Schema.decodeUnknownResult(MemoryV1Schema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  if (Result.isFailure(decoded)) {
    throw new MemoryContentInvalid({
      operation: "decode",
      path,
      message: String(decoded.failure),
    });
  }
  return { metadata: decoded.success, body: match[2] };
}

export function encodeMemoryDocument(metadata: typeof MemoryV1Schema.Type, body: string): string {
  return `---\n${stringify(metadata, { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}
