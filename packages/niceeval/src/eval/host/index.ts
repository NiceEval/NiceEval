// @concord-file
// @concord-implements docs/feature/eval/README.md
import { Data, Effect } from "effect";
import { discoverEvals } from "../../runner/discover.ts";

/** Identifies a discovered Eval with tags and Pass or Score kind; its ID is the selection identity rather than its display description. */
export interface EvalCatalogEntry {
  readonly id: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly evaluationKind: "pass" | "score";
}

/** Lists discovered Evals without executing tests; catalog entries describe definitions rather than published results. */
export interface EvalCatalog {
  readonly entries: readonly EvalCatalogEntry[];
}

/** Reports failure to discover the Eval catalog; this is a Host operation error rather than an Attempt Verdict. */
export class EvalCatalogError extends Data.TaggedError("EvalCatalogError")<{
  readonly operation: "catalog";
  readonly cause: unknown;
}> {}

function catalog(input: { readonly cwd: string; readonly tag?: string }): Effect.Effect<EvalCatalog, EvalCatalogError> {
  return discoverEvals(input.cwd).pipe(
    Effect.map((discovered) =>
      Object.freeze({
        entries: Object.freeze(
          discovered
            .filter((definition) => input.tag === undefined || definition.tags?.includes(input.tag))
            .map((definition) =>
              Object.freeze({
                id: definition.id,
                ...(definition.description === undefined ? {} : { description: definition.description }),
                tags: Object.freeze([...(definition.tags ?? [])]),
                evaluationKind: definition.evaluationKind,
              }),
            ),
        ),
      }),
    ),
    Effect.mapError((cause) => new EvalCatalogError({ operation: "catalog", cause })),
  );
}

/** Eval discovery is a closed Host operation; CLI consumers never receive Runner definitions. */
export const evalHost = Object.freeze({ catalog });
