import { Col, defineReport, Text } from "niceeval/report";
import { configReloadContent } from "./config-reload-content.tsx";

export default defineReport({
  title: { en: "Alternate config fixture", "zh-CN": "Alternate config fixture" },
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "Report" },
      render: async (sample) => (
        <Col>
          <Text>CONFIG_SECOND</Text>
          {configReloadContent(sample)}
        </Col>
      ),
    },
  ],
});
