import { QueryClientProvider, queryOptions, skipToken, useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { Result } from "effect";

import {
  canonicalJsonValue,
  type InspectionOperationFor,
  type InspectionOperationId,
  type InspectionSuccessDocumentFor,
} from "../../../../../inspection/public.ts";
import type { GenerationController } from "./controller.ts";
import type { ViewGeneration, ViewGenerationIdentity } from "./generation.ts";

export type InspectionQueryKey = readonly ["inspection", ViewGenerationIdentity, string];

export function inspectionQueryKey(identity: ViewGenerationIdentity, operation: { readonly kind: string }): InspectionQueryKey {
  const encoded = canonicalJsonValue(operation);
  if (Result.isFailure(encoded)) throw new Error(`Inspection operation query key is invalid: ${encoded.failure.reason}`);
  return ["inspection", identity, `${operation.kind}:${encoded.success}`] as const;
}

export function inspectionQueryOptions<Kind extends InspectionOperationId>(
  generation: ViewGeneration,
  operation: InspectionOperationFor<Kind>,
) {
  return queryOptions({
    queryKey: inspectionQueryKey(generation.identity, operation),
    queryFn: async (): Promise<InspectionSuccessDocumentFor<Kind>> => {
      const lease = generation.acquire();
      try { return await generation.inspectRepository(operation); }
      finally { lease.release(); }
    },
  });
}

const GenerationContext = createContext<ViewGeneration<unknown> | null>(null);

export function InspectionRuntimeProvider<Snapshot>({ controller, children }: {
  readonly controller: GenerationController<Snapshot>;
  readonly children: ReactNode;
}) {
  const generation = useSyncExternalStore(
    (notify) => controller.subscribe(notify),
    () => controller.current,
    () => controller.current,
  );
  if (generation === undefined) throw new Error("No View generation has been committed.");
  return <GenerationContext.Provider value={generation as ViewGeneration<unknown>}>
    <QueryClientProvider client={generation.queryClient}>{children}</QueryClientProvider>
  </GenerationContext.Provider>;
}

export function useGenerationSnapshot<Snapshot>(controller: GenerationController<Snapshot>): Snapshot {
  const generation = useSyncExternalStore(
    (notify) => controller.subscribe(notify),
    () => controller.current,
    () => controller.current,
  );
  if (generation === undefined) throw new Error("No View generation has been committed.");
  return generation.snapshot;
}

export function useInspectionQuery<Kind extends InspectionOperationId, Selected = InspectionSuccessDocumentFor<Kind>>(
  operation: InspectionOperationFor<Kind> | null,
  options: {
    readonly enabled?: boolean;
    readonly select?: (value: InspectionSuccessDocumentFor<Kind>) => Selected;
  } = {},
): QueryObserverResult<Selected, Error> {
  const generation = useContext(GenerationContext);
  if (generation === null) throw new Error("useInspectionQuery must be used inside InspectionRuntimeProvider.");
  const enabled = (options.enabled ?? true) && operation !== null;
  if (operation === null) {
    return useQuery<InspectionSuccessDocumentFor<Kind>, Error, Selected, InspectionQueryKey>({
      queryKey: ["inspection", generation.identity, "disabled"] as const,
      queryFn: skipToken,
      enabled: false,
    });
  }
  const query = inspectionQueryOptions(generation, operation);
  return useQuery<InspectionSuccessDocumentFor<Kind>, Error, Selected, InspectionQueryKey>({
    queryKey: query.queryKey,
    queryFn: query.queryFn,
    enabled,
    ...(options.select === undefined ? {} : { select: options.select }),
  });
}
