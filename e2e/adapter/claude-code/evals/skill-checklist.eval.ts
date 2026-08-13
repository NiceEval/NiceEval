// 第二条 Skill 正选：同一 agent 装了三个 Skill，只允许 checklist 命中。
import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";
import type { StreamEvent } from "niceeval";
const TOPIC = "niceeval-e2e-checklist-topic-731";
const OTHER_SKILLS = ["e2e-marker", "e2e-decoy"] as const;
const loadedSkill = (events: readonly StreamEvent[], skill: string): boolean =>
  events.some(
    (event) => event.type === "skill.loaded" && event.skill === skill,
  );
export default defineEval({
  description:
    "Skills:checklist 题只加载 e2e-checklist，不误加载 marker / decoy",
  async test(t) {
    const session1 = t.newSession();
    const turn1 = await session1.send(
      `${TOPIC} 是什么？先调用 Skill 工具加载 e2e-checklist；加载完成后再按该 Skill 回答。`,
    );
    await turn1.succeeded().orStop();
    t.check(
      turn1.events,
      satisfies<typeof turn1.events>("loaded skill e2e-checklist", (events) =>
        loadedSkill(events, "e2e-checklist"),
      ),
    );
    t.check(turn1.message, includes("731"));
    t.check(
      turn1.events,
      satisfies<typeof turn1.events>(
        "skill.loaded event count",
        (events) =>
          events.filter((event) => event.type === "skill.loaded").length === 1,
      ),
    );
    t.check(
      turn1.events,
      satisfies<typeof turn1.events>(
        "checklist 题没有误加载其它 Skill",
        (events) =>
          events.every(
            (event) =>
              event.type !== "skill.loaded" ||
              !OTHER_SKILLS.some((skill) => skill === event.skill),
          ),
      ),
    );
  },
});
