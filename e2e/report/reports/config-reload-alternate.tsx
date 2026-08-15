import { Col, Text, defineReport, type Sample } from "niceeval/report";
import { configReloadContent } from "./config-reload-content.tsx";

export default defineReport({
  title: "Alternate config fixture",
  pages: [
    {
      id: "alternate-report",
      path: "/",
      title: "Alternate config fixture",
      render: (sample: Sample) => (
        <Col>
          <Text>{"CONFIG_SECOND"}</Text>
          {configReloadContent(sample.snapshot.slots.length)}
        </Col>
      ),
    },
  ],
});
