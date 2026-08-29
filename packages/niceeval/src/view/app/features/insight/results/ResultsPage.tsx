import type { ReactElement } from "react";
import { useLoaderData } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExperimentResults } from "./experiment-table/index.tsx";
import type { Locale } from "../shell/types.ts";
import { overviewData, type ResultsPageModel } from "./model.ts";

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
  const model = useLoaderData() as ResultsPageModel;
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? "en") as Locale;
  return <ResultsPage model={model} locale={locale} />;
}
