import { defineEval } from "niceeval";
import { includes, satisfies, toolMatch } from "niceeval/expect";

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
    await t.require(turn.succeeded());
    await t.group("写入 notes.txt,再串行 shell 读回来", () => {
      // marker 同时必须在两个工具输入中出现，能杀死「只留工具名/路径、丢掉实际参数」的归一。
      t.check(
        t.calledTool(
          toolMatch("file_write", {
            input: satisfies('"file_write" input', (input) =>
              typeof input === "string"
                ? new RegExp(TOOL_PAYLOAD).test(input)
                : new RegExp(TOOL_PAYLOAD).test(JSON.stringify(input) ?? ""),
            ),
          }),
        ),
      );
      t.check(
        t.calledTool(
          toolMatch("shell", {
            input: satisfies('"shell" input', (input) =>
              typeof input === "string"
                ? new RegExp(TOOL_PAYLOAD).test(input)
                : new RegExp(TOOL_PAYLOAD).test(JSON.stringify(input) ?? ""),
            ),
          }),
        ),
      );
      t.check(turn.toolOrder([toolMatch("file_write"), toolMatch("shell")]));
      t.check(t.noFailedActions());
    });
    t.check(turn.message, includes(TOOL_PAYLOAD));
  },
});
