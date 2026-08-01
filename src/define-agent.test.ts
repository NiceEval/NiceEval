// cases: docs/engineering/testing/unit/adapters.md

import { describe, expect, it } from "vitest";
import { defineDirectAgent, defineSandboxAgent } from "./define.ts";
import { makeSendFailure } from "./context/send-failures.ts";
import { defineSandboxCommand } from "./sandbox/commands.ts";

const ensure = {
  identity: { agent: "fixture", version: "1.0.0", revision: "1" },
  probe: defineSandboxCommand({ id: "fixture.probe", revision: "1", inputs: {} }, async () => {}),
};

describe("public Agent factories", () => {
  it("defineDirectAgent fixes kind and preserves classifySendFailure", () => {
    const classifySendFailure = () => ({ retryable: false as const, reason: "protocol" });
    const agent = defineDirectAgent({
      name: "service",
      send: async () => ({ events: [], status: "completed" }),
      classifySendFailure,
    });
    expect(agent.kind).toBe("direct");
    expect(agent.classifySendFailure).toBe(classifySendFailure);
  });

  it("defineSandboxAgent exposes the same failure-classifier mount", () => {
    const classifySendFailure = (failure: ReturnType<typeof makeSendFailure>) =>
      failure.acceptance === "rejected" ? { retryable: true as const, reason: "admission" } : undefined;
    const agent = defineSandboxAgent({
      name: "cli",
      ensure,
      send: async () => ({ events: [], status: "completed" }),
      classifySendFailure,
    });
    expect(agent.kind).toBe("sandbox");
    expect(agent.ensure).toEqual([ensure]);
    expect(agent.installers).toEqual([]);
    expect(agent.classifySendFailure).toBe(classifySendFailure);
  });

  it("defineSandboxAgent rejects a dynamic definition without required ensure", () => {
    expect(() => defineSandboxAgent({
      name: "cli",
      send: async () => ({ events: [], status: "completed" }),
    } as never)).toThrow(/defineSandboxAgent.*ensure/);
    expect(() => defineSandboxAgent({
      name: "cli",
      ensure: [],
      send: async () => ({ events: [], status: "completed" }),
    })).toThrow(/defineSandboxAgent.*ensure/);
  });

  it("names defineDirectAgent in construction errors", () => {
    expect(() => defineDirectAgent({
      name: "",
      send: async () => ({ events: [], status: "completed" }),
    })).toThrow(/defineDirectAgent/);
  });
});
