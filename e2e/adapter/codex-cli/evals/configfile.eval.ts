// 协议行为:configFile——同一个 Eval 分别由 baseline 与 configfile Experiment 运行。
// 两边使用完全相同的 prompt；只有 configFile 中的 shell_tool feature 与用于选择断言分支的
// shellTool flag 不同，因此 enabled 正调会调用 shell，disabled 反例会正常完成且不调用。
import { defineEval } from "niceeval";
import { toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "configFile 正反对照:相同 prompt 在 baseline 调用 shell，在 disabled 配置下不调用",
  async test(t) {
    const turn = await t.send(
      'If exec_command is available, call it exactly once with `printf niceeval-configfile-shell-731`, ' +
        "then report its output. If exec_command is unavailable, do not try substitutes or retry; " +
        "say it is unavailable immediately.",
    );
    await turn.succeeded().orStop();

    if (t.flags.shellTool === true) {
      t.check(t.toolCalls, toolMatch("shell", { status: "completed" }).exactly(1));
      return;
    }
    if (t.flags.shellTool === false) {
      t.notCalledTool("shell");
      return;
    }
    throw new Error("configfile Eval requires boolean flags.shellTool");
  },
});
