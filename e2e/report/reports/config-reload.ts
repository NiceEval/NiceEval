// Project-default Report fixture for the live rebuild Journey. The test edits
// this entry and its static import while view stays running.
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

const marker = "REPORT_FIRST";
const sampleInputs = reportInputs({});

const selectedSlotCount = defineCalculation({
  id: Either.getOrThrow(reportComponentId("selected-slot-count")),
  inputs: sampleInputs,
  calculate: ({ sample }) => sample.slots.length,
});

const page = definePage({
  id: Either.getOrThrow(reportComponentId("report")),
  route: Either.getOrThrow(reportRoute("/")),
  calculations: { selectedSlotCount },
  render: ({ calculations }) => {
    const count = calculations.selectedSlotCount;
    return reportDocument({
      title: "Config reload fixture",
      children: count.state === "available"
        ? [
          reportStatus({ tone: "neutral", label: marker }),
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
  id: Either.getOrThrow(reportId("config-reload")),
  calculations: { selectedSlotCount },
  pages: [page],
});
