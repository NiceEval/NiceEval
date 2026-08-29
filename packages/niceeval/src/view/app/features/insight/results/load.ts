import { queryOptions } from "@tanstack/react-query";
import type { ViewGenerationBinding } from "../data/index.ts";
import { SelectionMissingError } from "../data/operations.ts";
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
      return Object.freeze({
        overview,
        selectedExperiments: Object.freeze(selectedExperiments),
        selectionTitle: selectedExperiments[0] ?? "Results",
      });
    },
  });
}
