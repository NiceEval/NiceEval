import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

/** fixture agent 的固定回复；eval 用它的字面量做确定性断言。 */
export const FIXTURE_REPLY = "fixture agent 的固定回复，不包含任何真实模型内容。";

/** 本地确定性 agent：不连任何 provider，每轮回复同一段文字。携带语义测试不需要真实模型。 */
export const fixtureAgent = defineAgent({
  name: "fixture",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "本地 fixture 不产生 token 用量" },
  },
  async send() {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: FIXTURE_REPLY }],
    };
  },
});
