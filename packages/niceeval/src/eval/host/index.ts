import { Data, Effect } from "effect";
import { discoverEvals } from "../../runner/discover.ts";

export interface EvalCatalogEntry {
  readonly id: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly evaluationKind: "pass" | "score";
}

export interface EvalCatalog {
  readonly entries: readonly EvalCatalogEntry[];
}

export class EvalCatalogError extends Data.TaggedError("EvalCatalogError")<{
  readonly operation: "catalog";
  readonly cause: unknown;
}> {}

function catalog(input: {
  readonly cwd: string;
  readonly tag?: string;
}): Effect.Effect<EvalCatalog, EvalCatalogError> {
  return discoverEvals(input.cwd).pipe(
    Effect.map((discovered) => Object.freeze({
      entries: Object.freeze(discovered
        .filter((definition) => input.tag === undefined || definition.tags?.includes(input.tag))
        .map((definition) => Object.freeze({
          id: definition.id,
          ...(definition.description === undefined ? {} : { description: definition.description }),
          tags: Object.freeze([...(definition.tags ?? [])]),
          evaluationKind: definition.evaluationKind,
        }))),
    })),
    Effect.mapError((cause) => new EvalCatalogError({ operation: "catalog", cause })),
  );
}

/** Eval discovery is a closed Host operation; CLI consumers never receive Runner definitions. */
export const evalHost = Object.freeze({ catalog });
