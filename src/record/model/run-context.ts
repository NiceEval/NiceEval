import { Either, Schema } from "effect";
import {
  canonicalRecordJsonText,
  defineRecordCore,
  type RecordJson,
  type RecordJsonObject,
  type RecordSchemaLimits,
} from "../definition/index.ts";
import type { RecordSchemaFailure } from "../definition/schema-codec.ts";
import { ExperimentIdSchema } from "../codec/identifiers.ts";
import {
  nonEmptyRecordIssues,
  recordIssue,
  type NonEmptyRecordIssues,
  type RecordIssue,
} from "../errors/record-errors.ts";
import type { ExperimentId } from "./identifiers.ts";

/** The complete budget for one immutable, self-explaining Run context. */
export const RunContextLimits: RecordSchemaLimits = Object.freeze({
  maximumJsonBytes: 256 * 1024,
  maximumDepth: 8,
  maximumNodes: 4_096,
  maximumObjectKeys: 64,
  maximumArrayItems: 256,
  maximumKeyUtf8Bytes: 256,
  maximumStringUtf8Bytes: 8 * 1024,
});

export type RunContextJsonValue = RecordJson;
export type RunContextJsonObject = RecordJsonObject;

export interface RunExecutionContext {
  readonly agentId: string;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  /** Secret-free author-declared JSON. Its meaning is deliberately not inferred. */
  readonly flags: RunContextJsonObject;
}

/** Core history required to interpret the sealed Run without current configuration. */
export interface RunContext {
  readonly experimentId: ExperimentId;
  readonly execution: RunExecutionContext;
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * `flags` is intentionally an open v1 JSON object. Keep its recursive exact
 * JSON shape in Schema rather than reducing it to an opaque runtime guard.
 */
const RunContextJsonValueSchema: Schema.Schema<RunContextJsonValue> = Schema.suspend(
  () => Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.JsonNumber,
    Schema.String,
    Schema.Array(RunContextJsonValueSchema),
    Schema.Record({ key: Schema.String, value: RunContextJsonValueSchema }),
  ),
);

const RunContextJsonObjectSchema: Schema.Schema<RunContextJsonObject> = Schema.Record({
  key: Schema.String,
  value: RunContextJsonValueSchema,
});

const RunExecutionContextSchema: Schema.Schema<RunExecutionContext> = Schema.Struct({
  agentId: Schema.String.pipe(Schema.minLength(1)),
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  flags: RunContextJsonObjectSchema,
});

const RunLabelsSchema: Schema.Schema<Readonly<Record<string, string>>> = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});

const RunContextCurrentSchema = Schema.Struct({
  experimentId: ExperimentIdSchema,
  execution: RunExecutionContextSchema,
  labels: RunLabelsSchema,
});

/** Run Context is Core, not an Attachment. */
const RunContextDefinition = defineRecordCore({
  schema: RunContextCurrentSchema,
  limits: RunContextLimits,
});

export const RunContextSchema = RunContextDefinition.schema;

function issuesFromFailure(failure: RecordSchemaFailure): NonEmptyRecordIssues {
  const issue: RecordIssue = failure.kind === "canonical"
    ? recordIssue(
      failure.failure.code === "record-json-limit-exceeded"
        ? "record-run-context-size-exceeded"
        : "record-run-context-invalid",
      failure.failure.path,
    )
    : recordIssue("record-run-context-invalid");
  const issues = nonEmptyRecordIssues([issue]);
  if (issues === undefined) throw new Error("Run context failure must contain one issue");
  return issues;
}

/** Decode, canonicalize, validate exactly, and deep-freeze the current Context. */
export function canonicalizeRunContext(
  input: unknown,
): Either.Either<RunContext, NonEmptyRecordIssues> {
  const decoded = RunContextDefinition.decode(input);
  return Either.isLeft(decoded)
    ? Either.left(issuesFromFailure(decoded.left))
    : Either.right(decoded.right);
}

export function validateRunContext(input: unknown): readonly RecordIssue[] {
  const decoded = canonicalizeRunContext(input);
  return Either.isLeft(decoded) ? decoded.left : Object.freeze([]);
}

export function runContextCanonicalJson(context: RunContext): string {
  const encoded = RunContextDefinition.encode(context);
  if (Either.isLeft(encoded)) {
    throw new Error("A RunContext value must be valid before serialization");
  }
  return canonicalRecordJsonText(encoded.right);
}
