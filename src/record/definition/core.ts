import type { RecordValueLimits } from "./canonical.ts";
import {
  defineRecordValue,
  type RecordPropertyMap,
  type RecordValueDefinition,
  type RecordValueIssue,
  type RecordValueOf,
} from "./value.ts";

export type RecordCoreDefinition<Properties extends RecordPropertyMap> =
  RecordValueDefinition<Properties, "json"> & { readonly kind: "core" };

/** Core can contain only plain JSON. Blob refs are exclusive to fixed Attachments. */
export function defineRecordCore<const Properties extends RecordPropertyMap>(input: {
  readonly properties: Properties;
  readonly limits: RecordValueLimits;
  readonly refine?: (value: RecordValueOf<Properties>) => readonly RecordValueIssue[];
}): RecordCoreDefinition<Properties> {
  const value = defineRecordValue({
    properties: input.properties,
    leaf: "json" as const,
    limits: input.limits,
    refine: input.refine,
  });
  return Object.freeze({ ...value, kind: "core" as const });
}
