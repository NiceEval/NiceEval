// The custom Report used by show, view, and static export. It exercises the
// public author DSL directly: one ordinary page, three parameterized detail
// families, closed links, and a closed Download payload.
import { createElement } from "react";
import {
  Bars,
  Download,
  Stack,
  Table,
  Text,
  Tabs,
  defineComponent,
  defineReport,
  type PageParams,
  type ParameterizedPageDefinition,
  type PlainPageDefinition,
  type Sample,
} from "niceeval/report";
import { siteCopyBlock } from "./site-copy-block.ts";

type SampleSnapshot = Sample["snapshot"];
type Slot = SampleSnapshot["slots"][number];
type DetailKind = "source" | "trace" | "diff";
type SlotParams = Readonly<Record<string, string>> & {
  readonly slotId: string;
};

const DETAIL_KINDS: readonly DetailKind[] = ["source", "trace", "diff"];
const fixtureBytes = new TextEncoder().encode("id,status\nfixture,ready\n");
const fixtureChartPoints = [
  { model: "North", score: 72 },
  { model: "South", score: 91 },
] as const;

/** One codec owns direct detail routes and every static Page enumeration. */
const slotParams = {
  encode: (params: SlotParams): string => params.slotId,
  decode: (key: string): SlotParams => Object.freeze({ slotId: key }),
  enumerate: (sample: Sample): readonly SlotParams[] =>
    Object.freeze(sample.snapshot.slots.map((slot) => Object.freeze({
      slotId: slot.slotId,
    }))),
} satisfies PageParams<SlotParams>;

/** A standard React anchor is closed into a Report link before any renderer sees it. */
const DetailLink = defineComponent(({ href, label }: {
  readonly href: string;
  readonly label: string;
}) => createElement("a", { href }, label));

export default defineReport({
  title: "Report fixture",
  pages: [
    {
      id: "overview",
      path: "/",
      title: "Report fixture",
      load: (sample: Sample): SampleSnapshot => sample.snapshot,
      render: (snapshot: SampleSnapshot) => Stack({
        children: [
          Text({ value: "Report fixture static site" }),
          Bars({
            title: "Fixture model scores",
            points: fixtureChartPoints,
            x: "model",
            y: "score",
          }),
          Tabs({
            tabs: [
              {
                title: "Fixture overview",
                children: Text({ value: "Fixture overview tab content" }),
              },
              {
                title: "Fixture details",
                children: Text({ value: "Fixture details tab content" }),
              },
            ],
          }),
          Table({
            caption: "Sample coverage",
            columns: [
              { key: "metric", label: "Metric" },
              { key: "value", label: "Value", align: "end" },
            ],
            rows: [
              { metric: "Selected runs", value: snapshot.runs.length },
              { metric: "Selected slots", value: snapshot.slots.length },
              { metric: "Slot denominator", value: snapshot.coverage.frameTotal },
            ],
          }),
          siteCopyBlock(),
          Download({
            file: {
              path: "fixture.csv",
              mediaType: "text/csv; charset=utf-8",
              bytes: fixtureBytes,
            },
            children: Text({ value: "Fixture data download" }),
          }),
          ...DETAIL_KINDS.flatMap((kind) => snapshot.slots.map((slot) => DetailLink({
            href: detailRoute(kind, slot.slotId),
            label: `${detailLabel(kind)} detail ${slot.slotId}`,
          }))),
        ],
      }),
    } satisfies PlainPageDefinition<SampleSnapshot>,
    ...DETAIL_KINDS.map(detailPage),
  ],
});

function detailPage(kind: DetailKind): ParameterizedPageDefinition<SlotParams, Slot> {
  const label = detailLabel(kind);
  return {
    id: kind,
    path: `/${kind}`,
    title: `${label} fixture`,
    navigation: false,
    params: slotParams,
    load: (sample, params) => {
      const slot = sample.snapshot.slots.find((candidate) => candidate.slotId === params.slotId);
      if (slot === undefined) throw new Error(`the requested ${label} Slot is not in this Sample`);
      return slot;
    },
    render: (slot) => Stack({
      children: [
        Text({ value: `${label} fixture detail ${slot.slotId}` }),
        Table({
          caption: `${label} detail`,
          columns: [
            { key: "slotId", label: "Slot" },
            { key: "runId", label: "Run" },
            { key: "state", label: "State" },
          ],
          rows: [{
            slotId: slot.slotId,
            runId: slot.runId,
            state: slot.state,
          }],
        }),
      ],
    }),
  } satisfies ParameterizedPageDefinition<SlotParams, Slot>;
}

function detailLabel(kind: DetailKind): "Source" | "Trace" | "Diff" {
  switch (kind) {
    case "source": return "Source";
    case "trace": return "Trace";
    case "diff": return "Diff";
  }
}

function detailRoute(kind: DetailKind, slotId: string): string {
  return `/${kind}/${slotId}`;
}
