import { isQuantity, type Quantity } from "../assertions/quantity.ts";
import { isJsonValue } from "../shared/json-value.ts";
import type { JsonValue } from "../shared/types.ts";
import { AttemptNoteSchema, type AttemptNote } from "../record/family/attempt-note/schema.ts";
import * as Schema from "effect/Schema";

const decodeNote = Schema.decodeUnknownSync(Schema.fromJsonString(AttemptNoteSchema));

/** Attempt-owned display data; this collector never registers an Assertion. */
export class AttemptNotesCollector {
  private readonly entries: AttemptNote[] = [];
  private readonly labels = new Set<string>();

  add(label: string, value: JsonValue | Quantity): void {
    if (typeof label !== "string") throw new TypeError("note() label must be a string.");
    if (this.labels.has(label))
      throw new TypeError(`note() label ${JSON.stringify(label)} is already recorded in this Attempt.`);
    const entry = isQuantity(value)
      ? { label, sequence: this.entries.length, value: value.value, unit: value.unit }
      : { label, sequence: this.entries.length, value };
    if (!isJsonValue(entry)) throw new TypeError("note() value must be JSON or a Quantity.");
    let serialized: string;
    try {
      serialized = JSON.stringify(entry);
    } catch {
      throw new TypeError("note() value must be serializable JSON.");
    }
    const snapshot = decodeNote(serialized);
    this.entries.push(snapshot);
    this.labels.add(label);
  }

  snapshot(): readonly AttemptNote[] {
    return [...this.entries];
  }
}
