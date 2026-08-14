import { Either, Schema } from "effect";
import {
  canonicalRecordJsonText,
  defineRecordCore,
  defineRecordProperty,
  type RecordJson,
  type RecordJsonObject,
  type RecordValueFailure,
  type RecordValueLimits,
} from "../definition/index.ts";
import { ExperimentIdSchema } from "../codec/identifiers.ts";
import {
  nonEmptyRecordIssues,
  recordIssue,
  type NonEmptyRecordIssues,
  type RecordIssue,
} from "../errors/record-errors.ts";
import type { ExperimentId } from "./identifiers.ts";

/** The complete budget for one immutable, self-explaining Run context. */
export const RunContextLimits: RecordValueLimits = Object.freeze({
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

function isJsonObject(value: unknown): value is RunContextJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const JsonObjectSchema: Schema.Schema<RunContextJsonObject> = Schema.declare(isJsonObject);

const RunExecutionContextSchema: Schema.Schema<RunExecutionContext> = Schema.Struct({
  agentId: Schema.String.pipe(Schema.minLength(1)),
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  flags: JsonObjectSchema,
});

const RunLabelsSchema: Schema.Schema<Readonly<Record<string, string>>> = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});

/**
 * These token ids are Record-internal identities. They are not AnalysisInput
 * ids, and the object field names remain independently renameable.
 */
const RunContextProperties = Object.freeze({
  experimentId: defineRecordProperty({
    id: "niceeval.record.run-context.experiment",
    durableKey: "experimentId",
    schema: ExperimentIdSchema,
  }),
  execution: defineRecordProperty({
    id: "niceeval.record.run-context.execution",
    durableKey: "execution",
    schema: RunExecutionContextSchema,
  }),
  labels: defineRecordProperty({
    id: "niceeval.record.run-context.labels",
    durableKey: "labels",
    schema: RunLabelsSchema,
  }),
});

/** Run Context is Core, not an Attachment; it shares only the value primitive. */
const RunContextDefinition = defineRecordCore({
  properties: RunContextProperties,
  limits: RunContextLimits,
});

export const RunContextSchema: Schema.Schema<RunContext> = RunContextDefinition.schema;

function issuesFromFailure(failure: RecordValueFailure): NonEmptyRecordIssues {
  const issue: RecordIssue = failure.kind === "canonical"
    ? recordIssue(
      failure.failure.code === "record-json-limit-exceeded"
        ? "record-run-context-size-exceeded"
        : "record-run-context-invalid",
      failure.failure.path,
    )
    : failure.kind === "refine"
      ? recordIssue("record-run-context-invalid", failure.issues[0]?.path ?? [])
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
