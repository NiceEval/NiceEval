// failures —— 内建任务视图:失败处理台。

import { Col, FailureList, Hero, RunNotices, SampleFixPrompt, SampleNotices, defineReport } from "../index.ts";
import { standardAttemptPage } from "./standard.tsx";
import type { Sample } from "../../record/types.ts";

async function failuresRender(sample: Sample) {
  void sample;
  return (
    <Col>
      <Hero />
      <SampleNotices />
      <RunNotices />
      <FailureList limit={50} />
      <SampleFixPrompt />
    </Col>
  );
}

export const failures = defineReport({
  pages: [
    {
      id: "failures",
      title: { en: "Failures", "zh-CN": "失败" },
      render: failuresRender,
    },
    standardAttemptPage,
  ],
});
