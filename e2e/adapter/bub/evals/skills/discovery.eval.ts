import { defineEval } from "niceeval";
import { includes, jsonMatch, toolMatch } from "niceeval/expect";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";
const MAGIC_WORD = "pineapple-37";
export default defineEval({
  description: "挂载的 skill 内容在事件流里体现为真实的使用证据",
  async test(t) {
    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}这不是编码任务——不要写入或编辑任何文件。\n` +
        `从已发现的项目 Skill 里找到负责 review conventions 的 Skill。用原生 skill 工具加载它，` +
        `然后告诉我文件里记载的魔法词。`,
    );
    await turn.succeeded().orStop();
    t.check(turn.reply, includes(MAGIC_WORD));
    turn.calledTool(toolMatch("skill", { input: jsonMatch({ name: "review" }), status: "completed" }));
  },
});
