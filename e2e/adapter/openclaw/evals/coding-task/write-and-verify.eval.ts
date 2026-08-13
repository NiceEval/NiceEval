import { defineEval } from "niceeval";
import { jsonMatch, pattern, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "coding 任务工具轨:写文件 + shell 读回,归一进标准事件流",
  async test(t) {
    const turn = await t.send(
      "请分两个独立的工具调用完成,不要合并成一条命令:\n" +
        "第一步:用文件写入工具在工作目录创建 notes.txt,内容精确为这一行:niceeval e2e ok\n" +
        "第二步:用 shell(例如 cat notes.txt)把内容读回来,并原样告诉我。",
    );
    await turn.succeeded().orStop();
    await t.group("写入 notes.txt,再串行 shell 读回来", () => {
      t.calledTool(
        toolMatch("file_write", {
          input: jsonMatch({ path: /notes\.txt/, content: /niceeval e2e ok/ }),
        }),
      );
      t.calledTool(
        toolMatch("shell", {
          input: jsonMatch({ command: /cat\s+notes\.txt/ }),
        }),
      );
      t.check(
        turn.toolCalls,
        satisfies(
          "file_write 先于 shell",
          (calls) => {
            const write = calls.findIndex((call) => call.name === "file_write");
            const shell = calls.findIndex((call) => call.name === "shell");
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
    t.check(turn.message, pattern(/niceeval e2e ok/));
  },
});
