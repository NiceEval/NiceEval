// stability —— 内建任务视图:稳定性。

import { Col, Hero, RunNotices, SampleNotices, defineReport } from "../index.ts";
import { standardAttemptPage } from "./standard.tsx";
import type { Sample } from "../../record/types.ts";
import { stabilityResult } from "../tasks.ts";
import { StabilityResultView } from "./result-components.tsx";

async function stabilityRender(sample: Sample) {
  const result = await stabilityResult(sample, { by: "experiment" });
  return (
    <Col>
      <Hero />
      <SampleNotices />
      <RunNotices />
      <StabilityResultView result={result} />
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
