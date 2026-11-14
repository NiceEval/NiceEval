import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionSuccessDocumentFor } from "@niceeval/inspection/public.ts";

export function CostGaps({
  costs,
}: {
  readonly costs: InspectionSuccessDocumentFor<"attempt.usage">["usage"]["totalCosts"];
}): ReactElement | null {
  const { t } = useTranslation();
  if (costs.gaps.length === 0) return null;
  const sourceLabel = (source: "application" | "judge" | "simulated-user") =>
    t(
      source === "application"
        ? "usage.applicationCost"
        : source === "judge"
          ? "usage.judgeUsage"
          : "usage.simulatedUserCost",
    );
  const models = [...new Set(costs.gaps.flatMap((gap) => gap.models))].sort();
  return (
    <div>
      <p>
        {t("usage.missingSources")}: {costs.missingSources.map(sourceLabel).join(", ")}
      </p>
      <ul>
        {costs.gaps.map((gap) => (
          <li key={`${gap.source}:${gap.reason}`}>
            {sourceLabel(gap.source)}: {t(`usage.gap.${gap.reason}`)}
            {gap.models.length === 0 ? "" : ` (${gap.models.join(", ")})`}
          </li>
        ))}
      </ul>
      {models.length === 0 ? null : (
        <p>
          {t("usage.addPrices", { models: models.join(", ") })}{" "}
          <a href="https://niceeval.dev/reference/define-config#pricing">{t("usage.prices")}</a>
        </p>
      )}
    </div>
  );
}
