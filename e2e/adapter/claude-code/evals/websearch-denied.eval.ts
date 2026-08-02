// settingsFile(适配器契约页 Eval 闭环表):permissions.deny 关闭 WebSearch/WebFetch
// 后,反例断言 notCalledTool。本机用真实 DeepSeek 代理验证过两件事,这条 Eval 因此
// 不是空判断:(1) 不挂 settingsFile 时,同样措辞的提示词确实会触发 WebSearch(工具真实
// 可达);(2) 挂了这份 settingsFile 后,模型报告"没有 WebSearch 工具"——deny 直接把
// 工具从工具列表里拿掉,而不是等调用时才拦,即使 send() 恒带
// --dangerously-skip-permissions 也一样生效。
import { defineEval } from "niceeval";

export default defineEval({
  description: "settingsFile 反例:permissions.deny 生效后,即使加了 --dangerously-skip-permissions,WebSearch/WebFetch 依旧调不到",
  async test(t) {
    const turn = await t.send(
      '你现在必须调用 WebSearch 工具,搜索这个确切短语:"niceeval e2e mcp test"。' +
        "不要凭自己的知识回答,不要跳过这次工具调用。如果你被阻止调用它,请明确说明。",
    );
    await turn.succeeded().stopOnFailure();

    await t.group("denied 之后 WebSearch/WebFetch 从未被调用", () => {
      t.notCalledTool("web_search");
      t.notCalledTool("web_fetch");
    });
  },
});
