import { defineEval } from "niceeval";

// normal 实验的正例之一:一次确定性问候往返。与 tool/weather 分处不同 id 前缀,供
// test/cli.test.ts 断言 eval id 前缀选择确实收窄了实际运行集合。
export default defineEval({
  description: "greet/hello:确定性 Agent 一次问候,验证 send / messageIncludes 走通",
  async test(t) {
    const turn = await t.send("Reply with exactly this sentence and nothing else: Hello, niceeval!");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes(/Hello/i);
  },
});
