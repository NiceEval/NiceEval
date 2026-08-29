import type { ReactElement } from "react";
import { useLoaderData, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import type { Cell, TableContent } from "../components/cell.tsx";
import { TableContentView } from "../components/TableContentView.tsx";
import type { Locale } from "../shell/types.ts";
import { AttemptDialog } from "../attempt/AttemptDialog.tsx";
import type { RunPageModel } from "./model.ts";

export function RunPage({ model, locale }: {
  readonly model: RunPageModel;
  readonly locale: Locale;
}): ReactElement {
  const rows = model.members.map((member) => {
    const cells: Record<string, Cell> = {
      experiment: { kind: "text", text: model.experimentId },
      eval: { kind: "text", text: member.evalId },
      attempt: { kind: "text", text: String(member.attemptOrdinal + 1) },
      membership: { kind: "text", text: member.state },
      outcome: textOrMissing(member.outcome),
      verdict: member.verdict === null
        ? { kind: "notApplicable" }
        : { kind: "verdict", verdict: member.verdict },
      locator: member.locator === null
        ? { kind: "notApplicable" }
        : { kind: "locator", locator: member.locator, ...(member.verdict === null ? {} : { verdict: member.verdict }) },
      selectedRun: { kind: "text", text: model.runId },
      slot: { kind: "text", text: member.slotId },
    };
    return Object.freeze({
      key: member.key,
      cells: Object.freeze(cells),
    });
  });
  const table: TableContent = Object.freeze({
    columns: Object.freeze([
      { key: "experiment", header: { en: "Experiment", "zh-CN": "实验" } },
      { key: "eval", header: { en: "Eval", "zh-CN": "评估" } },
      { key: "attempt", header: { en: "Attempt", "zh-CN": "尝试" } },
      { key: "membership", header: { en: "Membership", "zh-CN": "成员关系" } },
      { key: "outcome", header: { en: "Outcome", "zh-CN": "执行结果" } },
      { key: "verdict", header: { en: "Verdict", "zh-CN": "判定" } },
      { key: "locator", header: { en: "Attempt locator", "zh-CN": "Attempt 定位符" } },
      { key: "selectedRun", header: { en: "Selected run", "zh-CN": "所选 Run" } },
      { key: "slot", header: { en: "Slot", "zh-CN": "槽位" } },
    ]),
    rows: Object.freeze(rows),
  });
  return (
    <section className="niceeval-report niceeval-section">
      <h2 className="niceeval-section-title">
        {locale === "zh-CN" ? `Run 成员 · ${model.runId}` : `Run membership · ${model.runId}`}
      </h2>
      <TableContentView data={table} searchable locale={locale} />
    </section>
  );
}

export function RunRoute(): ReactElement {
  const model = useLoaderData() as RunPageModel;
  const { i18n } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
  const location = useLocation();
  const page = <RunPage model={model} locale={locale} />;
  return (location.state as { background?: Location } | null)?.background === undefined
    ? page
    : <AttemptDialog title={locale === "zh-CN" ? "运行" : "Run"}>{page}</AttemptDialog>;
}

function textOrMissing(value: unknown): Cell {
  return typeof value === "string" && value.length > 0
    ? { kind: "text", text: value }
    : { kind: "notApplicable" };
}
