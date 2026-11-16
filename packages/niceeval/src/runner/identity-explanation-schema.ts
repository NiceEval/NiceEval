// Detached identity explanations are shared with the pure Inspection protocol.
import * as Schema from "effect/Schema";
import type { JsonValue } from "../types.ts";
import { IdentityJsonSchema } from "../record/family/identity-manifests/schema.ts";

export const IdentityDeltaSchema = Schema.Struct({
  selector: Schema.String,
  kind: Schema.Literals(["added", "removed", "changed", "unknown"]),
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
});
export type IdentityDelta = Schema.Schema.Type<typeof IdentityDeltaSchema>;
export type IdentityDiagnosticFact =
  | { readonly label: string; readonly value: JsonValue }
  | { readonly label: string; readonly from: JsonValue; readonly to: JsonValue };
export interface IdentityDiagnostic {
  readonly code: string;
  readonly summary: string;
  readonly facts?: readonly IdentityDiagnosticFact[];
  readonly observedDeltas?: readonly IdentityDelta[];
  readonly limitations?: readonly string[];
  readonly causes?: readonly IdentityDiagnostic[];
}
export const IdentityDiagnosticSchema: Schema.Codec<IdentityDiagnostic> = Schema.suspend(() =>
  Schema.Struct({
    code: Schema.String,
    summary: Schema.String,
    facts: Schema.optionalKey(
      Schema.Array(
        Schema.Union([
          Schema.Struct({ label: Schema.String, value: IdentityJsonSchema }),
          Schema.Struct({ label: Schema.String, from: IdentityJsonSchema, to: IdentityJsonSchema }),
        ]),
      ),
    ),
    observedDeltas: Schema.optionalKey(Schema.Array(IdentityDeltaSchema)),
    limitations: Schema.optionalKey(Schema.Array(Schema.String)),
    causes: Schema.optionalKey(Schema.Array(IdentityDiagnosticSchema)),
  }),
);
export const IdentityExplanationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("match"), via: Schema.NonEmptyArray(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("changed"), deltas: Schema.NonEmptyArray(IdentityDeltaSchema) }),
  Schema.Struct({ kind: Schema.Literal("unexplained"), diagnostic: IdentityDiagnosticSchema }),
]);
export type IdentityExplanation = Schema.Schema.Type<typeof IdentityExplanationSchema>;
