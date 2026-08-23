import { Effect, Either } from "effect";

import { DocsConflictError, DocsDecodeError } from "./errors.js";
import {
  AddTermInputSchema,
  type AddTermInput,
  type BannedTerm,
  JsonObjectSchema,
  type TermScope,
  type TermsReceipt,
  WritingRulesFieldsSchema,
} from "./model.js";
import {
  atomicWriteText,
  decodeUnknown,
  readText,
  runSuccessfulCommand,
} from "./runtime.js";

const RULES_PATH = "docs/writing-rules.json";

type RulesFields = typeof WritingRulesFieldsSchema.Type;
type JsonObject = typeof JsonObjectSchema.Type;

interface RulesState {
  readonly source: string;
  readonly document: JsonObject;
  readonly fields: RulesFields;
}

export interface ScopedTerm extends BannedTerm {
  readonly scope: TermScope;
}

function parseJson(source: string): Effect.Effect<unknown, DocsDecodeError> {
  return Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (error) => new DocsDecodeError({
      source: RULES_PATH,
      message: error instanceof Error ? error.message : String(error),
    }),
  });
}

function readRules(): Effect.Effect<RulesState, DocsDecodeError | import("./errors.js").DocsFileError> {
  return readText(RULES_PATH).pipe(
    Effect.flatMap((source) => parseJson(source).pipe(
      Effect.flatMap((input) => Effect.all({
        document: decodeUnknown(RULES_PATH, JsonObjectSchema, input),
        fields: decodeUnknown(RULES_PATH, WritingRulesFieldsSchema, input),
      })),
      Effect.map(({ document, fields }) => ({ source, document, fields })),
    )),
  );
}
export function termEntries(fields: RulesFields): readonly ScopedTerm[] {
  const siteTerms = new Set(fields.siteBannedTerms);
  return [
    ...fields.bannedTerms.map((entry) => ({
      ...entry,
      scope: siteTerms.has(entry.term) ? "all" as const : "docs" as const,
    })),
    ...fields.siteOnlyBannedTerms.map((entry) => ({ ...entry, scope: "site" as const })),
  ];
}

export function addTerm(
  fields: RulesFields,
  input: AddTermInput,
): Either.Either<RulesFields, DocsConflictError> {
  if (termEntries(fields).some((entry) => entry.term === input.term)) {
    return Either.left(new DocsConflictError({
      operation: "add documentation term",
      conflicts: [`${JSON.stringify(input.term)} is already registered`],
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
    return Either.right({
      ...fields,
      siteOnlyBannedTerms: [...fields.siteOnlyBannedTerms, entry],
    });
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
  fields: RulesFields,
  term: string,
): Either.Either<RulesFields, DocsConflictError> {
  const matches = termEntries(fields).filter((entry) => entry.term === term);
  if (matches.length !== 1) {
    return Either.left(new DocsConflictError({
      operation: "remove documentation term",
      conflicts: matches.length === 0
        ? [`${JSON.stringify(term)} is not registered`]
        : [`${JSON.stringify(term)} is registered more than once; run check first`],
    }));
  }
  return Either.right({
    ...fields,
    bannedTerms: fields.bannedTerms.filter((entry) => entry.term !== term),
    siteOnlyBannedTerms: fields.siteOnlyBannedTerms.filter((entry) => entry.term !== term),
    siteBannedTerms: fields.siteBannedTerms.filter((entry) => entry !== term),
  });
}

function updateDocument(state: RulesState, fields: RulesFields): JsonObject {
  return {
    ...state.document,
    bannedTerms: fields.bannedTerms,
    siteBannedTerms: fields.siteBannedTerms,
    siteOnlyBannedTerms: fields.siteOnlyBannedTerms,
  };
}

function serialize(document: JsonObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function listDocumentationTerms(
  pattern: string | undefined,
  selectedScope: TermScope | undefined,
): Effect.Effect<TermsReceipt, import("./errors.js").DocsDomainError> {
  return readRules().pipe(
    Effect.map((state) => termEntries(state.fields).filter((entry) => {
      if (selectedScope !== undefined && entry.scope !== selectedScope) return false;
      if (pattern === undefined) return true;
      return [entry.term, entry.use, entry.why].join(" ").toLowerCase().includes(pattern.toLowerCase());
    })),
    Effect.map((terms) => ({ command: "list" as const, terms })),
  );
}

export function addDocumentationTerm(
  input: unknown,
  dryRun: boolean,
): Effect.Effect<TermsReceipt, import("./errors.js").DocsDomainError> {
  return decodeUnknown("docs terms add input", AddTermInputSchema, input).pipe(
    Effect.flatMap((decoded) => readRules().pipe(
      Effect.flatMap((state) => Either.match(addTerm(state.fields, decoded), {
        onLeft: Effect.fail,
        onRight: (fields) => Effect.succeed({ state, fields }),
      })),
      Effect.flatMap(({ fields, state }) => {
        const document = updateDocument(state, fields);
        const receipt: TermsReceipt = { command: "add", term: decoded.term, dryRun, document };
        return dryRun
          ? Effect.succeed(receipt)
          : atomicWriteText(RULES_PATH, serialize(document), state.source).pipe(Effect.as(receipt));
      }),
    )),
  );
}

export function removeDocumentationTerm(
  term: unknown,
  dryRun: boolean,
): Effect.Effect<TermsReceipt, import("./errors.js").DocsDomainError> {
  return decodeUnknown("docs terms remove input", AddTermInputSchema.fields.term, term).pipe(
    Effect.flatMap((decoded) => readRules().pipe(
      Effect.flatMap((state) => Either.match(removeTerm(state.fields, decoded), {
        onLeft: Effect.fail,
        onRight: (fields) => Effect.succeed({ state, fields }),
      })),
      Effect.flatMap(({ fields, state }) => {
        const document = updateDocument(state, fields);
        const receipt: TermsReceipt = { command: "remove", term: decoded, dryRun, document };
        return dryRun
          ? Effect.succeed(receipt)
          : atomicWriteText(RULES_PATH, serialize(document), state.source).pipe(Effect.as(receipt));
      }),
    )),
  );
}

export function checkDocumentationTerms(): Effect.Effect<
  TermsReceipt,
  import("./errors.js").DocsDomainError,
  import("@effect/platform/CommandExecutor").CommandExecutor
> {
  return runSuccessfulCommand("pnpm", ["run", "lint:docs"], { inherit: true }).pipe(
    Effect.as({
      command: "check" as const,
      lint: {
        format: "niceeval.docs-command-receipt/v1" as const,
        command: "pnpm run lint:docs",
        status: "completed" as const,
        changedPaths: [],
        summary: "The canonical documentation lint passed.",
      },
    }),
  );
}
