import {
  Bars,
  Col,
  ExperimentScatter,
  ExperimentTable,
  Hero,
  SampleSummary,
  aggregate,
  defineComponent,
  defineReport,
  passRate,
} from "niceeval/report";
import type {
  AggregationSubject,
  GroupFunction,
} from "niceeval/report";

const condition: GroupFunction = (subject) =>
  String(subject.run.experiment?.labels?.line ?? subject.experimentId);

const memory: GroupFunction = (subject: AggregationSubject) =>
  String(subject.run.experiment?.flags?.memory ?? "unknown");

const FixtureHero = defineComponent(() => (
  <Hero
    description="Classic Report acceptance fixture"
    links={[{
      label: "Read the Report contract",
      href: "https://github.com/CorrectRoadH/niceeval",
    }]}
  />
));

FixtureHero.displayName = "FixtureHero";

const Leaderboard = defineComponent(async (_props, ctx) => {
  const rows = await aggregate(ctx.scope, {
    by: { condition, memory },
    values: { passRate },
  });

  return (
    <Bars
      points={rows}
      x="condition"
      y="passRate"
      color="memory"
      point="condition"
      sort={{ field: "passRate", direction: "desc" }}
      layout="horizontal"
    />
  );
});

Leaderboard.displayName = "Leaderboard";

export default defineReport({
  title: "Classic Report fixture",
  pages: [{
    id: "report",
    title: "Report",
    render: () => (
      <Col>
        <FixtureHero />
        <SampleSummary />
        <Leaderboard />
        <ExperimentScatter />
        <ExperimentTable />
      </Col>
    ),
  }],
});
