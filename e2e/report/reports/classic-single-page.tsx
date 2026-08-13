import {
  Col,
  ExperimentScatter,
  ExperimentTable,
  SampleSummary,
  defineReport,
} from "niceeval/report";

export default defineReport({
  title: "MemoryBench Single Page",
  pages: [{
    id: "overview",
    title: "Overview",
    render: () => (
      <Col>
        <SampleSummary />
        <ExperimentScatter />
        <ExperimentTable />
      </Col>
    ),
  }],
});
