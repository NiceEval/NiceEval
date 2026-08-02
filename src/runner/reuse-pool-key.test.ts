// cases: docs/engineering/testing/unit/sandbox.md

import { describe, expect, it } from "vitest";
import { sandboxReusePoolKey } from "./run.ts";

describe("sandboxReusePoolKey", () => {
  const common = {
    providerPlan: { provider: "docker", caseKey: "same-case" },
    agentInstalls: [{ agent: "codex", revision: "1" }],
    scope: { _tag: "Shared" as const },
  };
  it("同一物理 plan 与共享 lifecycle 得到同一 pool key", () => {
    expect(sandboxReusePoolKey(common)).toBe(sandboxReusePoolKey({ ...common }));
  });

  it("Eval-owned lifecycle 按 eval 隔离，纯 Experiment lifecycle 共享", () => {
    const evalA = { ...common, scope: { _tag: "Eval" as const, evalId: "task/a" } };
    const evalB = { ...common, scope: { _tag: "Eval" as const, evalId: "task/b" } };
    expect(sandboxReusePoolKey(evalA)).not.toBe(sandboxReusePoolKey(evalB));
    expect(sandboxReusePoolKey(common)).not.toBe(sandboxReusePoolKey(evalA));
  });
});
