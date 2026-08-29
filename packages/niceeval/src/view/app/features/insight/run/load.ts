import { queryOptions } from "@tanstack/react-query";
import { inspectionQueryOptions, type ViewGenerationBinding } from "../data/index.ts";
import { runOperations } from "../data/operations.ts";
import { closeRun, type RunPageModel } from "./model.ts";

export function runQueryOptions(generation: ViewGenerationBinding, runId: string) {
  const [runOperation, summaryOperation] = runOperations(runId);
  return queryOptions({
    queryKey: ["insight-run", generation.identity, runId] as const,
    queryFn: async (): Promise<RunPageModel> => {
      const [run, summary] = await Promise.all([
        generation.queryClient.fetchQuery(inspectionQueryOptions(generation, runOperation)),
        generation.queryClient.fetchQuery(inspectionQueryOptions(generation, summaryOperation)),
      ]);
      return closeRun(run, summary);
    },
  });
}
