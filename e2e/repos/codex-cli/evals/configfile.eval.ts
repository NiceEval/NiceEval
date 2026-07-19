// 协议行为:configFile——原生 Codex config.toml(`web_search = "disabled"`)生效后,
// 反例断言 `notCalledTool` 的 `web_search`(见 docs/engineering/e2e-ci/adapters/codex-cli.md)。
//
// 提示词选一个正常情况下大概率会触发内置联网检索的问题(近期时事),证明的是"配置真的关闭
// 了这个工具",而不是"模型这轮恰好没想用"。
import { defineEval } from "niceeval";

export default defineEval({
  description: "configFile 反例:web_search = \"disabled\" 生效后,同样的提示词也调不到 web_search",
  async test(t) {
    const turn = await t.send(
      "Search the web for the most recent news headline about OpenAI, then summarize it in one sentence. " +
        "If you cannot search the web, say so explicitly instead of guessing.",
    );
    turn.expectOk();
    t.notCalledTool("web_search");
  },
});
