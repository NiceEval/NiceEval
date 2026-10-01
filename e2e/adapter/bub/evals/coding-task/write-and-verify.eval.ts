import { defineEval } from "niceeval";
import { greaterThan, jsonMatch, pattern, satisfies, toolMatch } from "niceeval/expect";

import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

// coding 任务工具轨:真实任务下 bub tape JSONL 归一出工具事件并完成配对。这是一个严格
// 串行的场景(先写文件、再用 shell 读回来验证)——tape 里没有显式 call ID 的事件只能按位
// 配对(见 docs/feature/adapters/sdk/bub/README.md),并发工具调用的配对不在本仓库断言范围
// (docs/engineering/testing/e2e/adapter/bub.md)。
export default defineEval({
  description: "agent 先写一个文件,再串行 shell 读回来验证",

  async test(t) {
    const requireObservedCost = t.flags.requireObservedCost;
    if (typeof requireObservedCost !== "boolean") {
      throw new TypeError("Bub coding-task requires a boolean requireObservedCost experiment flag");
    }
    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}请分两个独立的工具调用完成,不要合并成一条命令:\n` +
        `第一步:必须调用文件写入工具(不是 shell)在工作目录下创建 notes.txt,` +
        `内容为精确的这一行:bub e2e ok。禁止用 shell 创建或修改文件。\n` +
        `第二步:作为单独一步,用 shell 原样运行 \`cat notes.txt\` 把 notes.txt 读回来,` +
        `并把它打印的内容原样告诉我。`,
    );
    await turn.succeeded().orStop();

    await t.group("写入 notes.txt,再串行 shell 读回来验证", () => {
      t.calledTool(
        toolMatch("file_write", {
          input: jsonMatch({ path: /notes\.txt/ }),
        }),
      );
      t.calledTool("shell");
      t.check(
        turn.toolCalls,
        satisfies(
          "file_write 先于读回 notes.txt 的 shell",
          (calls) => {
            const write = calls.findIndex((call) =>
              call.name === "file_write" && /\bnotes\.txt\b/.test(JSON.stringify(call.input)),
            );
            // Skill discovery may legitimately run a shell before the task.
            // Order the file write against its readback, not that discovery.
            const shell = calls.findIndex((call) =>
              call.name === "shell" && /\bcat\s+(?:[^\s]*\/)?notes\.txt\b/.test(JSON.stringify(call.input)),
            );
            return write !== -1 && shell !== -1 && write < shell;
          },
        ),
      );
      t.check(
        turn.toolCalls,
        satisfies(
          "no failed actions",
          (calls) => calls.every((call) => call.status !== "failed"),
        ),
      );
    });

    t.check(turn.message, pattern(/bub e2e ok/));
    t.check(turn.usage.totalTokens, greaterThan(0));
    if (requireObservedCost) {
      t.check(
        turn.usage.costs,
        satisfies(
          "complete reported USD cost",
          (costs) => costs.state === "complete" && costs.values.some(
            (cost) => cost.currency === "USD" && cost.source === "reported",
          ),
        ),
      );
      turn.maxCost(0.5);
    }
  },
});
