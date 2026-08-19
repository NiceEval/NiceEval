/**
 * Report's one-way view of Analysis-owned cost projections.
 *
 * Pricing, decimal arithmetic, display rounding, and projection construction
 * all belong to Analysis. This module only reads the already-closed
 * `CostMetricValue.projection` carried by the same metric cell that supplies
 * the ordinary numeric axis value.
 */

import type {
  CostMetricValue,
  CostProjectionValue,
} from "../../analysis/index.ts";
import { isCostProjectionValue } from "../../analysis/cost.ts";
import {
  localeText,
  type LocalizedText,
  type ReportLocale,
} from "./locale.ts";
import { isMetricValue } from "./metrics.ts";

/** Exact no-profile copy for the official total-cost summary. */
export const COST_SUMMARY_NO_PROFILE_TEXT: LocalizedText = Object.freeze({
  en: "Cost unavailable — this report does not declare a PricingProfile.",
  "zh-CN": "成本不可用——此报告未声明 PricingProfile。",
});

/** Exact no-profile copy for the official cost × pass-rate scatter. */
export const COST_SCATTER_NO_PROFILE_TEXT: LocalizedText = Object.freeze({
  en: "Cost × pass rate scatter unavailable — this report does not declare a PricingProfile.",
  "zh-CN": "成本 × 通过率散点图不可用——此报告未声明 PricingProfile。",
});

export interface CostProjectionCellText {
  readonly text: string;
  readonly detail?: string;
}

/** Compact table-cell amount copied from the Analysis-closed projection. */
export function formatCostProjectionAmountText(
  cell: CostMetricValue,
  locale: ReportLocale,
): string {
  switch (cell.projection.state) {
    case "available":
    case "partial":
      return `$${cell.projection.combined.amount}`;
    case "unavailable":
      return localeText(locale, "costProjection.unavailable");
    case "migration-required":
      return localeText(locale, "costProjection.migrationRequired");
    default: {
      const exhaustive: never = cell.projection;
      return exhaustive;
    }
  }
}

/**
 * Produces a compact display from the closed projection. Amount strings pass
 * through verbatim: Report deliberately does not parse, round, or otherwise
 * re-compute Analysis's canonical decimal values.
 */
export function formatCostProjectionCellText(
  cell: CostMetricValue,
  locale: ReportLocale,
): CostProjectionCellText {
  const projection = cell.projection;
  if (projection.state === "migration-required") {
    return Object.freeze({
      text: localeText(locale, "costProjection.migrationRequired"),
      detail: formatCostProjectionCellDetail(cell, locale),
    });
  }
  if (projection.state === "unavailable" || projection.combined === null) {
    return Object.freeze({
      text: localeText(locale, "costProjection.unavailable"),
      detail: formatCostProjectionCellDetail(cell, locale),
    });
  }
  const parts = [
    `${knownValueLabel(projection, locale)} ${moneyText(projection.combined)}`,
    localeText(locale, `costProjection.basis.${projection.basis}`),
  ];
  if (projection.state === "partial") {
    parts.push(localeText(locale, "costProjection.state.partial"));
  }
  return Object.freeze({
    text: parts.join(" · "),
    detail: formatCostProjectionCellDetail(cell, locale),
  });
}

/**
 * Preserves the closed ledger summary in text form. This is presentation only:
 * all values are copied directly from `cell.projection`.
 */
export function formatCostProjectionCellDetail(
  cell: CostMetricValue,
  locale: ReportLocale,
): string {
  const projection = cell.projection;
  const lines: string[] = [];
  lines.push(localeText(locale, "costProjection.profile", {
    identity: projection.profile.contentIdentity,
    currency: projection.profile.currency,
    decimals: projection.profile.display.decimalPlaces,
  }));
  lines.push(localeText(locale, "costProjection.provenance", {
    source: projection.profile.provenance.source,
    asOf: projection.profile.provenance.asOf,
  }));
  if (projection.observed !== null) {
    lines.push(`${localeText(locale, "costProjection.providerObserved").padEnd(20)} ${moneyText(projection.observed)}`);
  }
  if (projection.estimated !== null) {
    lines.push(`${localeText(locale, "costProjection.profileEstimated").padEnd(20)} ${moneyText(projection.estimated)}`);
  }
  if (projection.combined !== null) {
    lines.push(
      `${knownValueLabel(projection, locale).padEnd(28)} ${moneyText(projection.combined)} · ` +
      localeText(locale, "costProjection.coverage", { samples: cell.samples, total: cell.total }),
    );
  }
  for (const entry of projection.observedOtherCurrencies) {
    lines.push(
      `${localeText(locale, "costProjection.observedElsewhere").padEnd(20)} ${entry.currency} ${entry.amount} · ` +
      localeText(locale, "costProjection.notConverted"),
    );
  }
  for (const reason of projection.reasons) {
    lines.push(localeText(locale, "costProjection.reason", {
      provider: reason.provider ?? "",
      code: reason.code,
    }));
  }
  return lines.join("\n");
}

/**
 * Runtime narrowing for an Analysis-issued cost cell. Analysis owns the deep
 * projection guard; Report verifies only the normal MetricValue shell and its
 * required cost presentation fields.
 */
export function isCostMetricValue(value: unknown): value is CostMetricValue {
  if (!isMetricValue(value) || !Object.hasOwn(value, "projection")) return false;
  if (value.format !== "currency-usd" || value.better !== "lower") return false;
  const projection = (value as { readonly projection?: unknown }).projection;
  // The Host's machine boundary additionally matches this identity against
  // the captured cost measure entry before a projection leaves the Report.
  return isCostProjectionValue(projection) && projection.state === value.state;
}

function moneyText(value: { readonly currency: string; readonly amount: string }): string {
  return `${value.currency} ${value.amount}`;
}

function knownValueLabel(projection: CostProjectionValue, locale: ReportLocale): string {
  switch (projection.aggregate.kind) {
    case "mean":
      return localeText(locale, "costProjection.meanPerContributingSlot");
    case "total":
      return localeText(locale, "costProjection.totalKnownCost");
    default:
      return localeText(locale, "costProjection.knownValue");
  }
}
