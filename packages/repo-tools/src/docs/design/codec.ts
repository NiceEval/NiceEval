import { Result, Schema, SchemaIssue } from "effect";
import { parse, stringify } from "yaml";

import { RepoRefSchema, type RepoRef } from "../trace/ref.js";
import { DesignInputInvalid } from "./errors.js";
import type { DesignDecisionState } from "./model.js";

const RefsSchema = Schema.Array(RepoRefSchema).pipe(
  Schema.check(Schema.isMinLength(1), Schema.makeFilter<readonly RepoRef[]>((values) => new Set(values).size === values.length, {
    message: "refs must be unique",
  })),
);

const UndecidedRelationsSchema = Schema.Struct({
  decides: Schema.optional(RefsSchema),
});
const DecidedRelationsSchema = Schema.Struct({
  selectedPlan: RepoRefSchema,
  decides: Schema.optional(RefsSchema),
});
const DesignReadmeSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-node/v1"),
  kind: Schema.Literal("design"),
  relations: Schema.Union([UndecidedRelationsSchema, DecidedRelationsSchema]),
});

export interface DecodedDesignReadme {
  readonly body: string;
  readonly state: DesignDecisionState;
  readonly decides: readonly RepoRef[];
}

function failure(path: string, message: string): DesignInputInvalid {
  return new DesignInputInvalid({ source: path, message });
}

export function decodeDesignReadme(path: string, source: string): DecodedDesignReadme {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) throw failure(path, "Design README must have one closed YAML frontmatter block");
  let input: unknown;
  try {
    input = parse(match[1]) as unknown;
  } catch (cause) {
    throw failure(path, cause instanceof Error ? cause.message : String(cause));
  }
  const decoded = Schema.decodeUnknownResult(DesignReadmeSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  if (Result.isFailure(decoded)) {
    throw failure(path, SchemaIssue.makeFormatterDefault()(decoded.failure.issue));
  }
  const relations = decoded.success.relations;
  return {
    body: match[2],
    state: "selectedPlan" in relations
      ? { _tag: "decided", selectedPlan: relations.selectedPlan }
      : { _tag: "undecided" },
    decides: relations.decides ?? [],
  };
}

export function encodeDecidedDesignReadme(
  decoded: DecodedDesignReadme,
  selectedPlan: RepoRef,
  body: string,
): string {
  const frontmatter = stringify({
    format: "niceeval.docs-node/v1",
    kind: "design",
    relations: {
      selectedPlan,
      ...(decoded.decides.length === 0 ? {} : { decides: decoded.decides }),
    },
  }, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\r?\n/u, "")}`;
}
