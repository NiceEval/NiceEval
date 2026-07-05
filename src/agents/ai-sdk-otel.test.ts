import { describe, expect, it } from "vitest";

import { aiSdkOtel } from "./ai-sdk-otel.ts";

describe("aiSdkOtel", () => {
  it("为端点建出带一个 @ai-sdk/otel 集成的遥测件,flush 可用", async () => {
    const pipeline = aiSdkOtel();
    const turn = pipeline.telemetryForEndpoint("http://127.0.0.1:4318/v1/traces");
    expect(turn.settings.integrations).toHaveLength(1);
    await expect(turn.flush()).resolves.toBeUndefined(); // 没有 span 时 flush 不发网络请求
  });

  it("同端点复用 provider,不同端点各建一条(并行 attempt 的 span 不串流)", () => {
    const pipeline = aiSdkOtel();
    const a1 = pipeline.telemetryForEndpoint("http://127.0.0.1:4318/v1/traces");
    const a2 = pipeline.telemetryForEndpoint("http://127.0.0.1:4318/v1/traces");
    const b = pipeline.telemetryForEndpoint("http://127.0.0.1:4319/v1/traces");
    const tracerOf = (t: typeof a1) => (t.settings.integrations[0] as { tracer?: unknown }).tracer;
    expect(tracerOf(a1)).toBe(tracerOf(a2));
    expect(tracerOf(a1)).not.toBe(tracerOf(b));
  });
});
