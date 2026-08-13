// 协议行为:configFile——同一个 Eval 分别由 baseline 与 configfile Experiment 运行。
// 两边使用完全相同的 prompt；只有 configFile 与显式 webSearch flag 不同，因此正调会调用
// web_search，disabled 反例会正常完成且不产生该工具调用。
import { defineEval } from "niceeval";
import { toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    'configFile 正反对照:相同 prompt 在 baseline 调用 web_search，在 disabled 配置下不调用',
  async test(t) {
    const turn = await t.send(
      "You must use the web_search tool to find the most recent news headline about OpenAI, " +
        "then summarize it in one sentence. If web_search is unavailable, say so immediately " +
        "instead of guessing or retrying.",
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
