import { Either } from "effect";
import {
  defineCalculation,
  definePage,
  defineReport,
  reportComponentId,
  reportDocument,
  reportId,
  reportInputs,
  reportRoute,
  reportStatus,
} from "niceeval/report";
import { configReloadContent } from "./config-reload-content.ts";

const sampleInputs = reportInputs({});

const selectedSlotCount = defineCalculation({
  id: Either.getOrThrow(reportComponentId("alternate-slot-count")),
  inputs: sampleInputs,
  calculate: ({ sample }) => sample.slots.length,
});

const page = definePage({
  id: Either.getOrThrow(reportComponentId("alternate-report")),
  route: Either.getOrThrow(reportRoute("/")),
  calculations: { selectedSlotCount },
  render: ({ calculations }) => {
    const count = calculations.selectedSlotCount;
    return reportDocument({
      title: "Alternate config fixture",
      children: count.state === "available"
        ? [
          reportStatus({ tone: "neutral", label: "CONFIG_SECOND" }),
          ...configReloadContent(count.value),
        ]
        : [reportStatus({
          tone: "negative",
          label: "Selected slot count is unavailable",
        })],
    });
  },
});

export default defineReport({
  id: Either.getOrThrow(reportId("config-reload-alternate")),
  calculations: { selectedSlotCount },
  pages: [page],
});
