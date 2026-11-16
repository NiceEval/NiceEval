// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";

/** Display an Inspection reason or state as ordinary English, preserving IDs elsewhere. */
export function factPhrase(value: string): string {
  return value.replaceAll("-", " ");
}

/** A bounded display of a structured value; the machine document owns the complete value. */
export function structuredSummary(value: Schema.Json, depth = 0): string {
  if (value === null) return "none";
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (depth > 0) return `${entries.length} fields`;
    const shown = entries.slice(0, 3).map(([key, item]) => `${key}: ${structuredSummary(item, depth + 1)}`);
    if (entries.length > 3) shown.push(`+${entries.length - 3} more fields`);
    return shown.length === 0 ? "empty object" : shown.join("; ");
  }
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Json));

/** Tool and Evidence previews can contain serialized or truncated JSON. */
export function recordedTextSummary(text: string): string {
  if (!/^\s*[\[{]/u.test(text)) return text;
  const decoded = decodeJson(text);
  return Result.isSuccess(decoded)
    ? structuredSummary(decoded.success)
    : `Structured value preview (${Buffer.byteLength(text, "utf8")} bytes; use --json for recorded text)`;
}

export function countedSummaries(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => (count === 1 ? value : `${value} ×${count}`));
}
