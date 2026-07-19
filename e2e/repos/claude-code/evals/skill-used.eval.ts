// Skills(适配器契约页 Eval 闭环表):挂载的 Skill 被使用时,Claude Code 原生 Skill
// 工具调用(tool_use 块 name 恒为 "Skill",input.skill 是 skill 名)被 adapter 归一成
// 一等的 skill.loaded 事件——t.loadedSkill() 直接断言这个规范事件,不倒查原始工具名。
// 触发词是本仓库 fixture(fixtures/skills/e2e-marker)里写的精确短语,本机用真实
// DeepSeek 代理下的 deepseek-v4-flash 验证过 3/3 次稳定触发。
// judge 兜底看回答内容是否真的引用了 skill 的具体指导,而不是巧合猜中"926"。
import { defineEval } from "niceeval";

const TOPIC = "niceeval-e2e-skill-topic-926";

export default defineEval({
  description: "Skills: a mounted local Skill produces a skill.loaded event and its content shapes the answer",
  async test(t) {
    const turn = await t.send(
      `What is ${TOPIC}? Check whether you have a skill about this exact topic before answering, and use it if you do.`,
    );
    turn.expectOk();

    await t.group("native Skill tool invoked, normalized to skill.loaded", () => {
      t.loadedSkill("e2e-marker");
      t.messageIncludes("926");
    });

    t.judge.autoevals
      .closedQA(
        'Does the assistant\'s answer state that the magic number is 926 (the exact content of the e2e-marker skill), rather than a generic guess or refusal?',
      )
      .atLeast(0.6);
  },
});
