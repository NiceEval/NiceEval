import { defineEval } from "niceeval";
import { eventMatch, includes } from "niceeval/expect";

import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

// bub 没有原生 Skill 加载机制:装进 .agents/skills/ 目录 + AGENTS.md 里的发现指引
// (见 src/agents/skills.ts skillDiscoveryInstruction)是唯一途径。证据因此不是一等的
// "skill.loaded" 事件(那只有原生机制的 adapter 才发),而是「Skill 内容确实影响了这轮
// 输出」——助手文本引用了只存在于 SKILL.md 里的值,外加至少一次工具调用的入参提到了
// skill 路径/文件名(见 docs/engineering/testing/e2e/adapter/bub.md「Skills」)。
const MAGIC_WORD = "pineapple-37";

export default defineEval({
  description: "挂载的 skill 内容在事件流里体现为真实的使用证据",

  async test(t) {
    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}这不是编码任务——不要写入或编辑任何文件。\n` +
        `检查你的项目 skills 目录里的 review-conventions skill,把其中记录的确切魔法词` +
        `告诉我。`,
    );
    await t.require(turn.succeeded());

    t.assert(
      t.event(
        eventMatch("message", {
          role: "assistant",
          text: includes(MAGIC_WORD),
        }),
      ),
    );
    t.assert(
      t.eventsSatisfy(
        "某次工具调用的入参中出现了挂载的 skill 文件路径/文件名",
        (events) =>
            events.some(
              (event) =>
                event.type === "operation.started" &&
                event.operation.kind === "tool" &&
                JSON.stringify(event.operation.input)
                  .toLowerCase()
                  .includes("skill"),
            ),
        ),
      ),
    );
  },
});
