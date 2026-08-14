/** @jsxImportSource niceeval/report */

// The custom Report used by show, view, and static export. Its root and detail
// pages preserve the low-level author seam while Author API exercises the
// public classic facade, package JSX runtime, and capability-free Sample type.
import { Either } from "effect";
import type { Sample } from "niceeval/record";
import {
  Bars,
  Col,
  ExperimentScatter,
  ExperimentTable,
  Hero,
  SampleNotices,
  SampleSummary,
  Section,
  aggregate,
  defineComponent,
  definePage,
  definePageFamily,
  defineReport,
  passRate,
  reportComponentId,
  reportDocument,
  reportInstanceKeyFromRecordId,
  reportLink,
  reportList,
  reportMetric,
  reportParagraph,
  reportRoute,
  reportRouteFromKeys,
  reportStatus,
  reportText,
  type AggregationSubject,
  type GroupFunction,
  type SlotId,
} from "niceeval/report";
import { siteCopyBlock } from "./site-copy-block.ts";

const overview = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: Either.getOrThrow(reportRoute("/")),
  render: ({ sample }) => reportDocument({
    title: "Report fixture",
    children: [
      reportMetric({ label: "Selected runs", value: sample.runs.length }),
      reportMetric({ label: "Selected slots", value: sample.slots.length }),
      reportMetric({ label: "Slot denominator", value: sample.denominator }),
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
  }),
});

const fixtureGroup: GroupFunction = (subject: AggregationSubject) => subject.experimentId;

const FixtureLeaderboard = defineComponent(async (_props, ctx) => {
  const points = await aggregate(ctx.scope, {
    by: { experiment: fixtureGroup },
    values: { passRate },
  });
  return (
    <Bars
      points={points}
      x="experiment"
      y="passRate"
      layout="horizontal"
    />
  );
});
FixtureLeaderboard.displayName = "FixtureLeaderboard";

const authorApi = {
  id: "author-api",
  title: "Author API",
  render(sample: Sample) {
    return (
      <Col>
        <Hero
          title="Classic author surface"
          description="Rendered through niceeval/report JSX with a niceeval/record Sample."
        />
        <Section title="Selection notice">
          <SampleNotices input={sample} />
        </Section>
        <SampleSummary input={sample} />
        <FixtureLeaderboard />
        <ExperimentScatter input={sample} />
        <ExperimentTable input={sample} />
      </Col>
    );
  },
} as const;

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
  title: "Report fixture",
  pages: [overview, authorApi, slots],
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
