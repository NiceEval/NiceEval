import { queryOptions } from "@tanstack/react-query";
import { Result } from "effect";
import { decodeInspectionOperation } from "../../../../../inspection/public.ts";
import { inspectionQueryOptions, type ViewGenerationBinding } from "../data/index.ts";
import { RouteInputError, SelectionMissingError, projectOperation } from "../data/operations.ts";
import type { ClosedOverview, ResultsPageModel } from "./model.ts";
import type { ViewManifest } from "../shell/manifest.ts";

export function resultsQueryOptions(
  generation: ViewGenerationBinding,
  manifest: ViewManifest,
  overview: ClosedOverview,
  targetMode: ResultsPageModel["targetMode"],
  groupKind: string | undefined,
  key: string | undefined,
) {
  return queryOptions({
    queryKey: ["insight-results", generation.identity, targetMode, groupKind ?? null, key ?? null] as const,
    queryFn: async (): Promise<ResultsPageModel> => {
      const group = manifest.groups.find(
        ({ identity }) =>
          identity.kind === groupKind &&
          (identity.kind === "named" ? identity.groupId === key : identity.experimentId === key),
      );
      if (group === undefined && manifest.groups.length > 0) {
        throw new SelectionMissingError("Results selection is unavailable.");
      }
      const selectedExperiments = group?.members ?? [];
      if (selectedExperiments.length === 1) {
        return generation.queryClient.fetchQuery(
          experimentQueryOptions(generation, overview, targetMode, selectedExperiments[0]!),
        );
      }
      const current =
        targetMode === "current"
          ? (
              await generation.queryClient.fetchQuery(
                inspectionQueryOptions(
                  generation,
                  selectedExperiments.length === 0 ? projectOperation() : projectOperation(selectedExperiments),
                ),
              )
            ).project
          : undefined;
      const currentHistory =
        current === undefined
          ? undefined
          : (await generation.queryClient.fetchQuery(inspectionQueryOptions(generation, projectOperation()))).project
              .history;
      return Object.freeze({
        overview,
        selectedExperiments,
        selectionTitle: group?.label ?? "Results",
        targetMode,
        ...(current === undefined ? {} : { current }),
        ...(currentHistory === undefined ? {} : { currentHistory }),
      });
    },
  });
}

export function experimentQueryOptions(
  generation: ViewGenerationBinding,
  overview: ClosedOverview,
  targetMode: ResultsPageModel["targetMode"],
  experimentId: string,
) {
  return queryOptions({
    queryKey: ["insight-experiment", generation.identity, targetMode, experimentId] as const,
    queryFn: async (): Promise<ResultsPageModel> => {
      if (!overview.catalog.experiments.includes(experimentId)) {
        throw new SelectionMissingError("Experiment selection is unavailable.");
      }
      const selectedExperiments = [experimentId];
      if (targetMode === "current") {
        const current = (
          await generation.queryClient.fetchQuery(
            inspectionQueryOptions(generation, projectOperation(selectedExperiments)),
          )
        ).project;
        const currentHistory = (
          await generation.queryClient.fetchQuery(inspectionQueryOptions(generation, projectOperation()))
        ).project.history;
        return Object.freeze({
          overview,
          selectedExperiments,
          selectionTitle: experimentId,
          current,
          currentHistory,
          targetMode,
        });
      }
      if (targetMode === "unavailable")
        return Object.freeze({ overview, selectedExperiments, selectionTitle: experimentId, targetMode });
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
        targetMode,
        costSummary: document.experiment.costSummary,
      });
    },
  });
}
