import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionSuccessDocumentFor } from "../../../../../inspection/public.ts";
import { CopyButton } from "../components/CopyButton.tsx";
import { Grid } from "../components/primitives/index.tsx";
import { formatMetricScalar, metricStateText } from "../components/format.ts";
import type { Locale } from "../shell/types.ts";
import { currentExperimentRows } from "./model.ts";

type Project = InspectionSuccessDocumentFor<"project.get">["project"];
type ProjectSlot = Project["plannedAttempts"][number];
type Metric = Project["totals"]["verdict"]["passRate"];

function metricText(value: Metric, locale: Locale, partial: string): string {
  const number =
    value.value === null
      ? metricStateText(value.state, locale)
      : formatMetricScalar(value.value, value.unit, undefined, locale);
  return value.state === "partial" ? `${number} (${partial})` : number;
}

function attemptHref(locator: string): string {
  return `#/attempt/${encodeURIComponent(locator.startsWith("@") ? locator.slice(1) : locator)}`;
}

export function CurrentResults({
  project,
  history,
  locale,
}: {
  readonly project: Project;
  readonly history: Project["history"];
  readonly locale: Locale;
}): ReactElement {
  const { t } = useTranslation();
  const verdicts = project.totals.verdict.tally;
  const experiments = currentExperimentRows(project);
  const quality = project.totals.evaluationKind === "pass" ? project.totals.verdict.passRate : project.totals.score;
  return (
    <>
      <header className="niceeval-report niceeval-hero">
        <h1 className="niceeval-hero-title">{t("insight.title")}</h1>
        <p>{t("current.title")}</p>
      </header>
      <section className="niceeval-report niceeval-section" aria-label={t("current.summary")}>
        <h2 className="niceeval-section-title">{t("current.summary")}</h2>
        <Grid>
          <div className="niceeval-kpi">
            <span className="niceeval-kpi-label">{t("current.covered")}</span>
            <span className="niceeval-kpi-value">
              {project.coverage.covered}/{project.coverage.expected}
            </span>
          </div>
          <div className="niceeval-kpi">
            <span className="niceeval-kpi-label">{t("current.gaps")}</span>
            <span className="niceeval-kpi-value">{project.coverage.gaps}</span>
          </div>
          <div className="niceeval-kpi">
            <span className="niceeval-kpi-label">{t("current.verdicts")}</span>
            <span className="niceeval-kpi-value">
              {verdicts.passed} {t("verdict.passed")}; {verdicts.failed} {t("verdict.failed")}; {verdicts.errored}{" "}
              {t("verdict.errored")}; {verdicts.skipped} {t("verdict.skipped")}
            </span>
          </div>
          <div className="niceeval-kpi">
            <span className="niceeval-kpi-label">
              {t(project.totals.evaluationKind === "pass" ? "experimentList.passRate" : "experimentList.totalScore")}
            </span>
            <span className="niceeval-kpi-value">{metricText(quality, locale, t("current.partial"))}</span>
          </div>
        </Grid>
      </section>
      <section className="niceeval-report niceeval-section" aria-label={t("nav.experiments")}>
        <h2 className="niceeval-section-title">{t("nav.experiments")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t("experimentList.experiment")}</th>
              <th>{t("current.covered")}</th>
              <th>{t("current.gaps")}</th>
              <th>
                {t(project.totals.evaluationKind === "pass" ? "experimentList.passRate" : "experimentList.totalScore")}
              </th>
            </tr>
          </thead>
          <tbody>
            {experiments.map(({ experiment, slots, covered, gaps }) => {
              const value = experiment.evaluationKind === "pass" ? experiment.verdict.passRate : experiment.score;
              return (
                <tr key={experiment.experimentId}>
                  <th scope="row">
                    <a href={`#/experiment/${encodeURIComponent(experiment.experimentId)}`}>
                      {experiment.experimentId}
                    </a>
                  </th>
                  <td>
                    {covered}/{slots.length}
                  </td>
                  <td>{gaps}</td>
                  <td>{metricText(value, locale, t("current.partial"))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {experiments.map(({ experiment, slots, covered, gaps }) => (
          <section key={experiment.experimentId} aria-label={experiment.experimentId}>
            <details>
              <summary>
                <strong>{experiment.experimentId}</strong> · {t("current.covered")} {covered}/{slots.length} ·{" "}
                {t("current.gaps")} {gaps}
              </summary>
              <table>
                <thead>
                  <tr>
                    <th>{t("current.eval")}</th>
                    <th>{t("current.attempt")}</th>
                    <th>{t("experimentList.result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot: ProjectSlot) => (
                    <tr key={`${slot.evalId}:${slot.attemptOrdinal}`}>
                      <th scope="row">{slot.evalId}</th>
                      <td>{slot.attemptOrdinal}</td>
                      <td>
                        {slot.state === "reuse" ? (
                          <>
                            <span>{t("current.covered")}</span> <a href={attemptHref(slot.locator)}>{slot.locator}</a>
                          </>
                        ) : (
                          <>
                            <span>{t("current.gapReason", { reason: t(`current.reason.${slot.reason}`) })}</span>
                            {slot.previous === null ? null : (
                              <>
                                {" "}
                                · <a href={attemptHref(slot.previous.locator)}>{t("current.previousResult")}</a>
                              </>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {slots.some((slot) => slot.state === "gap") ? (
              <p>
                {t("current.next")}{" "}
                <CopyButton text={`niceeval exp ${experiment.experimentId} --dry`}>
                  <code>niceeval exp {experiment.experimentId} --dry</code>
                </CopyButton>
              </p>
            ) : null}
          </section>
        ))}
      </section>
      {history.length === 0 ? null : (
        <section className="niceeval-report niceeval-section" aria-label={t("current.history")}>
          <h2 className="niceeval-section-title">{t("current.history")}</h2>
          <ul>
            {history.map((slot) => (
              <li key={`${slot.experimentId}:${slot.evalId}:${slot.attemptOrdinal}`}>
                {slot.experimentId} · {slot.evalId} · {t("current.attempt")} {slot.attemptOrdinal} ·{" "}
                {slot.locator === null ? (
                  <a href={`#/run/${encodeURIComponent(slot.sourceRunId)}`}>{slot.sourceRunId}</a>
                ) : (
                  <a href={attemptHref(slot.locator)}>{slot.locator}</a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
