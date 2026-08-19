import { Col, ExperimentScatter, Text, aggregate, costUSD, defineComponent, defineReport } from "niceeval/report";

const CostState = defineComponent(async (_props: {}, ctx) => {
  const [overall] = await aggregate(ctx.scope, {
    by: {},
    values: { cost: costUSD(ctx.report.pricing!) },
  });
  return (
    <Col>
      <Text>{`cost:${overall.cost.state}:${overall.cost.samples}/${overall.cost.total}`}</Text>
      <ExperimentScatter />
    </Col>
  );
});

export default defineReport({
  title: "Migration cost state",
  pages: [{
    id: "cost-state",
    path: "/cost-state",
    title: "Cost migration state",
    render: () => <CostState />,
  }],
});
