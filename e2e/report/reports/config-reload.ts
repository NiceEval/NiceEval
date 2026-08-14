// Project-default Report fixture for the live rebuild Journey. The test edits
// this entry and its static import while view stays running.
import {
  defineReport,
  Stack,
  Text,
  type PlainPageDefinition,
} from "niceeval/report";
import type { Sample, SampleSnapshot } from "niceeval/analysis";
import { configReloadContent } from "./config-reload-content.ts";

const marker = "REPORT_FIRST";

export default defineReport({
  title: "Config reload fixture",
  pages: [
    {
      id: "report",
      path: "/",
      title: "Config reload fixture",
      load: (sample: Sample): SampleSnapshot => sample.snapshot,
      render: (snapshot: SampleSnapshot) => Stack({
        children: [
          Text({ value: marker }),
          configReloadContent(snapshot.slots.length),
        ],
      }),
    } satisfies PlainPageDefinition<SampleSnapshot>,
  ],
});
