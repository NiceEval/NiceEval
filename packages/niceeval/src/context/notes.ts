import { isQuantity, type Quantity } from "../assertions/quantity.ts";
import { isJsonValue } from "../shared/json-value.ts";
import type { JsonValue } from "../shared/types.ts";
import { AttemptNoteLimits, type AttemptNote } from "../record/family/attempt-note/schema.ts";

/** Attempt-owned display data; this collector never registers an Assertion. */
export class AttemptNotesCollector {
  private readonly entries: AttemptNote[] = [];
  private readonly labels = new Set<string>();

  add(label: string, value: JsonValue | Quantity): void {
    if (typeof label !== "string") throw new TypeError("note() label must be a string.");
    if (this.labels.has(label))
      throw new TypeError(`note() label ${JSON.stringify(label)} is already recorded in this Attempt.`);
    if (this.entries.length >= AttemptNoteLimits.maximumEntries)
      throw new TypeError("note() accepts at most 64 entries per Attempt.");
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
    if (new TextEncoder().encode(serialized).byteLength > AttemptNoteLimits.maximumJsonBytes)
      throw new TypeError("note() entry exceeds 64 KiB of JSON.");
    const snapshot = JSON.parse(serialized) as AttemptNote;
    this.entries.push(deepFreeze(snapshot));
    this.labels.add(label);
  }

  snapshot(): readonly AttemptNote[] {
    return Object.freeze([...this.entries]);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
