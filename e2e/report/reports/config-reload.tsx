// Project-default report fixture for the live rebuild Journey. The test edits this entry,
// its imported content, the configured theme and the config itself while `view` stays running.
import { Col, defineReport, Text } from "niceeval/report";
import { configReloadContent } from "./config-reload-content.tsx";

const marker = "REPORT_FIRST";

export default defineReport({
  title: { en: "Config reload fixture", "zh-CN": "Config reload fixture" },
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "Report" },
      render: async (sample) => (
        <Col>
          <Text>{marker}</Text>
          {configReloadContent(sample)}
        </Col>
      ),
    },
  ],
});
