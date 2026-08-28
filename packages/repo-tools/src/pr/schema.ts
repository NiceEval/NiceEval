import { Effect, Schema } from "effect";
import { parse as parseYaml } from "yaml";

import { PrDraftInvalid, PrGitHubFailure, PrInputInvalid } from "./errors.js";
import type {
  DraftMetadata,
  GitHubPullRequest,
  PrBodyEditorState,
  PrBodyInput,
  TestDirective,
} from "./model.js";
import { PR_BODY_CASE_DIRECTIONS, PR_BODY_CASE_SECTIONS, PR_BODY_TEST_PURPOSES } from "./model.js";

const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));

const InitInputSchema = Schema.Struct({
  command: Schema.Literal("init"),
  pr: Schema.optional(PositiveInteger),
  source: Schema.optional(Schema.NonEmptyString),
  base: Schema.optional(Schema.NonEmptyString),
});
const DraftLocationInputSchema = {
  pr: Schema.optional(PositiveInteger),
  source: Schema.optional(Schema.NonEmptyString),
};
const StatusInputSchema = Schema.Struct({ command: Schema.Literal("status"), ...DraftLocationInputSchema });
const DiscardInputSchema = Schema.Struct({ command: Schema.Literal("discard"), ...DraftLocationInputSchema });
const EditorLocationFields = {
  pr: Schema.optional(PositiveInteger),
  source: Schema.optional(Schema.NonEmptyString),
};
const ProblemFields = {
  userGoal: Schema.NonEmptyString,
  currentLimitation: Schema.NonEmptyString,
  requiredCapability: Schema.NonEmptyString,
  userOutcome: Schema.NonEmptyString,
};
const CaseIdentityFields = {
  section: Schema.Literals(PR_BODY_CASE_SECTIONS),
  direction: Schema.Literals(PR_BODY_CASE_DIRECTIONS),
  name: Schema.NonEmptyString,
};
const CaseFields = {
  ...CaseIdentityFields,
  beforeInput: Schema.NonEmptyString,
  beforeOutput: Schema.NonEmptyString,
  afterInput: Schema.optional(Schema.NonEmptyString),
  afterOutput: Schema.NonEmptyString,
  userImpact: Schema.NonEmptyString,
  language: Schema.optional(Schema.NonEmptyString),
};
const RenderInputSchema = Schema.Struct({
  command: Schema.Literal("render"),
  pr: Schema.optional(PositiveInteger),
  source: Schema.optional(Schema.NonEmptyString),
  out: Schema.optional(Schema.NonEmptyString),
});
const CheckInputSchema = Schema.Struct({
  command: Schema.Literal("check"),
  pr: Schema.optional(PositiveInteger),
  source: Schema.optional(Schema.NonEmptyString),
  remote: Schema.optional(Schema.Boolean),
});
const ApplyInputSchema = Schema.Struct({
  command: Schema.Literal("apply"),
  pr: PositiveInteger,
  source: Schema.optional(Schema.NonEmptyString),
});
const CreateInputSchema = Schema.Struct({
  command: Schema.Literal("create"),
  source: Schema.optional(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  base: Schema.optional(Schema.NonEmptyString),
});

const DraftMetadataSchema = Schema.Struct({
  base: Schema.NonEmptyString,
  templateSha256: Schema.NonEmptyString,
  forbid: Schema.optional(Schema.Array(Schema.String)),
});

const FragmentSpecSchema = Schema.Struct({
  from: Schema.String,
  through: Schema.String,
});

const TestDirectiveFields = {
  path: Schema.NonEmptyString,
  purpose: Schema.Literals(PR_BODY_TEST_PURPOSES),
  protects: Schema.NonEmptyString,
  runs: Schema.NonEmptyString,
  asserts: Schema.NonEmptyString,
  source: Schema.optional(Schema.Union([
    Schema.Literal("full"),
    Schema.Struct({
      fragments: Schema.NonEmptyArray(FragmentSpecSchema),
      reason: Schema.NonEmptyString,
    }),
  ])),
};
const TestDirectiveSchema = Schema.Struct(TestDirectiveFields);

const EditResetInputSchema = Schema.Struct({
  command: Schema.Literal("edit"),
  operation: Schema.Literal("reset"),
  ...EditorLocationFields,
});
const EditProblemInputSchema = Schema.Struct({
  command: Schema.Literal("edit"),
  operation: Schema.Literal("problem"),
  ...EditorLocationFields,
  ...ProblemFields,
});
const EditCaseSetInputSchema = Schema.Struct({
  command: Schema.Literal("edit"),
  operation: Schema.Literal("case-set"),
  ...EditorLocationFields,
  ...CaseFields,
});
const EditCaseRemoveInputSchema = Schema.Struct({
  command: Schema.Literal("edit"),
  operation: Schema.Literal("case-remove"),
  ...EditorLocationFields,
  ...CaseIdentityFields,
});
const EditTestSetInputSchema = Schema.Struct({
  command: Schema.Literal("edit"),
  operation: Schema.Literal("test-set"),
  ...EditorLocationFields,
  path: TestDirectiveFields.path,
  purpose: TestDirectiveFields.purpose,
  protects: TestDirectiveFields.protects,
  runs: TestDirectiveFields.runs,
  asserts: TestDirectiveFields.asserts,
  fragmentFrom: Schema.Array(Schema.String),
  fragmentThrough: Schema.Array(Schema.String),
  fragmentReason: Schema.optional(Schema.NonEmptyString),
});
const EditTestRemoveInputSchema = Schema.Struct({
  command: Schema.Literal("edit"),
  operation: Schema.Literal("test-remove"),
  ...EditorLocationFields,
  path: Schema.NonEmptyString,
});

export const PrBodyInputSchema = Schema.Union([
  InitInputSchema,
  StatusInputSchema,
  DiscardInputSchema,
  EditResetInputSchema,
  EditProblemInputSchema,
  EditCaseSetInputSchema,
  EditCaseRemoveInputSchema,
  EditTestSetInputSchema,
  EditTestRemoveInputSchema,
  RenderInputSchema,
  CheckInputSchema,
  ApplyInputSchema,
  CreateInputSchema,
]);

const PrBodyEditorStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  problem: Schema.optional(Schema.Struct(ProblemFields)),
  cases: Schema.Array(Schema.Struct(CaseFields)),
  tests: Schema.Array(TestDirectiveSchema),
});

const GitHubPullRequestSchema = Schema.Struct({
  body: Schema.String,
  headRefOid: Schema.NonEmptyString,
});

function parseYamlUnknown(source: string, document: string): Effect.Effect<unknown, PrDraftInvalid> {
  return Effect.try({
    try: () => parseYaml(document) as unknown,
    catch: (cause) => new PrDraftInvalid({ source, message: "invalid YAML", cause }),
  });
}

export function decodePrBodyInput(input: unknown): Effect.Effect<PrBodyInput, PrInputInvalid> {
  return Schema.decodeUnknownEffect(PrBodyInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((cause) => new PrInputInvalid({
      message: String(cause),
    })),
  );
}

export function decodeDraftMetadata(
  source: string,
  document: string,
): Effect.Effect<DraftMetadata, PrDraftInvalid> {
  return parseYamlUnknown(source, document).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(DraftMetadataSchema, { errors: "all" })),
    Effect.mapError((cause) => cause instanceof PrDraftInvalid
      ? cause
      : new PrDraftInvalid({
          source,
          message: `invalid niceeval:pr-body metadata: ${String(cause)}`,
          cause,
        })),
  );
}

export function decodeTestDirective(
  source: string,
  document: string,
): Effect.Effect<TestDirective, PrDraftInvalid> {
  return parseYamlUnknown(source, document).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(TestDirectiveSchema, { errors: "all" })),
    Effect.mapError((cause) => cause instanceof PrDraftInvalid
      ? cause
      : new PrDraftInvalid({
          source,
          message: `invalid niceeval:test directive: ${String(cause)}`,
          cause,
        })),
  );
}

export function decodePrBodyEditorState(
  source: string,
  document: string,
): Effect.Effect<PrBodyEditorState, PrDraftInvalid> {
  return parseYamlUnknown(source, document).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PrBodyEditorStateSchema, { errors: "all" })),
    Effect.mapError((cause) => cause instanceof PrDraftInvalid
      ? cause
      : new PrDraftInvalid({
          source,
          message: `invalid niceeval:pr-editor state: ${String(cause)}`,
          cause,
        })),
  );
}

export function decodeGitHubPullRequest(
  pr: number,
  input: unknown,
): Effect.Effect<GitHubPullRequest, PrGitHubFailure> {
  return Schema.decodeUnknownEffect(GitHubPullRequestSchema, { errors: "all" })(input).pipe(
    Effect.mapError((cause) => new PrGitHubFailure({ operation: "decode-view", pr, cause })),
  );
}
