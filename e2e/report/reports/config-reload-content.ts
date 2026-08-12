import { reportMetric, reportStatus, type ReportBlock } from "niceeval/report";

const marker = "INDIRECT_FIRST";

/** A static import whose visible semantic blocks prove closure hot reload. */
export function configReloadContent(slotCount: number): readonly ReportBlock[] {
  return [
    reportStatus({ tone: "neutral", label: marker }),
    reportMetric({ label: "Selected slots", value: slotCount, unit: "SLOTS" }),
    reportStatus({ tone: "neutral", label: `SLOTS_${slotCount}` }),
  ];
}
