import { Table, defineReport } from "niceeval/report";

const impossibleMigrationMetric = {
  value: null,
  state: "migration-required",
  samples: 0,
  total: 0,
  basis: "slot",
  issues: [],
  refs: [],
};

export default defineReport({
  title: "Invalid migration metric",
  pages: [{
    id: "invalid-migration-metric",
    path: "/invalid-migration-metric",
    title: "Invalid migration metric",
    render: () => <Table rows={[{ key: "zero", metric: impossibleMigrationMetric }]} columns={["metric"]} />,
  }],
});
