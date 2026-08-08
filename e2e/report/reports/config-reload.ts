// Project-default report fixture: report.test.ts edits only its marker while a real
// `niceeval view` process is running, so the test exercises config import reload.
import { createElement } from "react";
import { Col, defineReport, Text } from "niceeval/report";

const marker = "CFG_FIRST";

export default defineReport({
  title: { en: "Config reload fixture", "zh-CN": "Config reload fixture" },
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "Report" },
      render: async () => createElement(Col, null, createElement(Text, null, marker)),
    },
  ],
});
