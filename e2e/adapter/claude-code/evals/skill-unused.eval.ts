// loadedSkill 的反例：Skill 已安装，但不相关的普通对话不应触发 Skill 工具。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

const MARKER = "CLAUDE_SKILL_UNUSED_604";

export default defineEval({
  description: "Skills 反例:普通对话不加载任何已安装 Skill",
  async test(t) {
    const session1 = t.newSession();
    const turn1 = await session1.send(
      `这是普通对话。不要使用任何工具或 Skill，只回复 ${MARKER}`,
    );
    await t.require(turn1.succeeded());

    t.assert(t.check(turn1.message, includes(MARKER)));
    t.assert(
      turn1.eventsSatisfy("no skill.loaded event", (events) =>
        events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.assert(
      session1.eventsSatisfy("no skill.loaded event", (events) =>
        events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.assert(
      t.eventsSatisfy("no skill.loaded event", (events) =>
        events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.assert(turn1.usedNoTools());
    t.assert(session1.usedNoTools());
    t.assert(t.usedNoTools());
  },
});
