import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import {
  DURATION_TOKEN,
  LOCATOR_TOKEN,
  TIMESTAMP_TOKEN,
  type SeamBindings,
  type SeamKind,
  auditSeams,
  countSeams,
  listSeams,
} from "./seams.ts";

const TRANSCRIPT_DIRECTIVE = /\{\{(pad|eof-newlines):(\d+)\}\}/g;
const REMAINING_TRANSCRIPT_DIRECTIVE = /\{\{(?:pad|eof-newlines):[^}]*\}\}/;

export function requiredTranscript(fromDir: string, name: string): string {
  return readFileSync(join(fromDir, "fixtures", "transcripts", name), "utf8");
}

/**
 * Makes otherwise-invisible fixture bytes reviewable without weakening a
 * transcript comparison. `{{pad:N}}` means exactly N spaces. The single
 * `{{eof-newlines:N}}` directive may occur only at EOF and means exactly N
 * final LF bytes.
 */
export function expandTranscriptDirectives(template: string): string {
  // Text fixtures conventionally end in LF. When EOF itself is encoded by the
  // directive, that source-file terminator is transport syntax, not expected
  // transcript content.
  const source = /\{\{eof-newlines:\d+\}\}\n$/.test(template) ? template.slice(0, -1) : template;
  let eofDirectiveCount = 0;
  const expanded = source.replace(TRANSCRIPT_DIRECTIVE, (raw, kind: string, countText: string, offset: number) => {
    const count = Number.parseInt(countText, 10);
    if (!Number.isSafeInteger(count)) throw new Error(`invalid transcript directive ${raw}`);
    if (kind === "pad") return " ".repeat(count);
    eofDirectiveCount += 1;
    if (eofDirectiveCount !== 1 || offset + raw.length !== source.length) {
      throw new Error("{{eof-newlines:N}} must occur exactly once at the end of a transcript fixture");
    }
    return "\n".repeat(count);
  });
  if (REMAINING_TRANSCRIPT_DIRECTIVE.test(expanded)) {
    throw new Error("transcript directive requires a non-negative decimal count");
  }
  return expanded;
}

/** Turn a live stdout into a checked-in template. Only named seams are rewritten. */
export function toTranscriptTemplate(stdout: string, bindings: SeamBindings): string {
  let template = stdout;
  const locators = Object.entries(bindings.locators ?? {}).sort((a, b) => b[1].length - a[1].length);
  for (const [key, locator] of locators) {
    template = template.split(locator).join(`{{locator:${key}}}`);
  }
  for (const runId of [...(bindings.runIds ?? [])].sort((a, b) => b.length - a.length)) {
    template = template.split(runId).join("{{runId}}");
  }
  template = template.replace(new RegExp(TIMESTAMP_TOKEN, "g"), "{{timestamp}}");
  template = template.replace(new RegExp(DURATION_TOKEN, "g"), "{{duration}}");
  return template;
}

/**
 * Compare a checked-in transcript to actual output.
 * Only named seams may differ. The rest is character-identical.
 * No whole-line or whole-table replacement.
 */
export function expectTranscript(actual: string, template: string, bindings: SeamBindings): void {
  const expanded = expandTranscriptDirectives(template);
  const seams = listSeams(expanded);
  const templateCounts = countSeams(expanded);
  let templateCursor = 0;
  let actualCursor = 0;
  const seen = { locator: 0, runId: 0, timestamp: 0, duration: 0 };

  for (const seam of seams) {
    const literalEnd = expanded.indexOf(seam.raw, templateCursor);
    const literal = expanded.slice(templateCursor, literalEnd);
    expectExactAt(actual, actualCursor, literal, `before ${seam.raw}`);
    actualCursor += literal.length;
    templateCursor = literalEnd + seam.raw.length;

    const consumed = consumeSeam(seam.kind, seam.key, actual.slice(actualCursor), bindings);
    if (consumed === null) {
      throw new Error(
        `missing ${seam.raw} at ${describeOffset(actual, actualCursor)}; received ${printCharacter(actual, actualCursor)}`,
      );
    }
    actualCursor += consumed.length;
    seen[seam.kind] += 1;
  }

  const tail = expanded.slice(templateCursor);
  expectExactAt(actual, actualCursor, tail, "in verbatim tail");
  actualCursor += tail.length;
  if (actualCursor !== actual.length) {
    throw new Error(
      `transcript has extra output at ${describeOffset(actual, actualCursor)}; received ${printCharacter(actual, actualCursor)}, expected <eof>`,
    );
  }
  expect(seen, "template seam counts must match consumed seams").toEqual(templateCounts);

  const audit = auditSeams(expanded, bindings, actual);
  expect(audit.actual.locator, "locator seam audit: every actual locator must be a named template seam").toBe(
    audit.template.locator,
  );
  expect(audit.actual.timestamp, "timestamp seam audit: every actual timestamp must be a named template seam").toBe(
    audit.template.timestamp,
  );
  expect(audit.actual.duration, "duration seam audit: every actual duration token must be a named template seam").toBe(
    audit.template.duration,
  );
  expect(audit.actual.runId, "runId seam audit: every actual run id must be a named template seam").toBe(
    audit.template.runId,
  );
}

function expectExactAt(actual: string, actualOffset: number, expected: string, context: string): void {
  const limit = Math.min(expected.length, actual.length - actualOffset);
  for (let index = 0; index < limit; index += 1) {
    if (actual[actualOffset + index] !== expected[index]) {
      throw new Error(
        `transcript mismatch ${context} at ${describeOffset(actual, actualOffset + index)}; expected ${printCharacter(expected, index)}, received ${printCharacter(actual, actualOffset + index)}`,
      );
    }
  }
  if (limit !== expected.length) {
    throw new Error(
      `transcript ended ${context} at ${describeOffset(actual, actualOffset + limit)}; expected ${printCharacter(expected, limit)}, received <eof>`,
    );
  }
}

function describeOffset(text: string, offset: number): string {
  const prefix = text.slice(0, offset);
  const line = prefix.split("\n").length;
  const column = Array.from(prefix.slice(prefix.lastIndexOf("\n") + 1)).length + 1;
  return `offset ${offset} (L${line}:C${column})`;
}

function printCharacter(text: string, offset: number): string {
  if (offset >= text.length) return "<eof>";
  return JSON.stringify(text[offset]);
}

function consumeSeam(
  kind: SeamKind,
  key: string | undefined,
  remaining: string,
  bindings: SeamBindings,
): string | null {
  if (kind === "locator") {
    if (key !== undefined) {
      const expected = bindings.locators?.[key];
      if (expected === undefined) return null;
      return remaining.startsWith(expected) ? expected : null;
    }
    const match = remaining.match(new RegExp(`^${LOCATOR_TOKEN.source}`));
    return match?.[0] ?? null;
  }
  if (kind === "runId") {
    if (key !== undefined) {
      const expected = bindings.runIds?.includes(key) ? key : bindings.locators?.[key];
      if (expected === undefined) return null;
      return remaining.startsWith(expected) ? expected : null;
    }
    const known = (bindings.runIds ?? []).find((runId) => remaining.startsWith(runId));
    return known ?? null;
  }
  if (kind === "timestamp") {
    const match = remaining.match(new RegExp(`^${TIMESTAMP_TOKEN.source}`));
    return match?.[0] ?? null;
  }
  const match = remaining.match(new RegExp(`^${DURATION_TOKEN.source}`));
  return match?.[0] ?? null;
}
