import { Schema } from "effect";
import { AttemptNotesSchema, type AttemptNote } from "../record/family/attempt-note/schema.ts";
import { NiceEvalRecordAttachments } from "../record/family/current.ts";
import { attemptAttachment, type ResolvedInspectionAttempt } from "./facts.ts";

export function readAttemptNotes(resolved: ResolvedInspectionAttempt): readonly AttemptNote[] {
  const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.attemptNotes.family);
  return attachment === undefined ? [] : Schema.decodeUnknownSync(AttemptNotesSchema)(attachment.value);
}
export function aggregateAttemptNotes(attempts: readonly ResolvedInspectionAttempt[]) {
  const groups = new Map<string, { label: string; unit?: AttemptNote["unit"]; values: number[] }>();
  for (const attempt of attempts)
    for (const note of readAttemptNotes(attempt)) {
      if (typeof note.value !== "number") continue;
      const key = JSON.stringify([note.label, note.unit ?? null]);
      let group = groups.get(key);
      if (group === undefined) {
        group = { label: note.label, ...(note.unit === undefined ? {} : { unit: note.unit }), values: [] };
        groups.set(key, group);
      }
      group.values.push(note.value);
    }
  return [...groups.values()].map(({ label, unit, values }) => {
    values.sort((a, b) => a - b);
    const quantile = (p: number): number => {
      const position = (values.length - 1) * p;
      const lower = values[Math.floor(position)]!;
      const upper = values[Math.ceil(position)]!;
      const fraction = position - Math.floor(position);
      return lower * (1 - fraction) + upper * fraction;
    };
    return Object.freeze({
      label,
      ...(unit === undefined ? {} : { unit }),
      count: values.length,
      min: values[0]!,
      median: quantile(0.5),
      p90: quantile(0.9),
      max: values[values.length - 1]!,
    });
  });
}
