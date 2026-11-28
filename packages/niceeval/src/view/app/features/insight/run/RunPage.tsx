import type { ReactElement } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { Cell, TableContent } from "../components/cell.tsx";
import { canonicalAttemptHref, TableContentView } from "../components/TableContentView.tsx";
import type { Locale } from "../shell/types.ts";
import { AttemptDialog } from "../attempt/AttemptDialog.tsx";
import type { RunPageModel } from "./model.ts";
import { useCurrentGeneration } from "../data/index.ts";
import { runQueryOptions } from "./load.ts";
import { localizedMessage } from "../components/locale.ts";
import { experimentDisplayLabel } from "../../../../../experiment/presentation.ts";

const runPhaseMessages = {
  "run.before": "run.phase.before",
  "run.discovery": "run.phase.discovery",
  "run.plan": "run.phase.plan",
  "run.dispatch": "run.phase.dispatch",
  "run.after": "run.phase.after",
} as const;

export function RunPage({ model, locale }: { readonly model: RunPageModel; readonly locale: Locale }): ReactElement {
  const { t } = useTranslation();
  const experimentTitle = experimentDisplayLabel(model);
  const rows = model.members.map((member) => {
    const cells: Record<string, Cell> = {
      experiment: { kind: "text", text: experimentTitle, detail: undefined },
      adapter:
        model.adapter === undefined
          ? { kind: "notApplicable" }
          : {
              kind: "text",
              text: model.adapter?.name ?? "—",
              detail: `${model.adapter.contract} · ${model.adapter.behaviorRevision ?? "—"}`,
            },
      eval: { kind: "text", text: member.evalId, detail: undefined },
      attempt: { kind: "text", text: String(member.attemptOrdinal + 1), detail: undefined },
      membership: { kind: "text", text: member.state, detail: undefined },
      outcome: textOrMissing(member.outcome),
      verdict:
        member.verdict === undefined
          ? { kind: "notApplicable" }
          : {
              kind: "verdict",
              mode: "single",
              verdict: member.verdict,
              label:
                member.verdict === "passed" && member.score?.state === "available"
                  ? localizedMessage("verdict.scored")
                  : undefined,
              bare: false,
            },
      locator:
        member.locator === undefined
          ? { kind: "notApplicable" }
          : {
              kind: "locator",
              locator: member.locator,
              verdict: member.verdict ?? undefined,
            },
      selectedRun: { kind: "text", text: model.runId, detail: undefined },
      slot: { kind: "text", text: member.plannedAttemptId, detail: undefined },
    };
    return {
      key: member.key,
      cells,
      subRows: [],
      variant: "normal" as const,
    };
  });
  const table: TableContent = {
    columns: [
      { key: "experiment", header: { en: "Experiment", "zh-CN": "实验" } },
      { key: "adapter", header: { en: "Adapter", "zh-CN": "应用" } },
      { key: "eval", header: { en: "Eval", "zh-CN": "评估" } },
      { key: "attempt", header: { en: "Attempt", "zh-CN": "尝试" } },
      { key: "membership", header: { en: "Membership", "zh-CN": "成员关系" } },
      { key: "outcome", header: { en: "Outcome", "zh-CN": "执行结果" } },
      { key: "verdict", header: { en: "Verdict", "zh-CN": "判定" } },
      { key: "locator", header: { en: "Attempt locator", "zh-CN": "Attempt 定位符" } },
      { key: "selectedRun", header: { en: "Selected run", "zh-CN": "所选 Run" } },
      { key: "slot", header: { en: "Planned attempt", "zh-CN": "计划 Attempt" } },
    ].map((column) => ({ ...column, better: undefined })),
    rows,
  };
  return (
    <section className="niceeval-report niceeval-section">
      <h2 className="niceeval-section-title">
        {locale === "zh-CN" ? "Run 成员" : "Run membership"} · {experimentTitle} · {model.runId}
      </h2>
      {model.diagnostics.length === 0 ? null : (
        <section aria-label={t("run.errors")}>
          <h3>{t("run.errors")}</h3>
          {model.diagnostics.map((diagnostic) => {
            const affected = new Set(diagnostic.affectedPlannedAttemptIds);
            const evals = [
              ...new Set(
                model.members.filter((member) => affected.has(member.plannedAttemptId)).map((member) => member.evalId),
              ),
            ];
            return (
              <article key={diagnostic.diagnosticId}>
                <p>{t(runPhaseMessages[diagnostic.phase])}</p>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{diagnostic.summary}</pre>
                {affected.size === 0 ? null : <p>{t("run.affectedAttempts", { count: affected.size })}</p>}
                <ul>
                  {evals.map((evalId) => (
                    <li key={evalId}>{evalId}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      )}
      <TableContentView
        data={table}
        searchable
        locale={locale}
        hrefForLocator={canonicalAttemptHref}
        sort={undefined}
        className=""
      />
    </section>
  );
}

export function RunRoute(
  props: {
    readonly runId: string;
  } & ({ readonly presentation: "page" } | { readonly presentation: "dialog"; readonly onClose: () => void }),
): ReactElement {
  const generation = useCurrentGeneration();
  const { data: model } = useSuspenseQuery(runQueryOptions(generation, props.runId));
  const { i18n } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
  const page = <RunPage model={model} locale={locale} />;
  if (props.presentation === "page") return page;
  return (
    <AttemptDialog title={locale === "zh-CN" ? "运行" : "Run"} onClose={props.onClose}>
      {page}
    </AttemptDialog>
  );
}

function textOrMissing(value: unknown): Cell {
  return typeof value === "string" && value.length > 0
    ? { kind: "text", text: value, detail: undefined }
    : { kind: "notApplicable" };
}
