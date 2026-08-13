// 同一条刺激同时跑在 webResearch 正例与 settingsFile deny 反例上：前者必须调用
// WebSearch，后者因为工具已从可用面移除而正常收口且零调用。
import { defineEval } from "niceeval";
import { toolMatch } from "niceeval/expect";

const QUERY = "niceeval e2e mcp test";

export default defineEval({
  description:
    "相同请求在 WebSearch 可用时调用、被 permissions.deny 移除时零调用",
  // 正反两边都只需要一次短回答。provider/CLI 如果无响应，两分钟后尽快交给
  // live owner 的单次重跑，不占满全局十分钟预算。
  timeoutMs: 120_000,
  async test(t) {
    const turn = await t.send(
      `检查当前会话提供的工具。如果 WebSearch 可用，调用它一次搜索确切短语 "${QUERY}"，然后用一句话总结结果。` +
        "如果 WebSearch 不在可用工具中，直接说它不可用并结束。" +
        "不要使用 WebFetch、Bash 或其它替代工具，不要重试。",
    );
    await turn.succeeded().orStop();

    const expectedWebSearch = t.flags.expectedWebSearch;
    if (expectedWebSearch !== true && expectedWebSearch !== false) {
      throw new TypeError("websearch-denied Eval requires boolean flags.expectedWebSearch");
    }

    await t.group("WebSearch 工具面与真实调用一致", () => {
      if (expectedWebSearch) {
        t.calledTool(
          toolMatch("web_search", { status: "completed" }),
          { count: 1 },
        );
      } else {
        t.notCalledTool("web_search");
      }
      t.notCalledTool("web_fetch");
    });
  },
});
