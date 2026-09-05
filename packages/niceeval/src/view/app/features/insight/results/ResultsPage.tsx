import type { ReactElement } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ExperimentResults } from "./experiment-table/index.tsx";
import type { Locale } from "../shell/types.ts";
import { overviewData, type ResultsPageModel } from "./model.ts";
import { useCurrentGeneration } from "../data/index.ts";
import { experimentQueryOptions, resultsQueryOptions } from "./load.ts";
import type { InsightRuntimeSnapshot } from "../shell/App.tsx";
import type { InsightTarget } from "../shell/types.ts";

export function ResultsPage({ model, locale }: {
  readonly model: ResultsPageModel;
  readonly locale: Locale;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <header className="niceeval-report niceeval-hero">
        <h1 className="niceeval-hero-title">{t("insight.title")}</h1>
      </header>
      <div className="niceeval-view-report-slot">
        <ExperimentResults
          data={{
            selectionTitle: model.selectionTitle,
            experiments: overviewData(model.overview, model.selectedExperiments),
          }}
          locale={locale}
        />
      </div>
    </>
  );
}

export function ResultsRoute({ target }: {
  readonly target: Extract<InsightTarget, { readonly kind: "group" | "experiment" }>;
}): ReactElement {
  return target.kind === "group"
    ? <GroupResultsRoute groupKind={target.groupKind} groupKey={target.key} />
    : <ExperimentResultsRoute experimentId={target.experimentId} />;
}

function GroupResultsRoute({ groupKind, groupKey }: { readonly groupKind?: string; readonly groupKey?: string }) {
  const generation = useCurrentGeneration();
  const snapshot = generation.snapshot as InsightRuntimeSnapshot;
  const { data: model } = useSuspenseQuery(resultsQueryOptions(generation, snapshot.manifest, snapshot.overview, groupKind, groupKey));
  return <LocalizedResultsPage model={model} />;
}

function ExperimentResultsRoute({ experimentId }: { readonly experimentId: string }) {
  const generation = useCurrentGeneration();
  const snapshot = generation.snapshot as InsightRuntimeSnapshot;
  const { data: model } = useSuspenseQuery(experimentQueryOptions(generation, snapshot.overview, experimentId));
  return <LocalizedResultsPage model={model} />;
}

function LocalizedResultsPage({ model }: { readonly model: ResultsPageModel }) {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? "en") as Locale;
  return <ResultsPage model={model} locale={locale} />;
}
