// stability —— 内建任务视图:稳定性。

import { Col, Hero, RunNotices, SampleNotices, StabilityOverview, defineReport } from "../index.ts";
import { standardAttemptPage } from "./standard.tsx";
import type { Sample } from "../../record/types.ts";

async function stabilityRender(sample: Sample) {
  void sample;
  return (
    <Col>
      <Hero />
      <SampleNotices />
      <RunNotices />
      <StabilityOverview />
    </Col>
  );
}

export const stability = defineReport({
  pages: [
    {
      id: "stability",
      title: { en: "Stability", "zh-CN": "稳定性" },
      render: stabilityRender,
    },
    standardAttemptPage,
  ],
});
