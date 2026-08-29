import type { ReactElement } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExperimentResults } from "./experiment-table/index.tsx";
import type { Locale } from "../shell/types.ts";
import { overviewData, type ResultsPageModel } from "./model.ts";
import { useCurrentGeneration } from "../data/index.ts";
import { experimentQueryOptions, resultsQueryOptions } from "./load.ts";
import type { InsightRuntimeSnapshot } from "../shell/App.tsx";

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
      <ExperimentResults
        data={{
          selectionTitle: model.selectionTitle,
          experiments: overviewData(model.overview, model.selectedExperiments),
        }}
        locale={locale}
      />
    </>
  );
}

export function ResultsRoute(): ReactElement {
  const params = useParams();
  return params.experimentId === undefined
    ? <GroupResultsRoute groupKind={params.groupKind} groupKey={params.key} />
    : <ExperimentResultsRoute experimentId={params.experimentId} />;
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
