import { defineEval } from "niceeval";
import { isDefined } from "niceeval/expect";

// The one Eval in this repo that drives a real model call — everything else this repo
// asserts (disk format, openRecord() parity, --json parity, --junit folding) is read off
// this Eval's two real attempts (see experiments/main.ts) so sources.json dedup
// across attempts sharing this eval file has something to exercise.
export default defineEval({
  description: "tool-call:真实 Chat Completions 兼容网关一次工具调用(get_stock_price),验证 calledTool 走通",

  async test(t) {
    const turn = await t.send(
      "请调用 get_stock_price 工具查询股票代码 ACME 的当前价格,查到后用一句简短的话告诉我。",
    );
    await turn.succeeded().stopOnFailure();

    turn.calledTool("get_stock_price", {
      count: 1,
      input: { symbol: (v: unknown) => typeof v === "string" && v.toUpperCase().includes("ACME") },
    });
    turn.noFailedActions();

    t.check(turn.usage?.inputTokens, isDefined("usage.inputTokens"));
    t.check(turn.usage?.outputTokens, isDefined("usage.outputTokens"));
  },
});
