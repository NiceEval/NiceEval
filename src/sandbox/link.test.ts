// cases: docs/engineering/testing/unit/sandbox.md

import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { defineSandboxCommand, shell } from "./commands.ts";
import {
  dockerComposeSandbox,
  dockerImageSandbox,
  e2bSandbox,
  sandboxLayer,
} from "./layer.ts";
import {
  formatSandboxLayerLinkError,
  linkSandboxLayers,
  sandboxLayerIdentityFor,
  SandboxLayerLinkError,
  type SandboxLayerPairInput,
} from "./link.ts";
import { digestOf } from "./identity.ts";

function imageTemplateIdentity(image: string) {
  return {
    version: 2,
    provider: "docker",
    kind: "image",
    publishable: { source: "configured-image" },
    privateIdentityDigest: digestOf({ provider: "docker", kind: "image", image }),
  };
}

function stable(id: string) {
  return defineSandboxCommand({ id, revision: "1", inputs: { id } }, async () => {});
}

function sandboxPair(input: {
  evalId?: string;
  experimentId?: string;
  evalLayer?: SandboxLayerPairInput["eval"]["layer"];
  experimentLayer?: SandboxLayerPairInput["experiment"]["layer"];
  evalDeclaredAt?: SandboxLayerPairInput["eval"]["declaredAt"];
  experimentDeclaredAt?: SandboxLayerPairInput["experiment"]["declaredAt"];
  agentKind?: "direct" | "sandbox";
} = {}): SandboxLayerPairInput {
  return {
    eval: {
      id: input.evalId ?? "eval/task",
      ...(input.evalLayer !== undefined ? { layer: input.evalLayer } : {}),
      ...(input.evalDeclaredAt !== undefined ? { declaredAt: input.evalDeclaredAt } : {}),
    },
    experiment: {
      id: input.experimentId ?? "experiment/codex",
      ...(input.experimentLayer !== undefined ? { layer: input.experimentLayer } : {}),
      ...(input.experimentDeclaredAt !== undefined ? { declaredAt: input.experimentDeclaredAt } : {}),
    },
    agent: { kind: input.agentKind ?? "sandbox", name: "codex" },
  };
}

function linkError(pairs: readonly SandboxLayerPairInput[]): SandboxLayerLinkError {
  const error = Effect.runSync(Effect.flip(linkSandboxLayers(pairs)));
  expect(error).toBeInstanceOf(SandboxLayerLinkError);
  return error;
}

function linkOk(pairs: readonly SandboxLayerPairInput[]) {
  return Effect.runSync(linkSandboxLayers(pairs));
}

describe("pure SandboxLayer linker", () => {
  it("遍历全矩阵后一次聚合 missing、相同物理 template conflict 与 Direct Agent 显式空 layer", () => {
    const error = linkError([
      sandboxPair({ evalId: "eval/missing" }),
      sandboxPair({
        evalId: "eval/conflict",
        evalLayer: dockerImageSandbox({ image: "node:24" }),
        experimentLayer: dockerImageSandbox({ image: "node:24" }),
        evalDeclaredAt: { file: "evals/conflict/eval.ts", line: 4, expression: "dockerImageSandbox(...)" },
        experimentDeclaredAt: {
          file: "experiments/codex.ts",
          line: 7,
          expression: "dockerImageSandbox(...)",
        },
      }),
      sandboxPair({
        evalId: "eval/direct",
        agentKind: "direct",
        evalLayer: sandboxLayer(),
      }),
    ]);

    expect(error.code).toBe("sandbox.link-failed");
    expect(error.message).toContain("3 pairs");
    expect(error.message).toContain("No Sandbox was created");
    expect(error.issues.map((entry) => entry.code)).toEqual([
      "sandbox.template-missing",
      "sandbox.template-conflict",
      "sandbox.unexpected-for-direct-agent",
    ]);

    expect(error.issues[0]).toMatchObject({
      eval: { explicit: false, kind: "command-only", commands: [] },
      experiment: { explicit: false, kind: "command-only", commands: [] },
    });
    expect(error.issues[0]!.actions.join(" ")).toMatch(/Declare one template-bearing/);
    expect(error.issues[1]).toMatchObject({
      eval: {
        explicit: true,
        kind: "template-bearing",
        template: {
          _tag: "Declared",
          value: { kind: "image", identity: imageTemplateIdentity("node:24") },
        },
        declaredAt: {
          _tag: "Declared",
          value: { file: "evals/conflict/eval.ts", line: { _tag: "Declared", value: 4 } },
        },
      },
      experiment: {
        explicit: true,
        kind: "template-bearing",
        template: {
          _tag: "Declared",
          value: { kind: "image", identity: imageTemplateIdentity("node:24") },
        },
        declaredAt: {
          _tag: "Declared",
          value: { file: "experiments/codex.ts", line: { _tag: "Declared", value: 7 } },
        },
      },
    });
    expect(error.issues[1]!.actions.join(" ")).toMatch(/does not merge or prioritize templates/);
    expect(error.issues[2]).toMatchObject({
      pair: { agentKind: "direct", agentName: "codex" },
      eval: { explicit: true, kind: "command-only" },
      experiment: { explicit: false },
    });

    const formatted = formatSandboxLayerLinkError(error);
    expect(formatted).toContain("sandbox.template-conflict");
    expect(formatted).toContain("dockerImageSandbox(...) at evals/conflict/eval.ts:4");
    expect(formatted).toContain("dockerImageSandbox(...) at experiments/codex.ts:7");
    expect(formatted).toContain("3 invalid pairs found. No Sandbox was created.");
  });

  it("Direct Agent 两侧都省略 layer 时合法，显式 command-only Experiment 仍报 unexpected", () => {
    expect(linkOk([sandboxPair({ agentKind: "direct" })])).toEqual([
      {
        kind: "direct",
        evalId: "eval/task",
        experimentId: "experiment/codex",
        agentName: "codex",
      },
    ]);

    const error = linkError([
      sandboxPair({ agentKind: "direct", experimentLayer: sandboxLayer().prepare(shell("true")) }),
    ]);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]).toMatchObject({
      code: "sandbox.unexpected-for-direct-agent",
      experiment: {
        explicit: true,
        kind: "command-only",
        commands: [{ kind: "stable", id: "niceeval.sandbox.shell" }],
      },
    });
  });

  it("唯一 template owner 决定命令顺序，fingerprint 保留 owner、template 与稳定 identity", () => {
    const evalLayer = dockerImageSandbox({ image: "node:24@sha256:abc" })
      .prepare(stable("eval.first"))
      .prepare(stable("eval.second"));
    const experimentLayer = sandboxLayer().prepare(stable("experiment.after"));
    const [evalOwned] = linkOk([sandboxPair({ evalLayer, experimentLayer })]);

    expect(evalOwned).toMatchObject({
      kind: "sandbox",
      templateOwner: { kind: "eval", id: "eval/task" },
      template: {
        provider: "docker",
        kind: "image",
        identity: imageTemplateIdentity("node:24@sha256:abc"),
      },
      carryEligible: true,
      carryIneligibleReasons: [],
    });
    if (evalOwned?.kind !== "sandbox") throw new Error("expected linked sandbox pair");
    expect(evalOwned.commands.map((entry) => [entry.owner.kind, entry.index, entry.fingerprint.kind === "stable" ? entry.fingerprint.id : "opaque"])).toEqual([
      ["eval", 0, "eval.first"],
      ["eval", 1, "eval.second"],
      ["experiment", 0, "experiment.after"],
    ]);
    expect(evalOwned.fingerprint).toEqual({
      version: 1,
      templateOwner: { kind: "eval", id: "eval/task" },
      template: imageTemplateIdentity("node:24@sha256:abc"),
      commands: [
        { kind: "stable", owner: { kind: "eval", id: "eval/task" }, index: 0, id: "eval.first", revision: "1", inputs: { id: "eval.first" } },
        { kind: "stable", owner: { kind: "eval", id: "eval/task" }, index: 1, id: "eval.second", revision: "1", inputs: { id: "eval.second" } },
        { kind: "stable", owner: { kind: "experiment", id: "experiment/codex" }, index: 0, id: "experiment.after", revision: "1", inputs: { id: "experiment.after" } },
      ],
    });
    expect(sandboxLayerIdentityFor(evalOwned, "eval")).toEqual({
      layer: {
        _tag: "Template",
        value: imageTemplateIdentity("node:24@sha256:abc"),
      },
      commands: [
        { kind: "stable", index: 0, id: "eval.first", revision: "1", inputs: { id: "eval.first" } },
        { kind: "stable", index: 1, id: "eval.second", revision: "1", inputs: { id: "eval.second" } },
      ],
    });
    expect(sandboxLayerIdentityFor(evalOwned, "experiment")).toEqual({
      layer: { _tag: "CommandOnly" },
      commands: [
        { kind: "stable", index: 0, id: "experiment.after", revision: "1", inputs: { id: "experiment.after" } },
      ],
    });

    const [experimentOwned] = linkOk([
      sandboxPair({
        evalLayer: sandboxLayer().prepare(stable("eval.after")),
        experimentLayer: e2bSandbox({ template: "codex-v3" }).prepare(stable("experiment.first")),
      }),
    ]);
    if (experimentOwned?.kind !== "sandbox") throw new Error("expected linked sandbox pair");
    expect(experimentOwned.commands.map((entry) => entry.owner.kind)).toEqual(["experiment", "eval"]);
    expect(experimentOwned.templateOwner).toEqual({ kind: "experiment", id: "experiment/codex" });
  });

  it("opaque callback 保留执行顺序但关闭 carry，并给出 owner、序号和可行动修法", () => {
    const opaque = async (): Promise<void> => {};
    const [linked] = linkOk([
      sandboxPair({
        evalLayer: dockerImageSandbox({ image: "node:24" }).prepare(stable("eval.stable")),
        experimentLayer: sandboxLayer().prepare(opaque).prepare(stable("experiment.stable")),
      }),
    ]);
    if (linked?.kind !== "sandbox") throw new Error("expected linked sandbox pair");

    expect(linked.commands.map((entry) => entry.command)).toEqual([
      expect.any(Function),
      opaque,
      expect.any(Function),
    ]);
    expect(linked.fingerprint.commands).toEqual([
      expect.objectContaining({ kind: "stable", owner: { kind: "eval", id: "eval/task" }, id: "eval.stable" }),
      { kind: "opaque", owner: { kind: "experiment", id: "experiment/codex" }, index: 0 },
      expect.objectContaining({ kind: "stable", owner: { kind: "experiment", id: "experiment/codex" }, id: "experiment.stable" }),
    ]);
    expect(linked.carryEligible).toBe(false);
    expect(linked.carryIneligibleReasons).toEqual([
      expect.objectContaining({
        code: "sandbox.command-opaque",
        owner: { kind: "experiment", id: "experiment/codex" },
        commandIndex: { _tag: "Declared", value: 0 },
        reason: expect.stringMatching(/prepare command #1.*defineSandboxCommand/),
      }),
    ]);
    expect(sandboxLayerIdentityFor(linked, "eval")).toMatchObject({
      layer: { _tag: "Template", value: { provider: "docker", kind: "image" } },
    });
    expect(sandboxLayerIdentityFor(linked, "experiment")).toMatchObject({
      layer: { _tag: "CommandOnly" },
    });
  });

  it("混合矩阵逐 pair link，不从相邻 Eval 借 template，也不让 Experiment template 覆盖 Eval", () => {
    const sharedExperiment = sandboxLayer().prepare(stable("experiment.shared"));
    const linked = linkOk([
      sandboxPair({
        evalId: "eval/image",
        evalLayer: dockerImageSandbox({ image: "node:24" }),
        experimentLayer: sharedExperiment,
      }),
      sandboxPair({
        evalId: "eval/compose",
        evalLayer: dockerComposeSandbox({ file: "compose.yaml", workspaceService: "client" }),
        experimentLayer: sharedExperiment,
      }),
    ]);
    expect(linked).toHaveLength(2);
    expect(linked.map((entry) => entry.kind === "sandbox" && entry.template.kind)).toEqual(["image", "compose"]);

    const owningExperiment = e2bSandbox({ template: "codex-v3" });
    const error = linkError([
      sandboxPair({
        evalId: "eval/plain",
        evalLayer: sandboxLayer(),
        experimentLayer: owningExperiment,
      }),
      sandboxPair({
        evalId: "eval/compose",
        evalLayer: dockerComposeSandbox({ file: "compose.yaml", workspaceService: "client" }),
        experimentLayer: owningExperiment,
      }),
    ]);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]).toMatchObject({
      code: "sandbox.template-conflict",
      pair: { evalId: "eval/compose" },
    });
  });
});
