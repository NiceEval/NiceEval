import { Effect, ParseResult, Schema } from "effect";

import { DesignInputInvalid } from "./errors.js";

export const DesignPageSchema = Schema.Literal(
  "library",
  "cli",
  "architecture",
  "lifecycle",
  "use-case",
);
export type DesignPage = typeof DesignPageSchema.Type;

const CanonicalTemplatePathSchema = Schema.String.pipe(
  Schema.filter((value) => value.length > 0 && !value.startsWith("/") && !value.includes("\\") &&
    value.endsWith(".md") && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), {
    message: () => "must be a canonical template-relative Markdown path",
  }),
);

const UniqueTemplatePathsSchema = Schema.Array(CanonicalTemplatePathSchema).pipe(
  Schema.minItems(1),
  Schema.filter((values) => new Set(values).size === values.length, {
    message: () => "template paths must be unique",
  }),
);

export const DocsTemplateManifestSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-template/v1"),
  applicableKinds: Schema.Array(Schema.Literal("feature", "roadmap", "design", "design-plan")).pipe(
    Schema.minItems(1),
    Schema.filter((values) => new Set(values).size === values.length, {
      message: () => "applicableKinds must be unique",
    }),
  ),
  requiredFiles: UniqueTemplatePathsSchema,
  optionalFiles: Schema.Record({
    key: Schema.NonEmptyTrimmedString,
    value: UniqueTemplatePathsSchema,
  }),
});
export type DocsTemplateManifest = typeof DocsTemplateManifestSchema.Type;

const SlugSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
);
const PlansSchema = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(2));
const PagesSchema = Schema.Array(DesignPageSchema).pipe(
  Schema.filter((values) => new Set(values).size === values.length, {
    message: () => "pages must be unique",
  }),
);

export const DesignCreateInputSchema = Schema.Struct({
  command: Schema.Literal("create"),
  slug: SlugSchema,
  title: Schema.NonEmptyTrimmedString,
  plans: Schema.optional(PlansSchema),
  cases: Schema.optional(Schema.Boolean),
  pages: Schema.optional(PagesSchema),
  dryRun: Schema.optional(Schema.Boolean),
  json: Schema.optional(Schema.Boolean),
});

export const DesignCheckInputSchema = Schema.Struct({
  command: Schema.Literal("check"),
  design: Schema.NonEmptyTrimmedString,
  json: Schema.optional(Schema.Boolean),
});

export const DesignDecideInputSchema = Schema.Struct({
  command: Schema.Literal("decide"),
  design: Schema.NonEmptyTrimmedString,
  plan: Schema.NonEmptyTrimmedString,
  dryRun: Schema.optional(Schema.Boolean),
  json: Schema.optional(Schema.Boolean),
});

export const DesignCommandInputSchema = Schema.Union(
  DesignCreateInputSchema,
  DesignCheckInputSchema,
  DesignDecideInputSchema,
);
export type DesignCommandInput = typeof DesignCommandInputSchema.Type;

export function decodeDesignCommandInput(input: unknown) {
  return Schema.decodeUnknown(DesignCommandInputSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError(designInputError),
  );
}

export function designInputError(error: ParseResult.ParseError): DesignInputInvalid {
  return new DesignInputInvalid({
    source: "design command input",
    message: ParseResult.TreeFormatter.formatErrorSync(error),
  });
}
