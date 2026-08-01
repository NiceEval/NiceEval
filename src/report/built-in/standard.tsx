// standard —— 内建视图:公开 to* + 原语/组合件；每页 page.render。

import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import type { Sample } from "../../record/types.ts";
import type { ParameterizedPageDefinition } from "../definition/report.ts";
import {
  AttemptDetails,
  Callouts,
  Col,
  CopyBlock,
  ExperimentDetails,
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

export async function standardExperimentRender(sample: Sample) {
  return <ExperimentDetails input={sample} />;
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

/**
 * attempt 详情:标准库导出的参数化页(docs/feature/reports/library.md「参数化页:attempt
 * 与 experiment 详情」)。`params.encode` 是恒等函数——locator 本身就是 URL-safe 的不透明
 * 字符串,不需要额外编码;`load` 经 `ctx.evidence()` 装载证据,不重新实现任何一条聚合规则。
 */
export const standardAttemptPage: ParameterizedPageDefinition<{ locator: AttemptLocator }, AttemptEvidence> = {
  id: "attempt",
  title: "Attempt",
  navigation: false,
  params: {
    encode: ({ locator }) => locator,
    decode: (key) => ({ locator: key as AttemptLocator }),
    enumerate: (base) =>
      base.attempts.flatMap((attempt) => (attempt.locator === undefined ? [] : [{ locator: attempt.locator }])),
  },
  load: (_base, { locator }, ctx) => ctx.evidence(locator),
  render: standardAttemptRender,
};

/**
 * experiment 详情:标准库导出的参数化页(docs/feature/reports/library.md「参数化页:attempt
 * 与 experiment 详情」)。`params.encode` 同样是恒等函数——experiment id 本身就是
 * URL-safe 的不透明字符串;`enumerate` 直接读 `base.runs` / `base.coverage` 的 experiment id
 * 并集(与 `experimentListData` 归组的口径一致),不经 `toExperimentRows`——`PageParams.enumerate`
 * 是同步契约,`toExperimentRows` 为了算出完整读数字段是异步的,枚举参数不需要这些读数。
 * `load` 只是 Sample 的既有收窄,不重新实现任何一条聚合规则。
 */
export const standardExperimentPage: ParameterizedPageDefinition<{ experiment: string }, Sample> = {
  id: "experiment",
  title: "Experiment",
  navigation: false,
  params: {
    encode: ({ experiment }) => experiment,
    decode: (key) => ({ experiment: key }),
    enumerate: (base) => {
      const ids = new Set<string>();
      for (const run of base.runs) ids.add(run.experimentId);
      for (const entry of base.coverage) ids.add(entry.experimentId);
      return [...ids].map((experiment) => ({ experiment }));
    },
  },
  load: (base, { experiment }) => base.scope({ experiments: [experiment] }),
  render: standardExperimentRender,
};

export const standard = defineReport({
  pages: [
    standardOverviewPage,
    standardAttemptsPage,
    standardTracesPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});
