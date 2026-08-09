// Skills(适配器契约页 Eval 闭环表):挂载的 Skill 被使用时,Claude Code 原生 Skill
// 工具调用(tool_use 块 name 恒为 "Skill",input.skill 是 skill 名)被 adapter 归一成
// 一等的 skill.loaded 事件——t.loadedSkill() 直接断言这个规范事件,不倒查原始工具名。
// 触发词是本仓库 fixture(fixtures/skills/e2e-marker)里写的精确短语,本机用真实
// 本地 live E2E 使用 gpt-5.6-luna 验证此 skill 触发路径。
// loadedSkill 与回答里的 fixture marker 共同证明 skill 的接线和行为，不再为这一条确定性
// 协议事实引入第二个 judge 模型与额外凭据。
import { defineEval } from "niceeval";
import { eventMatch, includes } from "niceeval/expect";

const TOPIC = "niceeval-e2e-skill-topic-926";
const OTHER_SKILLS = ["e2e-checklist", "e2e-decoy"] as const;

export default defineEval({
  description:
    "Skills:挂载的本地 Skill 产生 skill.loaded 事件,其内容会影响回答",
  async test(t) {
    const session1 = t.newSession();
    const turn1 = await session1.send(
      `${TOPIC} 是什么?回答前先检查你是否有一个关于这个确切主题的 skill,如果有就使用它。`,
    );
    await t.require(turn1.succeeded());

    await t.group("原生 Skill 工具被调用,归一为 skill.loaded", () => {
      t.assert(turn1.loadedSkill("e2e-marker"));
      t.assert(session1.loadedSkill("e2e-marker"));
      t.assert(t.loadedSkill("e2e-marker"));
      t.assert(
        t.event(
          eventMatch("message", { role: "assistant", text: includes("926") }),
        ),
      );
      t.assert(
        turn1.eventsSatisfy("skill.loaded event count", (events) =>
          events.filter((event) => event.type === "skill.loaded").length === 1,
        ),
      );
      t.assert(
        turn1.eventsSatisfy("marker 题没有误加载其它 Skill", (events) =>
            events.every(
              (event) =>
                event.type !== "skill.loaded" ||
                !OTHER_SKILLS.some((skill) => skill === event.skill),
            ),
          ),
      );
    });
  },
});
