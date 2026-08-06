import { defineReport, ExperimentTable, ParamPage } from "niceeval/report";

export default defineReport(({ record }) => ({
  title: "Report target fixture",
  body: [
    <ExperimentTable key="experiments" record={record} />,
    <ParamPage
      key="checkout-regression"
      pageId="case"
      itemKey="checkout-regression"
      title="Checkout regression"
    >
      <p>Custom parameterized target content</p>
    </ParamPage>,
  ],
}));
