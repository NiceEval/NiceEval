// stability —— 内建任务视图:稳定性。回答「哪些题历史上从没稳过、失败是题难还是环境事故」
// (docs/feature/reports/library/built-in.md「任务视图」)。单导航页 + standardAttemptPage。

import { Col, Hero, RunNotices, SampleNotices, StabilityOverview, defineReport } from "../index.ts";
import { standardAttemptPage } from "./standard.tsx";

export const stability = defineReport({
  pages: [
    {
      id: "stability",
      title: { en: "Stability", "zh-CN": "稳定性" },
      content: (
        <Col>
          <Hero />
          <SampleNotices />
          <RunNotices />
          <StabilityOverview />
        </Col>
      ),
    },
    standardAttemptPage,
  ],
});
