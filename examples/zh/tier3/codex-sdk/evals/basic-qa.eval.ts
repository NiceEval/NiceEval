import { defineEval } from "niceeval";

// 这条 eval 验证 agent 能正常问答,顺带冒烟 usage 有没有从 turn.completed 的
// usage(input_tokens/output_tokens/cached_input_tokens)正确映射进 Turn.usage。
// Codex 是自主编码 agent,即使是纯问答也可能顺手探索一下工作目录——这里不强断言
// usedNoTools(),只看回答本身和有没有失败的动作。
export default defineEval({
  description: "测试 agent 能正常问答",

  async test(t) {
    const turn = await t.send("1+1 等于几?用一句话回答就好,不用跑命令也不用建文件。");
    await turn.succeeded().orStop();

    await t.group("正常收发", () => {
      t.succeeded();
      t.noFailedActions();
      t.messageIncludes("2");
    });

    t.maxTokens(40_000);
  },
});
