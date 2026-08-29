import { queryOptions } from "@tanstack/react-query";
import { inspectionQueryOptions, type ViewGenerationBinding } from "../../data/index.ts";
import { attemptOperations } from "../../data/operations.ts";
import { closeAttemptPage, type AttemptPageModel } from "../model/page.ts";

export function attemptQueryOptions(generation: ViewGenerationBinding, locator: string) {
  const [attemptOperation, traceOperation] = attemptOperations(locator);
  return queryOptions({
    queryKey: ["insight-attempt", generation.identity, locator] as const,
    queryFn: async (): Promise<AttemptPageModel> => {
      const [attempt, trace] = await Promise.all([
        generation.queryClient.fetchQuery(inspectionQueryOptions(generation, attemptOperation)),
        generation.queryClient.fetchQuery(inspectionQueryOptions(generation, traceOperation)),
      ]);
      return closeAttemptPage(attempt, trace);
    },
  });
}
