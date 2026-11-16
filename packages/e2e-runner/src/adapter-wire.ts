// Client-owned projection of concord.test-adapter/v1; no Concord runtime imports.
import { Schema } from "effect";
import { bridgeJson, parseBridgeJson } from "./bridge-json.ts";
export const ADAPTER_BYTES = 8 * 1024 * 1024;
export const Text = Schema.String.check(Schema.isMinLength(1));
const Nat = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Sha256 = Text.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
export const RelativePath = Text.check(
  Schema.makeFilter(
    (value) =>
      !value.includes("\\") &&
      !/[\0\r\n]/u.test(value) &&
      value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
  ),
);
export function decode<A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown): A {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);
}
export function parse(source: string | Uint8Array): unknown {
  if (Buffer.byteLength(source) > ADAPTER_BYTES) throw new Error("adapter JSON exceeds 8 MiB");
  return parseBridgeJson(source);
}
export function json(value: unknown): string {
  const source = bridgeJson(value);
  if (Buffer.byteLength(source) + 1 > ADAPTER_BYTES) throw new Error("adapter JSON exceeds 8 MiB");
  return source;
}
export const ContextSchema = Schema.Struct({
  root: Text,
  runId: Text,
  planId: Text,
  inputs: Sha256,
  reportDirectory: Text,
});
export const StatusSchema = Schema.Struct({
  invocationId: Text,
  exitCode: Schema.NullOr(Nat),
  signal: Schema.NullOr(Text),
  timedOut: Schema.Boolean,
  cancelled: Schema.Boolean,
  outputTruncated: Schema.Boolean,
  cleanup: Schema.Literals(["complete", "unknown"]),
});
export const CapabilitiesSchema = Schema.Struct({
  realCollection: Schema.Boolean,
  leaf: Schema.Boolean,
  parameterGroups: Schema.Boolean,
  exactSelection: Schema.Boolean,
  perItemReport: Schema.Boolean,
  range: Schema.Boolean,
  tags: Schema.Boolean,
  skipVisibility: Schema.Boolean,
  rangeTrivia: Schema.Boolean,
});
const CompletenessSchema = Schema.Struct({ complete: Schema.Boolean, gaps: Schema.Array(Text) }).check(
  Schema.makeFilter((value) => value.complete || value.gaps.length > 0),
);
export const RangeSchema = Schema.Struct({
  startLine: Schema.Int.check(Schema.isGreaterThan(0)),
  endLine: Schema.Int.check(Schema.isGreaterThan(0)),
  sourceDigest: Sha256,
}).check(Schema.makeFilter((value) => value.startLine <= value.endLine));
export const NativeCaseSchema = Schema.Struct({
  nativeId: Text.check(Schema.isPattern(/^[^:\s]+:.+$/u)),
  project: Text,
  file: RelativePath,
  kind: Schema.Literals(["leaf", "suite"]),
  group: Schema.optional(Text),
  range: Schema.optional(RangeSchema),
  selection: Schema.Struct({ opaqueId: Text, capabilityVersion: Text }),
  tags: Schema.Record(Text, Schema.String),
  provenance: Text,
});
export const ManifestSchema = Schema.Struct({
  cases: Schema.Array(NativeCaseSchema).check(Schema.isMaxLength(100_000)),
  capabilities: CapabilitiesSchema,
  completeness: CompletenessSchema,
});
export const ResultSchema = Schema.Struct({
  nativeId: Text,
  outcome: Schema.Literals(["passed", "failed", "skipped", "todo", "not-run"]),
  provenance: Text,
});
export const ReportSchema = Schema.Struct({
  observed: Schema.Array(ResultSchema).check(Schema.isMaxLength(100_000)),
  capabilities: CapabilitiesSchema,
  completeness: CompletenessSchema,
});
const InvocationSchema = Schema.Struct({
  invocationId: Text,
  argv: Schema.NonEmptyArray(Text),
  cwd: Text,
  envNames: Schema.Array(Text),
  reports: Schema.Array(Text),
  requested: Schema.optional(Schema.Array(Text)),
});
const OpaqueContext = Schema.Record(Text, Schema.Unknown);
export const PlanSchema = Schema.Struct({
  invocations: Schema.NonEmptyArray(InvocationSchema).check(Schema.isMaxLength(128)),
  planContext: OpaqueContext,
});
const CapturedSchema = Schema.Struct({
  status: StatusSchema,
  stdout: Schema.String,
  stderr: Schema.String,
  reports: Schema.Array(Schema.Struct({ path: Text, digest: Sha256, text: Schema.String })),
});
export const PayloadSchemas = {
  "collect-plan": Schema.Struct({
    files: Schema.NonEmptyArray(RelativePath),
    members: Schema.Array(Schema.Struct({ path: Text, digest: Sha256 })),
  }),
  "collect-parse": Schema.Struct({ planContext: OpaqueContext, captures: Schema.Array(CapturedSchema) }),
  "select-plan": Schema.Struct({
    nativeIds: Schema.NonEmptyArray(Text),
    manifestInputs: Sha256,
    manifest: ManifestSchema,
  }),
  "report-parse": Schema.Struct({
    planContext: OpaqueContext,
    requested: Schema.NonEmptyArray(Text),
    captures: Schema.Array(CapturedSchema),
  }),
};
export const RequestSchema = Schema.Struct({
  format: Schema.Literal("concord.test-adapter/v1"),
  op: Schema.Literals(["collect-plan", "collect-parse", "select-plan", "report-parse"]),
  requestId: Text,
  context: ContextSchema,
  payload: Schema.Unknown,
});
export const capabilities: typeof CapabilitiesSchema.Type = {
  realCollection: true,
  leaf: true,
  parameterGroups: false,
  exactSelection: true,
  perItemReport: true,
  range: false,
  tags: false,
  skipVisibility: false,
  rangeTrivia: false,
};
export const SelectionSchema = Schema.Struct({
  executor: Schema.Literals(["vitest", "playwright"]),
  repo: RelativePath,
  file: RelativePath,
  nativeFile: Schema.optionalKey(RelativePath),
  project: Text,
  titlePath: Schema.NonEmptyArray(Text),
  declarationTitlePath: Schema.optionalKey(Schema.NonEmptyArray(Text)),
  members: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyArray(Text))),
});
export type Selection = typeof SelectionSchema.Type;
export const CAPABILITY_VERSION = "niceeval-native/1";
export const nativeId = (selection: Selection): string => `niceeval:${encodeURIComponent(json(selection))}`;
export type Captured = typeof CapturedSchema.Type;
export type Context = typeof ContextSchema.Type;
export type NativeResult = typeof ResultSchema.Type;
