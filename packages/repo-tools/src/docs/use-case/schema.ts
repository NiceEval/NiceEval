import { Effect, Result, Schema, SchemaIssue } from "effect";

import { UseCaseInputInvalid } from "./errors.js";
import type { UseCaseCreateInput } from "./model.js";

const SingleSegmentSlug = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isPattern(/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u, {
      message: "must be one non-empty path segment made of Unicode letters or numbers separated by single hyphens",
    }),
  ),
);
const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const ParentSelector = NonEmptyTrimmedString.check(Schema.makeFilter((value: string) =>
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !value.includes("#") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."), {
  message: "must be a canonical Feature ID or repo-relative README path without traversal",
}));
const NonEmptyBody = Schema.String.check(Schema.makeFilter((value: string) => value.trim().length > 0, {
  message: "must contain non-whitespace Markdown",
}));

const UseCaseCreateInputSchema = Schema.Struct({
  slug: SingleSegmentSlug,
  parent: ParentSelector,
  title: NonEmptyTrimmedString,
  body: NonEmptyBody,
  dryRun: Schema.Boolean,
});

function sourceFromIssue(message: string): UseCaseInputInvalid["source"] {
  const match = /\["(slug|parent|title|body)"\]/u.exec(message);
  return match?.[1] === "slug" || match?.[1] === "parent" || match?.[1] === "title" || match?.[1] === "body"
    ? match[1]
    : "body";
}

export function decodeUseCaseCreateInput(
  input: UseCaseCreateInput,
): Effect.Effect<UseCaseCreateInput, UseCaseInputInvalid> {
  const decoded = Schema.decodeUnknownResult(UseCaseCreateInputSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  if (Result.isSuccess(decoded)) return Effect.succeed(decoded.success);
  const message = SchemaIssue.makeFormatterDefault()(decoded.failure.issue);
  return Effect.fail(new UseCaseInputInvalid({ source: sourceFromIssue(message), message }));
}
