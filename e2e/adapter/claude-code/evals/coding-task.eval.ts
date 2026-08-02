// coding 任务工具轨(适配器契约页 Eval 闭环表第一行):真实任务下 transcript JSONL
// 归一出文件与 shell 工具事件——一次 send 里连续创建、编辑一个文件,再跑 shell 读它,
// 覆盖 Write / Edit / Bash 三种原生工具到 file_write / file_edit / shell 的规范化,
// 三者的 completed 状态本身就是 tool_use.id / tool_result.tool_use_id 配对成立的证据
// (配对失败会体现为 status 卡在别的值或 noFailedActions() 不通过)。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

const MARKER_A = "niceeval-e2e-marker-alpha-926";
const MARKER_B = "niceeval-e2e-marker-beta-926";

export default defineEval({
  description: "coding-task 工具轨:file_write + file_edit + shell 事件,调用与结果通过 completed 状态配对成立",
  async test(t) {
    const turn = await t.send(
      "在当前目录下按顺序完成以下三步:" +
        `(1) 创建一个名为 notes.txt 的文件,内容恰好一行:${MARKER_A}。` +
        `(2) 编辑 notes.txt,追加恰好一行:${MARKER_B}。` +
        "(3) 运行 shell 命令 'cat notes.txt',并把它的输出展示给我。",
    );
    await turn.succeeded().stopOnFailure();
    t.succeeded();

    await t.group("file 与 shell 工具事件均已出现且状态为 completed", () => {
      t.calledTool("file_write", { status: "completed" });
      t.calledTool("file_edit", { status: "completed" });
      t.calledTool("shell", { status: "completed", input: { command: /notes\.txt/ } });
      t.noFailedActions();
    });

    t.sandbox.fileChanged("notes.txt");
    t.check(t.sandbox.file("notes.txt"), includes(MARKER_A));
    t.check(t.sandbox.file("notes.txt"), includes(MARKER_B));
    turn.messageIncludes(MARKER_A);
  },
});
