import { defineEval } from "niceeval";

// 这条 eval 验证 agent 能正常问答、不瞎调工具。断言依据全部来自 adapter 从应用自己的
// SSE 帧映射的事件;应用协议里没有 usage,所以这里不做用量断言(OTel span 只进瀑布图)。
export default defineEval({
  description: "测试 agent 能正常问答且不瞎调工具",

  async test(t) {
    const turn = await t.send("用一句话介绍一下你自己,这轮不用查天气也不用算数。");
    await turn.succeeded().stopOnFailure();

    await t.group("正常收发、没有多余工具调用", () => {
      t.succeeded();
      t.usedNoTools();
    });
  },
});
