// Skills(适配器契约页 Eval 闭环表):挂载的 Skill 被使用时,Claude Code 原生 Skill
// 工具调用(tool_use 块 name 恒为 "Skill",input.skill 是 skill 名)被 adapter 归一成
// 一等的 skill.loaded 事件——下面直接对事件流断言这个规范事件,不倒查原始工具名。
// 触发词是本仓库 fixture(fixtures/skills/e2e-marker)里写的精确短语,本机用真实
// 本地 live E2E 使用 gpt-5.6-luna 验证此 skill 触发路径。
// skill.loaded 事件与回答里的 fixture marker 共同证明 skill 的接线和行为，不再为这一条确定性
// 协议事实引入第二个 judge 模型与额外凭据。
import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";
import type { StreamEvent } from "niceeval";
const TOPIC = "niceeval-e2e-skill-topic-926";
const OTHER_SKILLS = ["e2e-checklist", "e2e-decoy"] as const;
const loadedSkill = (events: readonly StreamEvent[], skill: string): boolean =>
  events.some(
    (event) => event.type === "skill.loaded" && event.skill === skill,
  );
export default defineEval({
  description:
    "Skills:挂载的本地 Skill 产生 skill.loaded 事件,其内容会影响回答",
  async test(t) {
    const session1 = t.newSession();
    const turn1 = await session1.send(
      `${TOPIC} 是什么?回答前先检查你是否有一个关于这个确切主题的 skill,如果有就使用它。`,
    );
    await turn1.succeeded().orStop();
    await t.group("原生 Skill 工具被调用,归一为 skill.loaded", () => {
      t.check(
        turn1.events,
        satisfies<typeof turn1.events>("loaded skill e2e-marker", (events) =>
          loadedSkill(events, "e2e-marker"),
        ),
      );
      t.check(
        session1.events,
        satisfies<typeof session1.events>("loaded skill e2e-marker", (events) =>
          loadedSkill(events, "e2e-marker"),
        ),
      );
      t.check(
        t.events,
        satisfies<typeof t.events>("loaded skill e2e-marker", (events) =>
          loadedSkill(events, "e2e-marker"),
        ),
      );
      t.check(
        t.events,
        satisfies<typeof t.events>(
          "assistant 回复提及 fixture marker",
          (events) =>
            events.some(
              (event) =>
                event.type === "message" &&
                event.role === "assistant" &&
                event.text.includes("926"),
            ),
        ),
      );
      t.check(
        turn1.events,
        satisfies<typeof turn1.events>(
          "skill.loaded event count",
          (events) =>
            events.filter((event) => event.type === "skill.loaded").length ===
            1,
        ),
      );
      t.check(
        turn1.events,
        satisfies<typeof turn1.events>(
          "marker 题没有误加载其它 Skill",
          (events) =>
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
