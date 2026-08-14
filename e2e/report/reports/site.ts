// The custom Report used by show, view, and static export. It exercises the
// public author DSL directly: plain Pages, neutral components, and one
// parameterized Page whose instances are the actual slots in this Sample.
import {
  defineReport,
  Stack,
  Table,
  Text,
  type PageParams,
  type ParameterizedPageDefinition,
  type PlainPageDefinition,
} from "niceeval/report";
import type { Sample, SampleSnapshot } from "niceeval/analysis";
import { siteCopyBlock } from "./site-copy-block.ts";

type SlotParams = Readonly<Record<string, string>> & {
  readonly slotId: string;
};

/** One codec owns both direct detail routes and static Page enumeration. */
const slotParams = {
  encode: (params: SlotParams): string => params.slotId,
  decode: (key: string): SlotParams => Object.freeze({ slotId: key }),
  enumerate: (sample: Sample): readonly SlotParams[] =>
    Object.freeze(sample.snapshot.slots.map((slot) => Object.freeze({
      slotId: slot.slotId,
    }))),
} satisfies PageParams<SlotParams>;

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
          Table({
            caption: "Selected slots",
            columns: [
              { key: "slot", label: "Slot" },
              { key: "state", label: "State" },
              { key: "detailRoute", label: "Detail route" },
            ],
            rows: snapshot.slots.map((slot) => ({
              slot: `Slot ${slot.slotId}`,
              state: slot.state,
              detailRoute: `/slots/${slotParams.encode({ slotId: slot.slotId })}`,
            })),
          }),
        ],
      }),
    } satisfies PlainPageDefinition<SampleSnapshot>,
    {
      id: "slots",
      path: "/slots",
      title: "Report fixture slot",
      navigation: false,
      params: slotParams,
      load: (sample, params) => {
        const slot = sample.snapshot.slots.find((candidate) => candidate.slotId === params.slotId);
        if (slot === undefined) throw new Error("the requested Slot is not in this Sample");
        return slot;
      },
      render: (slot) => Stack({
        children: [
          Text({ value: `Slot ${slot.slotId}: ${slot.state}` }),
          Table({
            caption: "Slot detail",
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
    } satisfies ParameterizedPageDefinition<
      SlotParams,
      SampleSnapshot["slots"][number]
    >,
  ],
});
