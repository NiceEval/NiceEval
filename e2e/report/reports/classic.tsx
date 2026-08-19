import {
  Bars,
  Col,
  ExperimentScatter,
  ExperimentTable,
  Hero,
  SampleNotices,
  SampleSummary,
  Section,
  aggregate,
  costUSD,
  defineComponent,
  defineReport,
  experiment,
  passRate,
} from "niceeval/report";
import {
  standardAttemptPage,
  standardExperimentPage,
} from "niceeval/report/built-in";

const logo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f6feb"/><text x="32" y="40" text-anchor="middle" font-size="22" fill="white" font-family="sans-serif">MB</text></svg>',
)}`;

const MemoryBenchHero = defineComponent(() => (
  <Hero
    title="MemoryBench Classic"
    logo={{ src: logo, alt: "MemoryBench Classic" }}
    description="Deterministic 0.12 classic report: Hero, SampleSummary, leaderboard Bars, ExperimentScatter, and ExperimentTable."
    links={[{ label: "NiceEval", href: "https://github.com/NiceEval/NiceEval" }]}
  />
));

const Leaderboard = defineComponent(async (_props, ctx) => {
  const pricing = ctx.report.pricing;
  const leaderboard = await aggregate(ctx.scope, {
    by: { experiment },
    values: pricing === null
      ? { passRate }
      : { passRate, costUSD: costUSD(pricing) },
  });
  const ranked = [...leaderboard].toSorted(
    (a, b) => (b.passRate.value ?? Number.NEGATIVE_INFINITY) - (a.passRate.value ?? Number.NEGATIVE_INFINITY),
  );

  return (
    <Bars
      points={ranked}
      x="experiment"
      y="passRate"
      sort={{ field: "passRate", direction: "desc" }}
      layout="horizontal"
    />
  );
});

function classicOverview() {
  return (
    <Col>
      <MemoryBenchHero />
      <SampleNotices />
      <SampleSummary />
      <Section title={{ en: "Leaderboard", "zh-CN": "排行榜" }}>
        <Leaderboard />
      </Section>
      <Section title={{ en: "Experiment comparison", "zh-CN": "实验对比" }}>
        <ExperimentScatter />
      </Section>
      <Section title={{ en: "Experiments", "zh-CN": "实验" }}>
        <ExperimentTable />
      </Section>
    </Col>
  );
}

export default defineReport({
  title: { en: "MemoryBench Classic", "zh-CN": "MemoryBench Classic" },
  head: [
    {
      tag: "meta",
      attrs: {
        name: "description",
        content: "Deterministic installed-candidate Report author fixture.",
      },
    },
    ...(process.env.NICEEVAL_E2E_AUTHOR_HEAD === "1"
      ? [{
          tag: "script" as const,
          attrs: {
            src: "https://example.test/report-author-fixture.js",
            crossorigin: "anonymous",
          },
        }]
      : []),
  ],
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      render: classicOverview,
    },
    standardAttemptPage,
    standardExperimentPage,
  ],
});
