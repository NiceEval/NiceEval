// failures —— 内建任务视图:失败处理台。回答「现在有哪些失败要处理、拿什么去修」
// (docs/feature/reports/library/built-in.md「任务视图」)。单导航页 + standardAttemptPage。

import { Col, FailureList, Hero, RunNotices, SampleFixPrompt, SampleNotices, defineReport } from "../index.ts";
import { standardAttemptPage } from "./standard.tsx";

export const failures = defineReport({
  pages: [
    {
      id: "failures",
      title: { en: "Failures", "zh-CN": "失败" },
      content: (
        <Col>
          <Hero />
          <SampleNotices />
          <RunNotices />
          <FailureList limit={50} />
          <SampleFixPrompt />
        </Col>
      ),
    },
    standardAttemptPage,
  ],
});
