import {
  defineReport,
  Stack,
  Text,
  type PlainPageDefinition,
} from "niceeval/report";
import type { Sample, SampleSnapshot } from "niceeval/analysis";
import { configReloadContent } from "./config-reload-content.ts";

export default defineReport({
  title: "Alternate config fixture",
  pages: [
    {
      id: "alternate-report",
      path: "/",
      title: "Alternate config fixture",
      load: (sample: Sample): SampleSnapshot => sample.snapshot,
      render: (snapshot: SampleSnapshot) => Stack({
        children: [
          Text({ value: "CONFIG_SECOND" }),
          configReloadContent(snapshot.slots.length),
        ],
      }),
    } satisfies PlainPageDefinition<SampleSnapshot>,
  ],
});
