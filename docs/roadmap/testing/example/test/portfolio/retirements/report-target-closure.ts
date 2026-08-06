import { retireProofs } from "../../../e2e/report/support/contracts";

export default retireProofs({
  migrationId: "report-target-closure-v1",
  removed: [
    {
      proof: "e2e.report.attempt-link-smoke",
      reason: "只点 attempt 的旧 smoke 被通用 target Behavior 吸收",
      absorbedBy: "reports.target-closure",
    },
    {
      proof: "src.view.param-page.snapshot",
      reason: "大 snapshot 没有独有错误算法，且对 class 与文案过拟合",
    },
  ],
});
