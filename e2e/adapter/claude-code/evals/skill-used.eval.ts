// Skills(适配器契约页 Eval 闭环表):挂载的 Skill 被使用时,Claude Code 原生 Skill
// 工具调用(tool_use 块 name 恒为 "Skill",input.skill 是 skill 名)被 adapter 归一成
// 一等的 skill.loaded 事件——t.loadedSkill() 直接断言这个规范事件,不倒查原始工具名。
// 触发词是本仓库 fixture(fixtures/skills/e2e-marker)里写的精确短语,本机用真实
// DeepSeek 代理下的 deepseek-v4-flash 验证过 3/3 次稳定触发。
// judge 兜底看回答内容是否真的引用了 skill 的具体指导,而不是巧合猜中"926"。
import { defineEval } from "niceeval";

const TOPIC = "niceeval-e2e-skill-topic-926";

export default defineEval({
  description: "Skills:挂载的本地 Skill 产生 skill.loaded 事件,其内容会影响回答",
  async test(t) {
    const turn = await t.send(
      `${TOPIC} 是什么?回答前先检查你是否有一个关于这个确切主题的 skill,如果有就使用它。`,
    );
    await turn.succeeded().stopOnFailure();

    await t.group("原生 Skill 工具被调用,归一为 skill.loaded", () => {
      t.loadedSkill("e2e-marker");
      t.messageIncludes("926");
    });

    t.judge.autoevals
      .closedQA(
        '助手的回答是否明确说明这个魔法数字是 926(e2e-marker skill 里的确切内容),而不是泛泛的猜测或拒绝回答?',
      )
      .atLeast(0.6);
  },
});
