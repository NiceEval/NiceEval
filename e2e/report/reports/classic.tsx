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
  standardAttemptsPage,
  standardExperimentPage,
  standardTracesPage,
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
  const leaderboard = await aggregate(ctx.scope, {
    by: { experiment },
    values: { passRate, costUSD },
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
      <ExperimentScatter />
      <ExperimentTable />
    </Col>
  );
}

export default defineReport({
  title: { en: "MemoryBench Classic", "zh-CN": "MemoryBench Classic" },
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      render: classicOverview,
    },
    standardAttemptsPage,
    standardTracesPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});
