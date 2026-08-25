import { Effect, ParseResult, Schema } from "effect";
import { parse as parseYaml } from "yaml";

import { PrDraftInvalid, PrGitHubFailure, PrInputInvalid } from "./errors.js";
import type {
  DraftMetadata,
  GitHubPullRequest,
  PrBodyInput,
  TestDirective,
} from "./model.js";

const PositiveInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
);

const InitInputSchema = Schema.Struct({
  command: Schema.Literal("init"),
  pr: Schema.optional(PositiveInteger),
  source: Schema.optional(Schema.NonEmptyString),
  base: Schema.optional(Schema.NonEmptyString),
});
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
  budget: Schema.optional(PositiveInteger),
  remote: Schema.optional(Schema.Boolean),
});
const ApplyInputSchema = Schema.Struct({
  command: Schema.Literal("apply"),
  pr: PositiveInteger,
  source: Schema.optional(Schema.NonEmptyString),
  budget: Schema.optional(PositiveInteger),
});
const CreateInputSchema = Schema.Struct({
  command: Schema.Literal("create"),
  source: Schema.optional(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  base: Schema.optional(Schema.NonEmptyString),
  budget: Schema.optional(PositiveInteger),
});

export const PrBodyInputSchema = Schema.Union(
  InitInputSchema,
  RenderInputSchema,
  CheckInputSchema,
  ApplyInputSchema,
  CreateInputSchema,
);

const DraftMetadataSchema = Schema.Struct({
  base: Schema.NonEmptyString,
  templateSha256: Schema.NonEmptyString,
  forbid: Schema.optional(Schema.Array(Schema.String)),
});

const FragmentSpecSchema = Schema.Struct({
  from: Schema.String,
  through: Schema.String,
});

const TestDirectiveSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  purpose: Schema.NonEmptyString,
  protects: Schema.NonEmptyString,
  runs: Schema.NonEmptyString,
  asserts: Schema.NonEmptyString,
  source: Schema.optional(Schema.Union(
    Schema.Literal("full"),
    Schema.Struct({
      fragments: Schema.NonEmptyArray(FragmentSpecSchema),
      reason: Schema.NonEmptyString,
    }),
  )),
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
  return Schema.decodeUnknown(PrBodyInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((cause) => new PrInputInvalid({
      message: ParseResult.TreeFormatter.formatErrorSync(cause),
    })),
  );
}

export function decodeDraftMetadata(
  source: string,
  document: string,
): Effect.Effect<DraftMetadata, PrDraftInvalid> {
  return parseYamlUnknown(source, document).pipe(
    Effect.flatMap(Schema.decodeUnknown(DraftMetadataSchema, { errors: "all" })),
    Effect.mapError((cause) => cause instanceof PrDraftInvalid
      ? cause
      : new PrDraftInvalid({
          source,
          message: `invalid niceeval:pr-body metadata: ${ParseResult.TreeFormatter.formatErrorSync(cause)}`,
          cause,
        })),
  );
}

export function decodeTestDirective(
  source: string,
  document: string,
): Effect.Effect<TestDirective, PrDraftInvalid> {
  return parseYamlUnknown(source, document).pipe(
    Effect.flatMap(Schema.decodeUnknown(TestDirectiveSchema, { errors: "all" })),
    Effect.mapError((cause) => cause instanceof PrDraftInvalid
      ? cause
      : new PrDraftInvalid({
          source,
          message: `invalid niceeval:test directive: ${ParseResult.TreeFormatter.formatErrorSync(cause)}`,
          cause,
        })),
  );
}

export function decodeGitHubPullRequest(
  pr: number,
  input: unknown,
): Effect.Effect<GitHubPullRequest, PrGitHubFailure> {
  return Schema.decodeUnknown(GitHubPullRequestSchema, { errors: "all" })(input).pipe(
    Effect.mapError((cause) => new PrGitHubFailure({ operation: "decode-view", pr, cause })),
  );
}
