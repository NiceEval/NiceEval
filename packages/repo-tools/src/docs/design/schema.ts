import { Effect, Schema, SchemaIssue } from "effect";

import { DesignInputInvalid } from "./errors.js";

const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
export const DESIGN_PAGE_ORDER = ["library", "cli", "architecture", "lifecycle", "use-case"] as const;
export const DesignPageSchema = Schema.Literals(DESIGN_PAGE_ORDER);
export type DesignPage = typeof DesignPageSchema.Type;

const CanonicalTemplatePathSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value: string) => value.length > 0 && !value.startsWith("/") && !value.includes("\\") &&
    value.endsWith(".md") && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), {
    message: "must be a canonical template-relative Markdown path",
  })),
);

const UniqueTemplatePathsSchema = Schema.Array(CanonicalTemplatePathSchema).pipe(
  Schema.check(Schema.isMinLength(1), Schema.makeFilter<readonly string[]>((values) => new Set(values).size === values.length, { message: "template paths must be unique" })),
);

export const DocsTemplateManifestSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-template/v1"),
  applicableKinds: Schema.Array(Schema.Literals(["feature", "roadmap", "design", "design-plan"])).pipe(
    Schema.check(Schema.isMinLength(1), Schema.makeFilter<readonly ("feature" | "roadmap" | "design" | "design-plan")[]>((values) => new Set(values).size === values.length, { message: "applicableKinds must be unique" })),
  ),
  requiredFiles: UniqueTemplatePathsSchema,
  optionalFiles: Schema.Record(NonEmptyTrimmedString, UniqueTemplatePathsSchema),
});
export type DocsTemplateManifest = typeof DocsTemplateManifestSchema.Type;

const SlugSchema = NonEmptyTrimmedString.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));
const PlansSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(2));
const PagesSchema = Schema.Array(DesignPageSchema).check(Schema.makeFilter<readonly DesignPage[]>((values) => new Set(values).size === values.length, { message: "pages must be unique" }));

export const DesignCreateInputSchema = Schema.Struct({
  command: Schema.Literal("create"),
  slug: SlugSchema,
  title: NonEmptyTrimmedString,
  plans: Schema.optional(PlansSchema),
  cases: Schema.optional(Schema.Boolean),
  pages: Schema.optional(PagesSchema),
  dryRun: Schema.optional(Schema.Boolean),
});

export const DesignCheckInputSchema = Schema.Struct({
  command: Schema.Literal("check"),
  design: NonEmptyTrimmedString,
});

export const DesignDecideInputSchema = Schema.Struct({
  command: Schema.Literal("decide"),
  design: NonEmptyTrimmedString,
  plan: NonEmptyTrimmedString,
  dryRun: Schema.optional(Schema.Boolean),
});

export const DesignCommandInputSchema = Schema.Union([
  DesignCreateInputSchema,
  DesignCheckInputSchema,
  DesignDecideInputSchema,
]);
export type DesignCommandInput = typeof DesignCommandInputSchema.Type;

export function decodeDesignCommandInput(input: unknown) {
  return Schema.decodeUnknownEffect(DesignCommandInputSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError(designInputError),
  );
}

export function designInputError(error: Schema.SchemaError): DesignInputInvalid {
  return new DesignInputInvalid({
    source: "design command input",
    message: SchemaIssue.makeFormatterDefault()(error.issue),
  });
}
