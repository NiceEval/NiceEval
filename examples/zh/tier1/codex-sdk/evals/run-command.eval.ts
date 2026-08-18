import { defineEval } from "niceeval";
import { toolMatch } from "niceeval/expect";

// 这条 eval 验证 agent 会真的跑 shell 命令(而不是凭空回答)。工具事件由官方转换器
// `createCodexThreadEventStream` 从 ThreadEvent 的 `command_execution` item 映射(started 发
// called,completed 按 exit_code 落 result)。
export default defineEval({
  description: "测试 agent 能在工作目录里跑一个真实 shell 命令",

  async test(t) {
    const turn = await t.send("在当前工作目录跑 `echo niceeval-run-command-926`,把命令的输出告诉我。");
    await turn.succeeded().orStop();

    await t.group("调用了 shell 且没有失败的动作", () => {
      t.calledTool(toolMatch("command_execution", { status: "completed" }));
      t.noFailedActions();
    });

    t.messageIncludes("niceeval-run-command-926");
  },
});
