import { defineEval } from "niceeval";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

// coding 任务工具轨:真实任务下 bub tape JSONL 归一出工具事件并完成配对。这是一个严格
// 串行的场景(先写文件、再用 shell 读回来验证)——tape 里没有显式 call ID 的事件只能按位
// 配对(见 docs/feature/adapters/sdk/bub/README.md),并发工具调用的配对不在本仓库断言范围
// (docs/engineering/testing/e2e/adapter/bub.md)。
export default defineEval({
  description: "agent 先写一个文件,再串行 shell 读回来验证",

  async test(t) {
    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}请分两个独立的工具调用完成,不要合并成一条命令:\n` +
        `第一步:用你的文件写入工具在工作目录下创建 notes.txt,内容为精确的这一行:bub e2e ok\n` +
        `第二步:作为单独一步,用 shell 命令(例如 \`cat notes.txt\`)把 notes.txt 读回来,` +
        `并把它打印的内容原样告诉我。`,
    );
    await turn.succeeded().stopOnFailure();

    await t.group("写入 notes.txt,再串行 shell 读回来验证", () => {
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
