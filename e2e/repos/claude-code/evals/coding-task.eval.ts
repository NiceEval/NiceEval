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
  description: "coding-task tool trail: file_write + file_edit + shell events, call/result paired via completed status",
  async test(t) {
    const turn = await t.send(
      "In the current directory, do these three steps in order: " +
        `(1) create a file named notes.txt containing exactly one line: ${MARKER_A}. ` +
        `(2) Edit notes.txt to append a second line containing exactly: ${MARKER_B}. ` +
        "(3) Run the shell command 'cat notes.txt' and show me its output.",
    );
    turn.expectOk();
    t.succeeded();

    await t.group("file and shell tool events are present and completed", () => {
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
