import { completeEvidenceCoverage, defineDirectAgent } from "niceeval/adapter";

/** fixture agent 的固定回复；eval 用它的字面量做确定性断言。 */
export const FIXTURE_REPLY = "fixture agent 的固定回复，不包含任何真实模型内容。";

/** 慢速 fixture 一轮 send 的睡眠时长：留给测试 SIGINT 的飞行窗口。 */
export const SLOW_TURN_MS = 60_000;

const FIXTURE_COVERAGE = {
  ...completeEvidenceCoverage,
  usage: { status: "unavailable", reason: "本地 fixture 不产生 token 用量" },
};

/** 本地确定性 agent：不连任何 provider，每轮回复同一段文字。 */
export const fixtureAgent = defineDirectAgent({
  name: "fixture",
  evidenceCoverage: FIXTURE_COVERAGE,
  async send() {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: FIXTURE_REPLY }],
    };
  },
});

/** 慢速 fixture：一轮 send 睡满 SLOW_TURN_MS 才回复，中断信号到来立即失败收尾。
 *  睡眠模拟真实模型的长时间回复，让 SIGINT 落在 attempt 飞行途中；unref 保证它
 *  不拖着进程不退出。 */
export const slowFixtureAgent = defineDirectAgent({
  name: "fixture-slow",
  evidenceCoverage: FIXTURE_COVERAGE,
  async send(_input, ctx) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SLOW_TURN_MS);
      timer.unref();
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    if (ctx.signal.aborted) {
      return { status: "failed", events: [] };
    }
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: FIXTURE_REPLY }],
    };
  },
});
