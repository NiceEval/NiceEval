import { defineEval } from "niceeval";

// MCP 工具调用:验证 agent 在天气问题上会调用 get_weather——工具名是 MCP 命名空间下的真实名字
// mcp__demo-tools__get_weather(不是裸的 get_weather),入参 city 连名带参一起断言(见
// docs/engineering/e2e-ci/adapters/README.md「断言调用存在且入参正确」)。
//
// notCalledTool 的反例目标是 mcp__demo-tools__search——这个工具在 src/backend/tools.ts 里根本
// 不存在,MCP server 上从未挂载过,负断言在结构上必然成立,不依赖模型这一次具体怎么回答。
//
// t.maxTokens 顺带验证 usage 覆盖:result 帧的 usage 进了 Turn(见 usage 与 cost 一行的
// Eval 闭环)——这是非 optional 的上限断言,若这条通道被判定不完整(unavailable),整个 attempt
// 会 errored 而不是静默通过,所以它同时是「usage 确实落到了 Turn 上」的正向证明。
export default defineEval({
  description: "agent 调用 get_weather 时带上原样的城市参数,并根据工具结果作答",

  async test(t) {
    const turn = await t.send("Brooklyn 现在天气怎么样?调用 get_weather 工具查一下。");
    turn.expectOk();

    await t.group("调用 get_weather 且 city=Brooklyn,不调用未挂载的 search 工具", () => {
      t.calledTool("mcp__demo-tools__get_weather", { input: { city: "Brooklyn" } });
      t.notCalledTool("mcp__demo-tools__search");
      t.messageIncludes(/sunny|22|°C|weather/i);
    });

    turn.maxTokens(50_000);
  },
});
