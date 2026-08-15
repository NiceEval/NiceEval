import { Col, Text, defineReport, type Sample } from "niceeval/report";
import { configReloadContent } from "./config-reload-content.tsx";

const marker = "REPORT_FIRST";

export default defineReport({
  title: "Config reload fixture",
  pages: [
    {
      id: "report",
      path: "/",
      title: "Config reload fixture",
      render: (sample: Sample) => (
        <Col>
          <Text>{marker}</Text>
          {configReloadContent(sample.snapshot.slots.length)}
        </Col>
      ),
    },
  ],
});
