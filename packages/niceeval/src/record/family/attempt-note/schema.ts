import * as Schema from "effect/Schema";
import { NonNegativeSafeIntegerSchema } from "../common.ts";

export type NoteValue = string | number | boolean | null | readonly NoteValue[] | { readonly [key: string]: NoteValue };

export const AttemptNoteLimits = Object.freeze({ maximumEntries: 64, maximumJsonBytes: 64 * 1024 });

const NoteJsonSchema: Schema.Codec<NoteValue> = Schema.suspend(() => Schema.Union([
  Schema.Null, Schema.Boolean, Schema.Finite, Schema.String, Schema.Array(NoteJsonSchema), Schema.Record(Schema.String, NoteJsonSchema),
]));
export const AttemptNoteSchema = Schema.Struct({
  label: Schema.String,
  sequence: NonNegativeSafeIntegerSchema,
  value: NoteJsonSchema,
  unit: Schema.optional(Schema.Literals(["ms", "seconds", "tokens", "usd", "ratio", "count", "bytes"])),
});
export type AttemptNote = Schema.Schema.Type<typeof AttemptNoteSchema>;
export const AttemptNotesSchema = Schema.Array(AttemptNoteSchema).check(Schema.makeFilter((notes) =>
  notes.length <= AttemptNoteLimits.maximumEntries && new Set(notes.map((note) => note.label)).size === notes.length &&
  notes.every((note, index) => note.sequence === index &&
    (note.unit === undefined || typeof note.value === "number") &&
    new TextEncoder().encode(JSON.stringify(note)).byteLength <= AttemptNoteLimits.maximumJsonBytes),
));
