import { registerExecution } from "../support/contracts";

registerExecution({
  behaviorId: "reports.target-closure",
  cadence: "pull-request",
  resourceClass: "ordinary",
  timeoutMs: 120_000,
  releaseRisk:
    "新增参数化页只产链接不产文档时，用户会在发布站得到 404 或打不开的 dialog",
});
