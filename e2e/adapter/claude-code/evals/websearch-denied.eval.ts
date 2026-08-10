// settingsFile 的 permissions.deny 会把 WebSearch/WebFetch 从工具列表移除。
// 提示词强制尝试调用，事件流的负断言证明 deny 真正生效。
import { defineEval } from "niceeval";

export default defineEval({
  description: "settingsFile 反例:permissions.deny 后 WebSearch/WebFetch 仍不可调用",
  async test(t) {
    const turn = await t.send(
      '你现在必须调用 WebSearch 工具，搜索这个确切短语:"niceeval e2e mcp test"。' +
        "不要凭自己的知识回答，不要跳过这次工具调用。如果被阻止，请明确说明。",
    );
    await turn.succeeded().stopOnFailure();

    await t.group("denied 之后 WebSearch/WebFetch 从未被调用", () => {
      t.notCalledTool("web_search");
      t.notCalledTool("web_fetch");
    });
  },
});
