// failures —— 内建任务视图:失败处理台。

import { defineReport } from "../definition/report.ts";
import { Col } from "../definition/primitives.tsx";
import { FailureList } from "../components/entity-lists/index.tsx";
import { Hero, RunNotices, SampleFixPrompt, SampleNotices } from "../components/site-components/index.tsx";
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
