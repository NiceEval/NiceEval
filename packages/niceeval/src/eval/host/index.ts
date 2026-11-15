// @concord-file
// @concord-implements docs/feature/eval/README.md
import { Data, Effect } from "effect";
import { DiscoveryError, discoverEvals } from "../../runner/discover.ts";
import { normalizeExternalCause, type ExternalCause } from "../../shared/external-cause.ts";

/** Identifies a discovered Eval with tags and Pass or Score kind; its ID is the selection identity rather than its display description. */
export interface EvalCatalogEntry {
  readonly id: string;
  readonly description: string | undefined;
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
  readonly cause: DiscoveryError | ExternalCause;
}> {}

function catalog(input: {
  readonly cwd: string;
  readonly tag?: string | undefined;
}): Effect.Effect<EvalCatalog, EvalCatalogError> {
  return discoverEvals(input.cwd).pipe(
    Effect.map((discovered) => ({
      entries: discovered
        .filter((definition) => input.tag === undefined || definition.tags?.includes(input.tag))
        .map((definition) => ({
          id: definition.id,
          description: definition.description,
          tags: definition.tags ?? [],
          evaluationKind: definition.evaluationKind,
        })),
    })),
    Effect.mapError(
      (cause) =>
        new EvalCatalogError({
          operation: "catalog",
          cause: cause instanceof DiscoveryError ? cause : normalizeExternalCause(cause),
        }),
    ),
  );
}

/** Eval discovery is a closed Host operation; CLI consumers never receive Runner definitions. */
export const evalHost = Object.freeze({ catalog });
