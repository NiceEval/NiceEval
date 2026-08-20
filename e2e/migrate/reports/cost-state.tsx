import { experimentComparisonScope, experimentGroups } from "niceeval/analysis";
import {
  Col,
  ExperimentScatter,
  Text,
  aggregate,
  costUSD,
  defineComponent,
  defineReport,
  type Sample,
} from "niceeval/report";

const CostState = defineComponent(async (props: { readonly comparison: ReturnType<typeof experimentComparisonScope> }, ctx) => {
  const [overall] = await aggregate(ctx.scope, {
    by: {},
    values: { cost: costUSD(ctx.report.pricing!) },
  });
  return (
    <Col>
      <Text>{`cost:${overall.cost.state}:${overall.cost.samples}/${overall.cost.total}`}</Text>
      <ExperimentScatter comparison={props.comparison} />
    </Col>
  );
});

function costState(sample: Sample) {
  const [group] = experimentGroups(sample);
  if (group === undefined) throw new Error("Migration cost state requires one experiment group");
  return <CostState comparison={experimentComparisonScope(sample, group.group)} />;
}

export default defineReport({
  title: "Migration cost state",
  pages: [{
    id: "cost-state",
    path: "/cost-state",
    title: "Cost migration state",
    render: costState,
  }],
});
