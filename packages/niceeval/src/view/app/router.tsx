import type { InspectionDocument } from "../../inspection/codec.ts";
import { viewManifest } from "./legacy/client/manifest.ts";
import {
  createLegacyViewRouter,
  type LegacyPageRenderers,
  type LegacyPageRepository,
} from "./legacy/client/view-router.tsx";
import {
  assertionDetailOperations,
  AttemptPage,
  traceDetailOperations,
  type AttemptInspectionBundle,
} from "./legacy/integration/attempt.tsx";
import {
  closeOverview,
  ExperimentPage,
  OverviewPage,
  type ClosedOverview,
} from "./legacy/integration/overview.tsx";
import { RunPage } from "./legacy/integration/run.tsx";
import { viewRepository } from "./sqlite/repository.ts";

interface GroupPageData {
  readonly overview: ClosedOverview;
  readonly selectedExperiments: readonly string[];
  readonly selectedRunIds: readonly string[];
  readonly selectionTitle: string;
}

interface ExperimentPageData {
  readonly overview: ClosedOverview;
  readonly experimentId: string;
}

interface RunPageData {
  readonly runDocument: InspectionDocument;
  readonly summaryDocument: InspectionDocument;
}

/**
 * Build the old View shell around one sealed overview catalog. Every route
 * requests one of the fixed Inspection operations and closes it into the
 * legacy component's props before React sees the data.
 */
export async function createViewRouter(): Promise<ReturnType<typeof createLegacyViewRouter>> {
  const overview = closeOverview(await viewRepository.inspect({ kind: "overview.get" }));
  const selectedRunIds = Object.freeze([
    ...new Set(new URLSearchParams(window.location.search).getAll("run").filter((runId) => runId.length > 0)),
  ]);
  const manifest = viewManifest(overview.catalog, selectedRunIds);

  const repository: LegacyPageRepository = {
    group: async (selection) => {
      const group = manifest.groups.find(({ identity }) =>
        identity.kind === selection.kind &&
        (identity.kind === "named"
          ? identity.groupId === selection.key
          : identity.experimentId === selection.key));
      return Object.freeze({
        overview,
        selectedExperiments: group?.members ?? Object.freeze([]),
        selectedRunIds,
        selectionTitle: group?.label ?? selection.key,
      } satisfies GroupPageData);
    },
    experiment: async (experimentId) => Object.freeze({
      overview,
      experimentId,
    } satisfies ExperimentPageData),
    run: async (runId) => {
      const [runDocument, summaryDocument] = await Promise.all([
        viewRepository.inspect({ kind: "run.get", runId: runId as never }),
        viewRepository.inspect({ kind: "run.summary", runId: runId as never }),
      ]);
      return Object.freeze({ runDocument, summaryDocument } satisfies RunPageData);
    },
    attempt: async (locator) => {
      const canonicalLocator = locator as never;
      const [attempt, trace, timing, usage, sources, diff] = await Promise.all([
        viewRepository.inspect({ kind: "attempt.get", locator: canonicalLocator }),
        viewRepository.inspect({ kind: "attempt.trace", locator: canonicalLocator }),
        viewRepository.inspect({ kind: "attempt.timing", locator: canonicalLocator }),
        viewRepository.inspect({ kind: "attempt.usage", locator: canonicalLocator }),
        viewRepository.inspect({ kind: "attempt.sources", locator: canonicalLocator }),
        viewRepository.inspect({ kind: "attempt.diff", locator: canonicalLocator }),
      ]);
      const [assertions, traceDetails] = await Promise.all([
        Promise.all(assertionDetailOperations(attempt, locator).map((operation) =>
          viewRepository.inspect(operation))),
        Promise.all(traceDetailOperations(trace, locator).map((operation) =>
          viewRepository.inspect(operation))),
      ]);
      return Object.freeze({
        attempt,
        assertions: Object.freeze(assertions),
        trace,
        traceDetails: Object.freeze(traceDetails),
        timing,
        usage,
        sources,
        diff,
      } satisfies AttemptInspectionBundle);
    },
    reset: () => viewRepository.reset(),
  };

  const renderers: LegacyPageRenderers = {
    group: (data, locale) => {
      const page = data as GroupPageData;
      return (
        <OverviewPage
          overview={page.overview}
          selectedExperiments={page.selectedExperiments}
          selectedRunIds={page.selectedRunIds}
          selectionTitle={page.selectionTitle}
          locale={locale}
        />
      );
    },
    experiment: (data, locale) => {
      const page = data as ExperimentPageData;
      return (
        <ExperimentPage
          overview={page.overview}
          experimentId={page.experimentId}
          locale={locale}
        />
      );
    },
    run: (data, locale) => {
      const page = data as RunPageData;
      return (
        <RunPage
          runDocument={page.runDocument}
          summaryDocument={page.summaryDocument}
          locale={locale}
        />
      );
    },
    attempt: (data, locale) => (
      <AttemptPage bundle={data as AttemptInspectionBundle} locale={locale} />
    ),
  };

  return createLegacyViewRouter(overview.catalog, repository, renderers);
}
