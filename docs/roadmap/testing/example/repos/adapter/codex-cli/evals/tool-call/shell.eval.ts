import { defineEval } from "niceeval";

// 协议行为：coding 任务工具轨——真实任务下 `codex exec --json` 的结构化 stdout 把命令
// 调用归一为规范 `shell` 工具（parsers/codex.ts 的 CODEX_TOOL_ALIASES：command_execution
// → shell），调用与结果按 item id 配对。
const cmdMarker = "niceeval-e2e-echo-914";

export default defineEval({
  description: "coding 任务工具轨：真实命令调用归一为规范 shell，调用与结果配对成立",
  async test(t) {
    const turn = await t.send(
      `在当前工作目录里运行 \`echo ${cmdMarker}\`，把命令的输出告诉我。`,
    );
    await turn.succeeded().stopOnFailure();

    t.noFailedActions();

    await t.group("shell 调用已归一，调用与结果配对", () => {
      t.calledTool("shell", { status: "completed", input: { command: new RegExp(cmdMarker) } });
    });

    turn.messageIncludes(cmdMarker);
  },
});
