import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Either, ParseResult, Schema } from "effect";

import {
  formatLintHits,
  lintDocsWriting,
  lintSvgTerms,
  validateRules,
} from "./docs-writing-lint.js";
import { errorMessage, RepoToolError } from "./errors.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RULES_PATH = "docs/writing-rules.json";
const RULES_FILE = join(ROOT, RULES_PATH);

export const TermScopeSchema = Schema.Literal("docs", "all", "site");
export type TermScope = typeof TermScopeSchema.Type;

const BannedTermSchema = Schema.Struct({
  term: Schema.NonEmptyTrimmedString,
  use: Schema.NonEmptyTrimmedString,
  why: Schema.NonEmptyTrimmedString,
  exempt: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
  allowIn: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
});
export type BannedTerm = typeof BannedTermSchema.Type;

const RulesFieldsSchema = Schema.Struct({
  siteBannedTerms: Schema.Array(Schema.NonEmptyTrimmedString),
  siteOnlyBannedTerms: Schema.Array(BannedTermSchema),
  bannedTerms: Schema.Array(BannedTermSchema),
});
const JsonObjectSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

interface RulesState {
  readonly source: string;
  readonly document: typeof JsonObjectSchema.Type;
  readonly fields: typeof RulesFieldsSchema.Type;
}

interface ScopedTerm extends BannedTerm {
  readonly scope: TermScope;
}

const AddTermInputSchema = Schema.Struct({
  term: Schema.NonEmptyTrimmedString,
  use: Schema.NonEmptyTrimmedString,
  why: Schema.NonEmptyTrimmedString,
  scope: TermScopeSchema,
  allowIn: Schema.Array(Schema.NonEmptyTrimmedString),
  exempt: Schema.Array(Schema.NonEmptyTrimmedString),
});
export type AddTermInput = typeof AddTermInputSchema.Type;

function decode<A, I>(path: string, schema: Schema.Schema<A, I>, input: unknown): Effect.Effect<A, RepoToolError> {
  return Schema.decodeUnknown(schema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new RepoToolError({
      operation: "decode",
      path,
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
  );
}

function readRules(): Effect.Effect<RulesState, RepoToolError> {
  return Effect.try({
    try: () => readFileSync(RULES_FILE, "utf8"),
    catch: (error) => new RepoToolError({ operation: "read", path: RULES_PATH, message: errorMessage(error) }),
  }).pipe(
    Effect.flatMap((source) => Effect.try({
      try: () => ({ source, input: JSON.parse(source) as unknown }),
      catch: (error) => new RepoToolError({ operation: "parse JSON", path: RULES_PATH, message: errorMessage(error) }),
    })),
    Effect.flatMap(({ input, source }) => Effect.all({
      document: decode(RULES_PATH, JsonObjectSchema, input),
      fields: decode(RULES_PATH, RulesFieldsSchema, input),
    }).pipe(Effect.map(({ document, fields }) => ({ source, document, fields })))),
  );
}

function termEntries(fields: RulesState["fields"]): readonly ScopedTerm[] {
  const all = new Set(fields.siteBannedTerms);
  return [
    ...fields.bannedTerms.map((entry) => ({
      ...entry,
      scope: all.has(entry.term) ? "all" as const : "docs" as const,
    })),
    ...fields.siteOnlyBannedTerms.map((entry) => ({ ...entry, scope: "site" as const })),
  ];
}

export function addTerm(
  fields: RulesState["fields"],
  input: AddTermInput,
): Either.Either<RulesState["fields"], RepoToolError> {
  if (termEntries(fields).some((entry) => entry.term === input.term)) {
    return Either.left(new RepoToolError({
      operation: "add term",
      path: RULES_PATH,
      message: `term ${JSON.stringify(input.term)} is already registered`,
    }));
  }
  const entry: BannedTerm = {
    term: input.term,
    use: input.use,
    why: input.why,
    ...(input.allowIn.length === 0 ? {} : { allowIn: [...new Set(input.allowIn)] }),
    ...(input.exempt.length === 0 ? {} : { exempt: [...new Set(input.exempt)] }),
  };
  if (input.scope === "site") {
    return Either.right({ ...fields, siteOnlyBannedTerms: [...fields.siteOnlyBannedTerms, entry] });
  }
  return Either.right({
    ...fields,
    bannedTerms: [...fields.bannedTerms, entry],
    siteBannedTerms: input.scope === "all"
      ? [...fields.siteBannedTerms, entry.term]
      : fields.siteBannedTerms,
  });
}

export function removeTerm(
  fields: RulesState["fields"],
  term: string,
): Either.Either<RulesState["fields"], RepoToolError> {
  const matches = termEntries(fields).filter((entry) => entry.term === term);
  if (matches.length === 0) {
    return Either.left(new RepoToolError({
      operation: "remove term",
      path: RULES_PATH,
      message: `term ${JSON.stringify(term)} is not registered`,
    }));
  }
  if (matches.length > 1) {
    return Either.left(new RepoToolError({
      operation: "remove term",
      path: RULES_PATH,
      message: `term ${JSON.stringify(term)} is registered more than once; run check before removing it`,
    }));
  }
  return Either.right({
    ...fields,
    bannedTerms: fields.bannedTerms.filter((entry) => entry.term !== term),
    siteOnlyBannedTerms: fields.siteOnlyBannedTerms.filter((entry) => entry.term !== term),
    siteBannedTerms: fields.siteBannedTerms.filter((entry) => entry !== term),
  });
}

function updatedDocument(state: RulesState, fields: RulesState["fields"]): typeof JsonObjectSchema.Type {
  return {
    ...state.document,
    bannedTerms: fields.bannedTerms,
    siteBannedTerms: fields.siteBannedTerms,
    siteOnlyBannedTerms: fields.siteOnlyBannedTerms,
  };
}

function serialize(document: typeof JsonObjectSchema.Type): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function writeRules(original: string, document: typeof JsonObjectSchema.Type): Effect.Effect<void, RepoToolError> {
  const temporary = `${RULES_FILE}.${process.pid}.tmp`;
  return Effect.acquireUseRelease(
    Effect.succeed(temporary),
    (path) => Effect.try({
      try: () => {
        if (readFileSync(RULES_FILE, "utf8") !== original) {
          throw new Error("file changed while the command was running; retry against the new file");
        }
        writeFileSync(path, serialize(document), { flag: "wx" });
        renameSync(path, RULES_FILE);
      },
      catch: (error) => new RepoToolError({ operation: "write", path: RULES_PATH, message: errorMessage(error) }),
    }),
    (path) => Effect.sync(() => {
      if (!existsSync(path)) return;
      try {
        unlinkSync(path);
      } catch {
        // The primary typed write error remains the command result.
      }
    }),
  );
}

export function listTerms(
  pattern: string | undefined,
  selectedScope: TermScope | undefined,
  json: boolean,
): Effect.Effect<void, RepoToolError> {
  return readRules().pipe(
    Effect.map((state) => termEntries(state.fields).filter((entry) => {
      if (selectedScope !== undefined && entry.scope !== selectedScope) return false;
      if (pattern === undefined) return true;
      return [entry.term, entry.use, entry.why]
        .join(" ")
        .toLowerCase()
        .includes(pattern.toLowerCase());
    })),
    Effect.flatMap((entries) => Effect.sync(() => {
      if (json) process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      else if (entries.length === 0) process.stdout.write("No banned terms matched.\n");
      else {
        for (const entry of entries) {
          process.stdout.write(`${entry.scope}\t${entry.term}\t${entry.use}\t${entry.why}\n`);
        }
      }
    })),
  );
}

export function addDocumentationTerm(input: unknown, dryRun: boolean): Effect.Effect<void, RepoToolError> {
  return decode("command input", AddTermInputSchema, input).pipe(
    Effect.flatMap((decodedInput) => readRules().pipe(
      Effect.flatMap((state) => Either.match(addTerm(state.fields, decodedInput), {
        onLeft: Effect.fail,
        onRight: (fields) => Effect.succeed({ state, fields, term: decodedInput.term }),
      })),
    )),
    Effect.flatMap(({ fields, state, term }) => {
      const document = updatedDocument(state, fields);
      if (dryRun) return Effect.sync(() => process.stdout.write(serialize(document)));
      return writeRules(state.source, document).pipe(
        Effect.tap(() => Effect.sync(() => {
          process.stdout.write(`Added ${JSON.stringify(term)}. Run pnpm docs:terms check.\n`);
        })),
      );
    }),
  );
}

export function removeDocumentationTerm(term: unknown, dryRun: boolean): Effect.Effect<void, RepoToolError> {
  return decode("command input", Schema.NonEmptyTrimmedString, term).pipe(
    Effect.flatMap((decodedTerm) => readRules().pipe(
      Effect.flatMap((state) => Either.match(removeTerm(state.fields, decodedTerm), {
        onLeft: Effect.fail,
        onRight: (fields) => Effect.succeed({ state, fields, decodedTerm }),
      })),
    )),
    Effect.flatMap(({ decodedTerm, fields, state }) => {
      const document = updatedDocument(state, fields);
      if (dryRun) return Effect.sync(() => process.stdout.write(serialize(document)));
      return writeRules(state.source, document).pipe(
        Effect.tap(() => Effect.sync(() => {
          process.stdout.write(`Removed ${JSON.stringify(decodedTerm)}. Run pnpm docs:terms check.\n`);
        })),
      );
    }),
  );
}

/*
 * The remaining command owns the full writing scan. It deliberately invokes
 * the shared lint functions inside one typed Effect boundary: those functions
 * are also imported by Vitest and therefore do not start a runtime themselves.
 */
export function checkTerms(json: boolean): Effect.Effect<void, RepoToolError> {
  return Effect.try({
    try: () => ({ ruleProblems: validateRules(), hits: [...lintDocsWriting().hits, ...lintSvgTerms()] }),
    catch: (error) => new RepoToolError({ operation: "check terms", message: errorMessage(error) }),
  }).pipe(
    Effect.flatMap(({ hits, ruleProblems }) => Effect.sync(() => {
      if (json) {
        process.stdout.write(`${JSON.stringify({
          ok: ruleProblems.length === 0 && hits.length === 0,
          ruleProblems,
          hits,
        }, null, 2)}\n`);
      } else {
        if (ruleProblems.length > 0) process.stderr.write(`${ruleProblems.join("\n")}\n`);
        if (hits.length > 0) process.stderr.write(`${formatLintHits(hits)}\n`);
        if (ruleProblems.length === 0 && hits.length === 0) {
          process.stdout.write("Documentation terminology is clean.\n");
        }
      }
      if (ruleProblems.length > 0 || hits.length > 0) process.exitCode = 1;
    })),
  );
}
