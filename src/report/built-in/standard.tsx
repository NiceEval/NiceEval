// standard —— 内建视图:公开 to* + 原语/组合件；每页 page.render。

import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import type { Sample } from "../../record/types.ts";
import {
  AttemptDetails,
  Callouts,
  Col,
  CopyBlock,
  Hero,
  SampleOverview,
  Waterfall,
  defineReport,
} from "../index.ts";
import {
  toRunNotices,
  toSampleFixPrompt,
  toSampleNotices,
  toTraceNodes,
} from "../model/conversions.ts";

export async function standardOverviewRender(sample: Sample) {
  const [notices, diagnostics, fixPrompt] = await Promise.all([
    toSampleNotices(sample),
    toRunNotices(sample),
    toSampleFixPrompt(sample),
  ]);
  return (
    <Col>
      <Hero />
      <Callouts items={notices} />
      <Callouts items={diagnostics} />
      {fixPrompt !== null ? <CopyBlock content={fixPrompt} /> : null}
      <SampleOverview />
    </Col>
  );
}

export async function standardAttemptsRender(sample: Sample) {
  const [notices, diagnostics] = await Promise.all([toSampleNotices(sample), toRunNotices(sample)]);
  return (
    <Col>
      <Hero />
      <Callouts items={notices} />
      <Callouts items={diagnostics} />
      <SampleOverview />
    </Col>
  );
}

export async function standardTracesRender(sample: Sample) {
  const [notices, diagnostics, nodes] = await Promise.all([
    toSampleNotices(sample),
    toRunNotices(sample),
    toTraceNodes(sample),
  ]);
  return (
    <Col>
      <Hero />
      <Callouts items={notices} />
      <Callouts items={diagnostics} />
      <Waterfall nodes={nodes} />
    </Col>
  );
}

export async function standardAttemptRender(attempt: AttemptEvidence) {
  return <AttemptDetails attempt={attempt} />;
}

export const standardOverviewPage = {
  id: "report",
  title: { en: "Report", "zh-CN": "报告" },
  render: standardOverviewRender,
};

export const standardAttemptsPage = {
  id: "attempts",
  title: "Attempts",
  render: standardAttemptsRender,
};

export const standardTracesPage = {
  id: "traces",
  title: { en: "Traces", "zh-CN": "追踪" },
  render: standardTracesRender,
};

export const standardAttemptPage = {
  id: "attempt",
  title: "Attempt",
  input: "attempt" as const,
  navigation: false as const,
  render: standardAttemptRender,
};

export const standard = defineReport({
  pages: [standardOverviewPage, standardAttemptsPage, standardTracesPage, standardAttemptPage],
});
