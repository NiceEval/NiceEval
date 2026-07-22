// cases: docs/engineering/testing/unit/experiments-runner.md

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineEval, e2bSandbox, localSandbox, vercelSandbox } from "../define.ts";
import type { Agent, DiscoveredEval } from "../types.ts";
import type { AgentRun } from "./types.ts";
import { computeFingerprint } from "./fingerprint.ts";
import {
  prepareRunSandboxes,
  resolvedSandboxRecommendedConcurrency,
  sandboxForEval,
  sandboxProjection,
} from "./sandbox-selection.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function agent(kind: "sandbox" | "remote"): Agent {
  return { name: `${kind}-agent`, kind } as Agent;
}

async function evalDef(id: string, environment?: string): Promise<DiscoveredEval> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-sandbox-selection-"));
  roots.push(root);
  const sourcePath = join(root, "case.eval.ts");
  await writeFile(sourcePath, "export default { test() {} };\n");
  return {
    id,
    environment,
    baseDir: root,
    sourcePath,
    source: { path: "evals/case.eval.ts", content: "export default { test() {} };\n", sha256: "source" },
    test() {},
  };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    agent: agent("sandbox"),
    flags: {},
    runs: 1,
    earlyExit: true,
    selectedEvalIds: [],
    experimentId: "profiles/run",
    ...overrides,
  };
}

describe("eval-level sandbox selection", () => {
  it("environments 查表:profile 换预制产物,未声明的 eval 用基础产物且不进 sandboxByEval", async () => {
    const py39 = await evalDef("astropy/old", "python-3.9-astropy-4.2");
    const node18 = await evalDef("legacy/node", "node-18-legacy");
    const plain = await evalDef("weather/basic");
    const selected = run({
      sandbox: e2bSandbox({
        template: "niceeval-agents",
        environments: {
          "python-3.9-astropy-4.2": { template: "niceeval-py39-astropy42" },
          "node-18-legacy": { template: "niceeval-node18" },
        },
      }),
      selectedEvalIds: ["astropy/old", "legacy/node", "weather/basic"],
    });

    prepareRunSandboxes([py39, node18, plain], [selected]);
    expect(sandboxForEval(selected, py39)).toMatchObject({ provider: "e2b", template: "niceeval-py39-astropy42" });
    expect(sandboxForEval(selected, node18)).toMatchObject({ provider: "e2b", template: "niceeval-node18" });
    expect(sandboxForEval(selected, plain)).toMatchObject({ provider: "e2b", template: "niceeval-agents" });

    const projection = sandboxProjection(selected);
    expect(projection.sandbox).toMatchObject({ provider: "e2b", params: { template: "niceeval-agents" } });
    expect(projection.sandboxByEval).toMatchObject({
      "astropy/old": { provider: "e2b", params: { template: "niceeval-py39-astropy42" } },
      "legacy/node": { provider: "e2b", params: { template: "niceeval-node18" } },
    });
    expect(projection.sandboxByEval).not.toHaveProperty("weather/basic");

    const [oldFingerprint, nodeFingerprint, plainFingerprint] = await Promise.all([
      computeFingerprint(py39, selected),
      computeFingerprint(node18, selected),
      computeFingerprint(plain, selected),
    ]);
    expect(oldFingerprint).not.toBe(nodeFingerprint);
    expect(oldFingerprint).not.toBe(plainFingerprint);
  });

  it("选中 eval 的 profile 缺表项在创建 sandbox 前穷举报错;defineEval 拒绝空 profile", async () => {
    expect(() => defineEval({ environment: "  ", test() {} })).toThrow(/environment.*non-empty profile id/);

    const missingA = await evalDef("astropy/old", "python-3.9-astropy-4.2");
    const missingB = await evalDef("legacy/node", "node-18-legacy");
    const bare = run({
      sandbox: e2bSandbox({ template: "niceeval-agents" }),
      selectedEvalIds: ["astropy/old", "legacy/node"],
    });
    let thrown: Error | undefined;
    try {
      prepareRunSandboxes([missingA, missingB], [bare]);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toMatch(/profiles\/run/);
    expect(thrown?.message).toMatch(/astropy\/old → "python-3\.9-astropy-4\.2"/);
    expect(thrown?.message).toMatch(/legacy\/node → "node-18-legacy"/);
    expect(thrown?.message).toMatch(/environments/);
  });

  it("provider 推荐并发取所有解析结果的最小值;remote agent 零查表", async () => {
    const item = await evalDef("astropy/old", "python-3.9-astropy-4.2");
    const plain = await evalDef("weather/basic");
    const e2bRun = run({
      sandbox: e2bSandbox({
        template: "niceeval-agents",
        environments: { "python-3.9-astropy-4.2": { template: "niceeval-py39-astropy42" } },
      }),
      selectedEvalIds: ["astropy/old", "weather/basic"],
    });
    const vercelRun = run({
      experimentId: "profiles/vercel",
      sandbox: vercelSandbox({ snapshotId: "snap_base" }),
      selectedEvalIds: ["weather/basic"],
    });
    expect(resolvedSandboxRecommendedConcurrency([item, plain], [e2bRun])).toBe(20);
    expect(resolvedSandboxRecommendedConcurrency([plain], [e2bRun, vercelRun])).toBe(1);

    // local:同一棵真实工作树不允许并发写,推荐值同样是 1(见 docs/runner.md「调度:有界并发」)——
    // 与 vercel 的 1 出于不同理由(session 限流 vs 独占串行正确性约束),数值恰好相同。
    const localRun = run({
      experimentId: "profiles/local",
      sandbox: localSandbox(),
      selectedEvalIds: ["weather/basic"],
    });
    expect(resolvedSandboxRecommendedConcurrency([plain], [localRun])).toBe(1);

    const remote = run({
      agent: agent("remote"),
      sandbox: e2bSandbox({ template: "niceeval-agents" }),
      selectedEvalIds: ["astropy/old"],
    });
    expect(() => prepareRunSandboxes([item], [remote])).not.toThrow();
    expect(resolvedSandboxRecommendedConcurrency([item], [remote])).toBe(10);
    expect(sandboxProjection(remote)).toEqual({});
    expect(remote.resolvedSandboxes).toBeUndefined();
  });
});
