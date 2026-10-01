import { judgeUsageApplication, judgeUsageHistory } from "../adapters/judge-usage.ts";

export default judgeUsageApplication.defineEval({
  description: "Judge checks the application answer through a real local HTTP provider",
  test(t) {
    t.recordApplicationUsage();
    t.closeQA(judgeUsageHistory, "Does the answer name the capital of France?")
      .gate(1).label("Answer QA");
  },
});
