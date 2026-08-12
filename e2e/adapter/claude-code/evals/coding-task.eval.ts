// coding 任务工具轨(适配器契约页 Eval 闭环表第一行):真实任务下 transcript JSONL
// 归一出文件与 shell 工具事件——一次 send 里连续创建、编辑一个文件,再跑 shell 读它,
// 覆盖 Write / Edit / Bash 三种原生工具到 file_write / file_edit / shell 的规范化,
// 三者的 completed 状态本身就是 tool_use.id / tool_result.tool_use_id 配对成立的证据
// (配对失败会体现为 status 卡在别的值,或事件流出现 failed 状态的 operation.finished)。
import { defineEval } from "niceeval";
import { includes, isTrue, satisfies } from "niceeval/expect";

const MARKER_A = "niceeval-e2e-marker-alpha-926";
const MARKER_B = "niceeval-e2e-marker-beta-926";

export default defineEval({
  description:
    "coding-task 工具轨:file_write + file_edit + shell 事件,调用与结果通过 completed 状态配对成立",
  async test(t) {
    const turn = await t.send(
      "在当前目录下按顺序完成以下三步；这是工具协议兼容性检查，必须使用我指定的 Claude Code 原生工具:" +
        `(1) 用 Write 工具创建 notes.txt，内容恰好一行:${MARKER_A}。` +
        `(2) 用 Edit 工具编辑 notes.txt，追加恰好一行:${MARKER_B}。` +
        "前两步禁止用 Bash、Python、sed 或重定向写文件。" +
        "(3) 用 Bash 工具运行命令 'cat notes.txt',并把它的输出展示给我。",
    );
    await turn.succeeded().orStop();
    t.succeeded();

    await t.group("file 与 shell 工具事件均已出现且状态为 completed", () => {
      t.calledTool("file_write", { status: "completed" });
      t.calledTool("file_edit", { status: "completed" });
      t.calledTool("shell", {
        input: { command: /notes\.txt/ },
        status: "completed",
      });
      t.check(
        t.events,
        satisfies<typeof t.events>(
          "no failed tool or subagent actions",
          (events) =>
            !events.some(
              (event) =>
                event.type === "operation.finished" &&
                event.status === "failed",
            ),
        ),
      );
    });

    t.check(await t.sandbox.pathExists("notes.txt"), isTrue()).label("notes.txt 已创建");
    const notes = await t.sandbox.readText("notes.txt");
    t.check(notes, includes(MARKER_A));
    t.check(notes, includes(MARKER_B));
    t.check(turn.message, includes(MARKER_A));
  },
});
