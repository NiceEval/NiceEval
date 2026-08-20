import { Table, aggregate, costUSD, defineComponent, defineReport } from "niceeval/report";

const InvalidMigrationMetric = defineComponent(async (_props: {}, ctx) => {
  const [row] = await aggregate(ctx.scope, {
    by: {},
    values: { cost: costUSD(ctx.report.pricing!) },
  });
  const valid = row!.cost;
  const incompleteLedgerMetric = Object.freeze({ ...valid, total: valid.total + 1 });
  return <Table rows={[{ key: "missing-ledger-slot", metric: incompleteLedgerMetric }]} columns={["metric"]} />;
});

export default defineReport({
  title: "Invalid migration metric",
  pages: [{
    id: "invalid-migration-metric",
    path: "/invalid-migration-metric",
    title: "Invalid migration metric",
    render: () => <InvalidMigrationMetric />,
  }],
});
