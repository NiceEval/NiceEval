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

export function requiredTranscript(fromDir: string, name: string): string {
  return readFileSync(join(fromDir, "fixtures", "transcripts", name), "utf8");
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
  template = template.replace(
    new RegExp(` *${DURATION_TOKEN.source} *`, "g"),
    "{{duration}}",
  );
  return template;
}

/**
 * Compare a checked-in transcript to actual output.
 * Only named seams may differ. The rest is character-identical.
 * No whole-line or whole-table replacement.
 */
export function expectTranscript(actual: string, template: string, bindings: SeamBindings): void {
  const seams = listSeams(template);
  const templateCounts = countSeams(template);
  let cursor = 0;
  let remaining = actual;
  const seen = { locator: 0, runId: 0, timestamp: 0, duration: 0 };

  for (const seam of seams) {
    const literal = template.slice(cursor, template.indexOf(seam.raw, cursor));
    expect(remaining.startsWith(literal), `verbatim mismatch before ${seam.raw}`).toBe(true);
    remaining = remaining.slice(literal.length);
    cursor += literal.length + seam.raw.length;

    const consumed = consumeSeam(seam.kind, seam.key, remaining, bindings);
    expect(consumed, `missing ${seam.raw} at remaining=${JSON.stringify(remaining.slice(0, 80))}`).not.toBeNull();
    remaining = remaining.slice(consumed!.length);
    seen[seam.kind] += 1;
  }

  const tail = template.slice(cursor);
  expect(remaining, "verbatim tail mismatch").toBe(tail);
  expect(seen, "template seam counts must match consumed seams").toEqual(templateCounts);

  const audit = auditSeams(template, bindings, actual);
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
  const match = remaining.match(new RegExp(`^ *${DURATION_TOKEN.source} *`));
  return match?.[0] ?? null;
}
