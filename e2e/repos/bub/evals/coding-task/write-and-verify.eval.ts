import { defineEval } from "niceeval";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

// coding 任务工具轨:真实任务下 bub tape JSONL 归一出工具事件并完成配对。这是一个严格
// 串行的场景(先写文件、再用 shell 读回来验证)——tape 里没有显式 call ID 的事件只能按位
// 配对(见 docs/feature/adapters/sdk/bub/README.md),并发工具调用的配对不在本仓库断言范围
// (docs/engineering/e2e-ci/adapters/bub.md)。
export default defineEval({
  description: "agent writes a file, then serially shells out to read it back",

  async test(t) {
    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}Do this as two separate, distinct tool calls — do not combine them ` +
        `into one command:\n` +
        `Step 1: use your file-write tool to create notes.txt in the workspace containing exactly this line: bub e2e ok\n` +
        `Step 2: as a separate step, use a shell command (for example \`cat notes.txt\`) to read notes.txt back, ` +
        `and tell me exactly what it printed.`,
    );
    turn.expectOk();

    await t.group("writes notes.txt, then serially shells out to read it back", () => {
      t.calledTool("file_write", { input: { path: /notes\.txt/ } });
      t.calledTool("shell");
      t.toolOrder(["file_write", "shell"]);
      t.noFailedActions();
    });

    t.messageIncludes(/bub e2e ok/);
    turn.maxTokens(50_000);
    turn.maxCost(0.5);
  },
});
