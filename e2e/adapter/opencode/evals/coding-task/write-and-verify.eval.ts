import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";

const TOOL_PAYLOAD = "niceeval-opencode-tool-input-907";

export default defineEval({
  description: "coding 任务工具轨:写文件 + shell 读回,归一进标准事件流",
  async test(t) {
    const turn = await t.send(
      "请分两个独立的工具调用完成,不要合并成一条命令:\n" +
        `第一步:用文件写入工具在工作目录创建 notes.txt,内容精确为这一行:${TOOL_PAYLOAD}\n` +
        `第二步:用 shell 命令验证 notes.txt 中精确包含 ${TOOL_PAYLOAD} (例如 grep -Fx),` +
        "再把这个值原样告诉我。",
    );
    await turn.succeeded().orStop();
    await t.group("写入 notes.txt,再串行 shell 读回来", () => {
      // marker 同时必须在两个工具输入中出现，能杀死「只留工具名/路径、丢掉实际参数」的归一。
      t.calledTool("file_write", {
        input: (input) =>
          typeof input === "string"
            ? new RegExp(TOOL_PAYLOAD).test(input)
            : new RegExp(TOOL_PAYLOAD).test(JSON.stringify(input) ?? ""),
      });
      t.calledTool("shell", {
        input: (input) =>
          typeof input === "string"
            ? new RegExp(TOOL_PAYLOAD).test(input)
            : new RegExp(TOOL_PAYLOAD).test(JSON.stringify(input) ?? ""),
      });
      // 两个工具调用必须按 file_write → shell 的顺序出现,shell 读回才证明文件已写好。
      t.check(
        turn.events,
        satisfies<typeof turn.events>("file_write 调用先于 shell 调用", (events) => {
          const names: string[] = [];
          for (const event of events) {
            if (
              event.type === "operation.started" &&
              event.operation.kind === "tool"
            ) {
              names.push(event.operation.tool ?? event.operation.name);
            }
          }
          const write = names.indexOf("file_write");
          const shell = names.indexOf("shell");
          return write !== -1 && shell !== -1 && write < shell;
        }),
      );
      t.check(
        t.events,
        satisfies<typeof t.events>(
          "no failed tool or subagent actions",
          (events) =>
            events.every(
              (event) =>
                event.type !== "operation.finished" ||
                event.status !== "failed",
            ),
        ),
      );
    });
    t.check(turn.message, includes(TOOL_PAYLOAD));
  },
});
