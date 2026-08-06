import { completeEvidenceCoverage, defineDirectAgent } from "niceeval/adapter";

/** fixture agent 的固定回复；fails eval 用「永远等不到的字面量」做确定性失败。 */
export const FIXTURE_REPLY = "fixture agent 的固定回复，不包含任何真实模型内容。";

/** 本地确定性 agent：不连任何 provider，每轮回复同一段文字。新手旅程不需要真实模型。 */
export const fixtureAgent = defineDirectAgent({
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
