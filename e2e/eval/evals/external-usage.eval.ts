import { equals, atMost, atLeast, defineValueMatch } from "niceeval/expect";
import { externalUsage } from "../fixtures/external-usage.ts";

export default externalUsage.defineEval({
  description: "Record external request snapshots without a conversation",
  test(t) {
    const cost = () => ({
      amount: "0",
      currency: "USD",
      source: { kind: "reported", id: "vercel-ai-gateway.response" },
    } as const);
    const vercelRoute = {
      transportProvider: "vercel",
      endpointId: "vercel-ai-gateway",
    } as const;
    const failed = {
      callId: "request-1",
      provider: "typesafe-ai",
      model: "typesafe-ai/jev",
      route: vercelRoute,
      cost: cost(),
      status: "failed" as const,
      inputTokens: null,
      inputTotalTokens: 100,
      outputTokens: 2,
    };
    t.record(failed);
    t.record({ ...failed });
    t.record({
      callId: "request-1",
      provider: "typesafe-ai",
      model: "typesafe-ai/jev",
      route: vercelRoute,
      cost: cost(),
      status: "failed",
      inputTokens: null,
      inputTotalTokens: 100,
      outputTokens: 2,
    });
    t.record({ callId: "request-2", retryOf: "request-1", provider: "typesafe-ai", model: "typesafe-ai/jev", route: vercelRoute, cost: cost(), status: "succeeded", inputTokens: 60, inputTotalTokens: 100, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 8 });
    t.record({ callId: "request-3", provider: "typesafe-ai", model: "typesafe-ai/jev", route: vercelRoute, cost: cost(), status: "unknown", inputTokens: null, outputTokens: null });
    t.record({ callId: "request-4", provider: "typesafe-ai", model: "typesafe-ai/jev", route: vercelRoute, cost: cost(), status: "succeeded", inputTokens: 0, inputTotalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
    t.record({ callId: "request-5", provider: "typesafe-ai", model: "typesafe-ai/jev", route: vercelRoute, cost: cost(), status: "succeeded", inputTokens: 60, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 20 });
    for (let index = 6; index <= 415; index += 1) {
      const hasObservedCost = index <= 354;
      t.record({
        callId: `request-${index}`,
        provider: hasObservedCost ? "typesafe-ai" : "openai",
        model: hasObservedCost ? "typesafe-ai/jev" : "openai/gpt-6-luna",
        route: hasObservedCost
          ? vercelRoute
          : { transportProvider: null, endpointId: "custom-openai-compatible" },
        ...(hasObservedCost ? { cost: cost() } : {}),
        status: "succeeded",
        inputTokens: 1,
        inputTotalTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
      });
    }
    t.finishUsage();
    const usage = t.usage;
    t.check(usage, defineValueMatch({ name: "official-usage-snapshot", evaluate: (value: typeof usage) => value.source === "adapter" && value.costs.totalContributions === 415 && value.totalTokens.state === "lower-bound" && value.totalTokens.value === 1150 && value.costs.values[0]?.value === "0.0000854" && Object.isFrozen(value.costs.values[0]) })).gate().label("Official usage snapshot");
    if (usage.source === "adapter") {
      t.check(usage.totalTokens, atMost(2000)).label("Unknown token ceiling");
      t.check(usage.totalTokens, atLeast(1150)).gate().label("Known token floor");
    }
    t.maxTokens(1149).label("Token ceiling exceeded");
    t.maxTokens(2000).label("Token ceiling unknown");
    t.maxCost(0.0000854).gate().label("Effective USD ceiling");
    t.maxCost(0.0000853).label("Effective USD exceeded");
    t.check(t.elapsedMs, atLeast(0)).gate().label("Runtime elapsed");
    t.check(true, equals(true)).gate();
  },
});
