// The custom Report used by show, view, and static export. It intentionally
// exercises only the public author DSL: a Calculation, a fixed Page, and a
// PageFamily over the already-selected Sample.
import { Either } from "effect";
import {
  defineCalculation,
  definePage,
  definePageFamily,
  defineReport,
  reportComponentId,
  reportDocument,
  reportInputs,
  reportId,
  reportInstanceKeyFromRecordId,
  reportLink,
  reportList,
  reportMetric,
  reportParagraph,
  reportRoute,
  reportRouteFromKeys,
  reportStatus,
  reportText,
  type SlotId,
} from "niceeval/report";
import { siteCopyBlock } from "./site-copy-block.ts";

const sampleInputs = reportInputs({});

const sampleSummary = defineCalculation({
  id: Either.getOrThrow(reportComponentId("sample-summary")),
  inputs: sampleInputs,
  calculate: ({ sample }) => Object.freeze({
    runCount: sample.runs.length,
    slotCount: sample.slots.length,
    denominator: sample.denominator,
  }),
});

const overview = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: Either.getOrThrow(reportRoute("/")),
  calculations: { sampleSummary },
  render: ({ sample, calculations }) => {
    const summary = calculations.sampleSummary;
    if (summary.state !== "available") {
      return reportDocument({
        title: "Report fixture",
        children: [reportStatus({
          tone: "negative",
          label: "Sample summary is unavailable",
        })],
      });
    }

    return reportDocument({
      title: "Report fixture",
      children: [
        reportMetric({ label: "Selected runs", value: summary.value.runCount }),
        reportMetric({ label: "Selected slots", value: summary.value.slotCount }),
        reportMetric({ label: "Slot denominator", value: summary.value.denominator }),
        siteCopyBlock(),
        reportList({
          ordered: false,
          items: sample.slots.map((slot) => [reportParagraph([
            reportLink({
              label: [reportText(`Slot ${slot.slotId}`)],
              target: { kind: "route", route: slotRoute(slot.slotId) },
            }),
          ])]),
        }),
      ],
    });
  },
});

const slots = definePageFamily({
  id: Either.getOrThrow(reportComponentId("slots")),
  instances: ({ sample }) => sample.slots,
  key: (slot) => slotKey(slot.slotId),
  route: (slot) => slotRoute(slot.slotId),
  render: ({ instance }) => reportDocument({
    title: "Report fixture slot",
    children: [reportStatus({
      tone: toneForSlot(instance.state),
      label: `Slot ${instance.slotId}: ${instance.state}`,
    })],
  }),
});

export default defineReport({
  id: Either.getOrThrow(reportId("report-fixture")),
  calculations: { sampleSummary },
  pages: [overview, slots],
});

function slotKey(slotId: SlotId) {
  return reportInstanceKeyFromRecordId({ kind: "slot", value: slotId });
}

function slotRoute(slotId: SlotId) {
  return Either.getOrThrow(reportRouteFromKeys([slotKey(slotId)]));
}

function toneForSlot(state: "included" | "not-recorded" | "core-invalid" | "excluded") {
  switch (state) {
    case "included":
      return "positive" as const;
    case "not-recorded":
      return "warning" as const;
    case "core-invalid":
      return "negative" as const;
    case "excluded":
      return "neutral" as const;
  }
}
