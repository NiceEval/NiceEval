import { defineEval } from "niceeval";
import { isDefined } from "niceeval/expect";

// The one Eval in this repo that drives a real model call — everything else this repo
// asserts (disk format, openResults() parity, --json parity, --junit folding) is read off
// this Eval's real attempts, run twice (see experiments/main.ts) so sources.json dedup
// across attempts sharing this eval file has something to exercise.
export default defineEval({
  description: "real tool-calling round trip against a Chat Completions-compatible gateway",

  async test(t) {
    const turn = await t.send(
      "What is the current stock price of ACME? Use the get_stock_price tool to look it up, " +
        "then tell me the price in one short sentence.",
    );
    turn.expectOk();

    turn.calledTool("get_stock_price", {
      count: 1,
      input: { symbol: (v: unknown) => typeof v === "string" && v.toUpperCase().includes("ACME") },
    });
    turn.noFailedActions();

    t.check(turn.usage?.inputTokens, isDefined("usage.inputTokens"));
    t.check(turn.usage?.outputTokens, isDefined("usage.outputTokens"));
  },
});
