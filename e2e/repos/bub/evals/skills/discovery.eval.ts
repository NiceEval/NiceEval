import { defineEval } from "niceeval";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

// bub 没有原生 Skill 加载机制:装进 .agents/skills/ 目录 + AGENTS.md 里的发现指引
// (见 src/agents/skills.ts skillDiscoveryInstruction)是唯一途径。证据因此不是一等的
// "skill.loaded" 事件(那只有原生机制的 adapter 才发),而是「Skill 内容确实影响了这轮
// 输出」——助手文本引用了只存在于 SKILL.md 里的值,外加至少一次工具调用的入参提到了
// skill 路径/文件名(见 docs/engineering/e2e-ci/adapters/bub.md「Skills」)。
const MAGIC_WORD = "pineapple-37";

export default defineEval({
  description: "mounted skill content shows up as real usage evidence in the event stream",

  async test(t) {
    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}This is not a coding task — do not write or edit any files.\n` +
        `Check your project skills directory for the review-conventions skill and tell me the exact magic word ` +
        `documented there.`,
    );
    turn.expectOk();

    t.messageIncludes(MAGIC_WORD);
    t.eventsSatisfy(
      "some tool call touched the mounted skill file (path/name appears in a call's input)",
      (events) =>
        events.some(
          (e) => e.type === "action.called" && JSON.stringify(e.input).toLowerCase().includes("skill"),
        ),
    );
  },
});
