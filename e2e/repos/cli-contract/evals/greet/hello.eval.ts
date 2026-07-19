import { defineEval } from "niceeval";

// normal 实验的正例之一:一次真实问候往返。与 tool/weather 分处不同 id 前缀,供
// scripts/verify.ts 断言 eval id 前缀选择确实收窄了实际运行集合。
export default defineEval({
  description: "greet/hello:真实 DeepSeek 网关一次问候,验证 send / messageIncludes 走通",
  async test(t) {
    const turn = await t.send("Reply with exactly this sentence and nothing else: Hello, niceeval!");
    turn.expectOk();
    t.messageIncludes(/Hello/i);
  },
});
