// standard —— 内建视图:Hero + 原语/组合件 + SampleOverview。

import {
  AttemptDetail,
  Callouts,
  Col,
  CopyBlock,
  Hero,
  SampleOverview,
  Waterfall,
  defineReport,
} from "../index.ts";
import { sources } from "../sources.ts";

export const standardAttemptPage = {
  id: "attempt",
  title: "Attempt",
  input: "attempt",
  navigation: false,
  content: <AttemptDetail />,
} as const;

export const standard = defineReport({
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "报告" },
      content: (
        <Col>
          <Hero />
          <Callouts source={sources.sample.notices} />
          <Callouts source={sources.run.diagnostics} />
          <CopyBlock source={sources.sample.fixPrompt} />
          <SampleOverview />
        </Col>
      ),
    },
    {
      id: "attempts",
      title: "Attempts",
      content: (
        <Col>
          <Hero />
          <Callouts source={sources.sample.notices} />
          <Callouts source={sources.run.diagnostics} />
          <SampleOverview />
        </Col>
      ),
    },
    {
      id: "traces",
      title: { en: "Traces", "zh-CN": "追踪" },
      content: (
        <Col>
          <Hero />
          <Callouts source={sources.sample.notices} />
          <Callouts source={sources.run.diagnostics} />
          <Waterfall source={sources.sample.traces} />
        </Col>
      ),
    },
    standardAttemptPage,
  ],
});
