// cases: docs/engineering/testing/unit/sandbox.md

import { describe, expect, it } from "vitest";
import type { SandboxLayerFingerprintProjection } from "../sandbox/link.ts";
import { sandboxReusePoolKey } from "./run.ts";

describe("sandboxReusePoolKey", () => {
  const common = {
    providerPlan: { provider: "docker", caseKey: "same-case" },
    agentInstalls: [{ agent: "codex", revision: "1" }],
    scope: { _tag: "Shared" as const },
  };
  const experimentLayer: SandboxLayerFingerprintProjection = {
    version: 1,
    templateOwner: { kind: "experiment", id: "compare/codex" },
    template: { image: "node:24" },
    commands: [{
      kind: "stable",
      owner: { kind: "eval", id: "task/a" },
      index: 0,
      id: "install-a",
      revision: "1",
      inputs: {},
    }],
  };

  it("同一 provider physical plan 下，template owner 不同就不共池", () => {
    const evalOwned: SandboxLayerFingerprintProjection = {
      ...experimentLayer,
      templateOwner: { kind: "eval", id: "task/a" },
    };

    expect(sandboxReusePoolKey({ ...common, layer: experimentLayer })).not.toBe(
      sandboxReusePoolKey({ ...common, layer: evalOwned }),
    );
  });

  it("同一 provider physical plan 下，作者 command identity 不同就不共池", () => {
    const otherCommand: SandboxLayerFingerprintProjection = {
      ...experimentLayer,
      commands: [{
        kind: "stable",
        owner: { kind: "eval", id: "task/b" },
        index: 0,
        id: "install-b",
        revision: "1",
        inputs: {},
      }],
    };

    expect(sandboxReusePoolKey({ ...common, layer: experimentLayer })).not.toBe(
      sandboxReusePoolKey({ ...common, layer: otherCommand }),
    );
  });
});
