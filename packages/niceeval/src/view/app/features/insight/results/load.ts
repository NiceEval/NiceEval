import type { GenerationLease } from "../data/index.ts";
import { overviewOperation, SelectionMissingError } from "../data/operations.ts";
import { closeOverview, type ResultsPageModel } from "./model.ts";
import type { ViewManifest } from "../shell/manifest.ts";

export async function loadResults(
  lease: GenerationLease,
  manifest: ViewManifest,
  groupKind: string | undefined,
  key: string | undefined,
): Promise<ResultsPageModel> {
  const overview = closeOverview(await lease.inspect(overviewOperation()));
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
}

export async function loadExperiment(
  lease: GenerationLease,
  experimentId: string,
): Promise<ResultsPageModel> {
  const overview = closeOverview(await lease.inspect(overviewOperation()));
  if (!overview.catalog.experiments.includes(experimentId)) {
    throw new SelectionMissingError("Experiment selection is unavailable.");
  }
  const selectedExperiments = [experimentId];
  return Object.freeze({
    overview,
    selectedExperiments: Object.freeze(selectedExperiments),
    selectionTitle: selectedExperiments[0] ?? "Results",
  });
}
