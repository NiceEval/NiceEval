import { queryOptions } from "@tanstack/react-query";
import { Result } from "effect";
import { decodeInspectionOperation } from "../../../../../inspection/public.ts";
import { inspectionQueryOptions, type ViewGenerationBinding } from "../data/index.ts";
import { RouteInputError, SelectionMissingError } from "../data/operations.ts";
import type { ClosedOverview, ResultsPageModel } from "./model.ts";
import type { ViewManifest } from "../shell/manifest.ts";

export function resultsQueryOptions(
  generation: ViewGenerationBinding,
  manifest: ViewManifest,
  overview: ClosedOverview,
  groupKind: string | undefined,
  key: string | undefined,
) {
  return queryOptions({
    queryKey: ["insight-results", generation.identity, groupKind ?? null, key ?? null] as const,
    queryFn: async (): Promise<ResultsPageModel> => {
      const group = manifest.groups.find(({ identity }) => identity.kind === groupKind &&
        (identity.kind === "named" ? identity.groupId === key : identity.experimentId === key));
      if (group === undefined && manifest.groups.length > 0) {
        throw new SelectionMissingError("Results selection is unavailable.");
      }
      const selectedExperiments = group?.members ?? [];
      if (selectedExperiments.length === 1) {
        return generation.queryClient.fetchQuery(experimentQueryOptions(generation, overview, selectedExperiments[0]!));
      }
      return Object.freeze({
        overview,
        selectedExperiments,
        selectionTitle: group?.label ?? "Results",
      });
    },
  });
}

export function experimentQueryOptions(
  generation: ViewGenerationBinding,
  overview: ClosedOverview,
  experimentId: string,
) {
  return queryOptions({
    queryKey: ["insight-experiment", generation.identity, experimentId] as const,
    queryFn: async (): Promise<ResultsPageModel> => {
      if (!overview.catalog.experiments.includes(experimentId)) {
        throw new SelectionMissingError("Experiment selection is unavailable.");
      }
      const selectedExperiments = [experimentId];
      const operation = decodeInspectionOperation({
        kind: "experiment.get",
        experimentId,
      });
      if (Result.isFailure(operation) || operation.success.kind !== "experiment.get") {
        throw new RouteInputError("Invalid experiment route.");
      }
      const document = await generation.queryClient.fetchQuery(inspectionQueryOptions(generation, operation.success));
      return Object.freeze({
        overview,
        selectedExperiments: Object.freeze(selectedExperiments),
        selectionTitle: selectedExperiments[0] ?? "Results",
        costSummary: document.experiment.costSummary,
      });
    },
  });
}
