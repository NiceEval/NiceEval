import { describe, expect, it } from "vitest";

import { openClawAgent } from "./openclaw.ts";

describe("openClawAgent", () => {
  it("复用 defineSandboxAgent:kind sandbox + canonical mapper + tracing 面齐全", () => {
    const agent = openClawAgent();
    expect(agent.name).toBe("openclaw");
    expect(agent.kind).toBe("sandbox");
    expect(typeof agent.send).toBe("function");
    expect(typeof agent.setup).toBe("function");
    expect(typeof agent.spanMapper).toBe("function");
    expect(agent.tracing?.protocol).toBe("http/protobuf");
    // tracing 是 env-based 标准 OTEL_* 注入
    expect(agent.tracing?.env?.("http://127.0.0.1:4318/v1/traces")).toMatchObject({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
    });
  });

  it("常态证据覆盖只声明 partial(fixture 未验证不声明 complete),负断言由覆盖声明限制", () => {
    const agent = openClawAgent();
    expect(agent.coverage?.events?.status).toBe("partial");
    expect(agent.coverage?.actions?.status).toBe("partial");
    expect(agent.coverage?.messages?.status).toBe("partial");
    expect(agent.coverage?.usage?.status).toBe("partial");
    // 不声明 complete
    const statuses = Object.values(agent.coverage ?? {}).map((c) => c?.status);
    expect(statuses).not.toContain("complete");
  });
});
