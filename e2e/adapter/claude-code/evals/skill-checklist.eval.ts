// 第二条 Skill 正选：同一 agent 装了三个 Skill，只允许 checklist 命中。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

const TOPIC = "niceeval-e2e-checklist-topic-731";
const OTHER_SKILLS = ["e2e-marker", "e2e-decoy"] as const;

export default defineEval({
  description:
    "Skills:checklist 题只加载 e2e-checklist，不误加载 marker / decoy",
  async test(t) {
    const session1 = t.newSession();
    const turn1 = await session1.send(
      `${TOPIC} 是什么?回答前先检查匹配这个确切主题的 skill，并且只使用匹配的那个。`,
    );
    await t.require(turn1.succeeded());

    t.assert(turn1.loadedSkill("e2e-checklist"));
    t.assert(session1.loadedSkill("e2e-checklist"));
    t.assert(t.loadedSkill("e2e-checklist"));
    t.assert(t.check(turn1.message, includes("731")));
    t.assert(
      turn1.eventsSatisfy("skill.loaded event count", (events) =>
        events.filter((event) => event.type === "skill.loaded").length === 1,
      ),
    );
    t.assert(
      turn1.eventsSatisfy("checklist 题没有误加载其它 Skill", (events) =>
          events.every(
            (event) =>
              event.type !== "skill.loaded" ||
              !OTHER_SKILLS.some((skill) => skill === event.skill),
          ),
        ),
    );
  },
});
