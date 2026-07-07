import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// Codex 是"目录里的编码 agent",这条 eval 测它最本分的事:在工作目录里写一个真实文件。
// 断言不只信模型的自我报告——先删掉目标文件(workspace/ 不会在 attempt 之间自动清空,见
// origin src/backend/agent.ts 头注释),跑完直接用 node:fs 读磁盘上的真实内容,双重核实
// (工具调用记录 + 文件确实存在且内容对)。
const WORKSPACE_FILE = join(process.cwd(), "workspace", "niceeval-create-file.txt");
const MARKER = "niceeval-marker-926";

export default defineEval({
  description: "测试 agent 能在工作目录里创建一个内容正确的真实文件",

  async test(t) {
    rmSync(WORKSPACE_FILE, { force: true });

    const turn = await t.send(
      `在当前工作目录创建一个文件 niceeval-create-file.txt,内容只写一行:${MARKER}`,
    );
    turn.expectOk();

    await t.group("正常收发、没有失败的动作", () => {
      t.succeeded();
      t.noFailedActions();
    });

    // 文件不存在按空内容断言,而不是让 readFileSync 抛 ENOENT——"agent 没写出文件"是
    // 这条 eval 真正要测的失败(failed),不是框架执行错误(errored)。
    const content = existsSync(WORKSPACE_FILE) ? readFileSync(WORKSPACE_FILE, "utf8") : "";
    t.check(content, includes(MARKER));
  },
});
