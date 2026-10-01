import { judgeUsageApplication, judgeUsageEmptyHistory } from "../adapters/judge-usage.ts";

export default judgeUsageApplication.defineEval({
  description: "Complete empty material requires no Judge transmission",
  test(t) {
    t.recordApplicationUsage();
    t.closeQA(judgeUsageEmptyHistory, "Does the answer name the capital of France?").label("Empty answer QA");
  },
});
