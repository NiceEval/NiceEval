// 协议行为:configFile——同一个 Eval 分别由 baseline 与 configfile Experiment 运行。
// 两边使用完全相同的 prompt；只有 configFile 中的 web_search mode 与用于选择断言分支的
// webSearch flag 不同，因此 live 正调会调用 web_search，disabled 反例会正常完成且不调用。
import { defineEval } from "niceeval";
import { toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    'configFile 正反对照:相同 prompt 在 baseline 调用 web_search，在 disabled 配置下不调用',
  async test(t) {
    const turn = await t.send(
      "If web_search is available, call it exactly once to find the most recent news headline " +
        "about OpenAI, then summarize it in one sentence. If web_search is unavailable, do not " +
        "try substitutes or retry; say it is unavailable immediately.",
    );
    await turn.succeeded().orStop();

    if (t.flags.webSearch === true) {
      t.calledTool(toolMatch("web_search", { status: "completed" }));
      return;
    }
    if (t.flags.webSearch === false) {
      t.notCalledTool("web_search");
      return;
    }
    throw new Error("configfile Eval requires boolean flags.webSearch");
  },
});
