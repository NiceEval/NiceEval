import { defineEval } from "niceeval";
import { includes, satisfies, toolMatch } from "niceeval/expect";

const WRITE_MARKER = "niceeval-hermes-tool-input-914";

export default defineEval({
  description:
    "coding 任务工具轨:带可区分入参的写文件 + shell 读回,归一进标准事件流",
  async test(t) {
    const turn = await t.send(
      "请分两个独立的工具调用完成,不要合并成一条命令:\n" +
        `第一步:用文件写入工具在工作目录创建 notes.txt,内容精确为这一行:${WRITE_MARKER}\n` +
        "第二步:用 shell(例如 cat notes.txt)把内容读回来,并原样告诉我。",
    );
    await t.require(turn.succeeded());
    await t.group("写入 notes.txt,再串行 shell 读回来", () => {
      t.assert(
        t.calledTool(
          toolMatch("file_write", {
            input: satisfies(
              '"file_write" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                (typeof input["path"] === "string"
                  ? /notes\.txt/.test(input["path"])
                  : /notes\.txt/.test(JSON.stringify(input) ?? "")) &&
                (typeof input["content"] === "string"
                  ? new RegExp(WRITE_MARKER).test(input["content"])
                  : new RegExp(WRITE_MARKER).test(JSON.stringify(input) ?? "")),
            ),
            status: "completed",
          }),
        ),
      );
      t.assert(
        t.calledTool(
          toolMatch("shell", {
            input: satisfies(
              '"shell" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                (typeof input["command"] === "string"
                  ? /cat\s+notes\.txt/.test(input["command"])
                  : /cat\s+notes\.txt/.test(JSON.stringify(input) ?? "")),
            ),
            status: "completed",
          }),
        ),
      );
      t.assert(t.toolOrder([toolMatch("file_write"), toolMatch("shell")]));
      t.assert(t.noFailedActions());
    });
    t.assert(t.check(turn.message, includes(WRITE_MARKER)));
  },
});
