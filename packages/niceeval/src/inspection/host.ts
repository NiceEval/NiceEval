// @concord-file
// @concord-implements docs/feature/inspection/library.md
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { InspectionOperationFor, InspectionOperationId, InspectionSuccessDocumentFor } from "./protocol.ts";
import { decodeInspectionOperation, type InspectionQuery } from "./query.ts";
import { InspectionOperationError, selectInspectionOperation } from "./select.ts";
import { externalInspectionSource, openInspectionSource, operationalInspectionSource } from "./source.ts";

/** Runs fixed Inspection operations against one pinned Node.js reader and closes it when the callback settles. */
export function withInspectionQuery<A>(
  input: { readonly cwd: string; readonly recordPath?: string },
  read: (query: InspectionQuery) => A | Promise<A>,
): Promise<A> {
  const source =
    input.recordPath === undefined
      ? operationalInspectionSource(input.cwd)
      : externalInspectionSource(input.cwd, input.recordPath);
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openInspectionSource(source);
        let active = true;
        const query: InspectionQuery = {
          async inspect<Kind extends InspectionOperationId>(
            operation: InspectionOperationFor<Kind>,
          ): Promise<InspectionSuccessDocumentFor<Kind>> {
            if (!active) {
              throw new InspectionOperationError({
                code: "inspection-operation-failed",
                operation: operation.kind,
                reason: "Inspection query closed when its callback settled.",
              });
            }
            const decoded = decodeInspectionOperation(operation);
            if (Result.isFailure(decoded)) throw decoded.failure;
            return selectInspectionOperation<Kind>(opened, decoded.success as InspectionOperationFor<Kind>);
          },
        };
        return yield* Effect.tryPromise({
          try: async () => {
            try {
              return await read(query);
            } finally {
              active = false;
            }
          },
          catch: (cause) => cause,
        });
      }),
    ),
  );
}
