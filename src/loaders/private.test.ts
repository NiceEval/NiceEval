// cases: docs/engineering/testing/unit/experiments-runner.md
// 覆盖「loadPrivate 的登记面」:进判据指纹格、与 criteria 分键、发现期约束。

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineDirectAgent, defineEval } from "../define.ts";
import { computeFingerprint } from "../runner/fingerprint.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "../runner/sandbox-selection.ts";
import { discoverEval, type AgentRun, type DiscoveredEval } from "../runner/types.ts";
import type { CapturedEvalSource } from "../runner/eval-source.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { captureLoadedFiles, loadPrivate } from "./index.ts";

const sourcePath = fileURLToPath(import.meta.url);
const source: CapturedEvalSource = { path: "evals/task/eval.ts", content: "", sha256: "0".repeat(64) };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/**
 * 返回 chdir 之后的 process.cwd():macOS 上 mkdtemp 的 /var/... 与它的 /private/var/... 不是
 * 同一字符串,loadPrivate 用 process.cwd() 作根,必须 chdir 到 realpath 后的 cwd。
 */
async function chdirProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-private-"));
  roots.push(root);
  await mkdir(join(root, "evals", "task", "reference"), { recursive: true });
  await writeFile(join(root, "evals", "task", "reference", "solution.sh"), "#!/bin/sh\nexit 0\n", "utf-8");
  await writeFile(join(root, "evals", "task", "eval.ts"), "export default {};\n", "utf-8");
  process.chdir(root);
  return process.cwd();
}

function makeEval(privatePaths?: readonly string[]): DiscoveredEval {
  return discoverEval(defineEval({ test() {} }), {
    id: "task",
    baseDir: join(process.cwd(), "evals/task"),
    sourcePath: join(process.cwd(), "evals/task/eval.ts"),
    source,
    loaderDataPaths: [],
    criteriaPaths: [],
    privatePaths: privatePaths ?? [],
  });
}

const run: AgentRun = {
  agent: defineDirectAgent({
    name: "agent-exp",
    evidenceCoverage: completeEvidenceCoverage,
    send: async () => ({ events: [], status: "completed" }),
  }),
  flags: {},
  attempts: 1,
  earlyExit: false,
  selectedEvalIds: ["task"],
  experimentId: "exp",
  experimentBaseDir: "/project/experiments",
  experimentSourcePath: "/project/experiments/exp.ts",
};

async function preparedPair(evalDef: DiscoveredEval): Promise<PreparedRunPair> {
  const [pair] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (pair === undefined) throw new Error("expected one prepared run pair");
  return pair;
}

describe("loadPrivate · 登记面", () => {
  it("改 private 文件一字节,引用它的 eval 指纹变;未登记的同路径改动不变", async () => {
    const prev = process.cwd();
    try {
      await chdirProject();
      const pattern = "evals/task/reference/**";
      const { privatePaths } = await captureLoadedFiles(() => loadPrivate(pattern));
      expect(privatePaths).toHaveLength(1);

      const before = await computeFingerprint(await preparedPair(makeEval(privatePaths)));
      await writeFile(join(process.cwd(), "evals/task/reference/solution.sh"), "#!/bin/sh\nexit 1\n", "utf-8");
      const after = await computeFingerprint(await preparedPair(makeEval(privatePaths)));
      expect(after).not.toBe(before);

      const untouched = await computeFingerprint(await preparedPair(makeEval()));
      const untouched2 = await computeFingerprint(await preparedPair(makeEval()));
      expect(untouched2).toBe(untouched);
    } finally {
      process.chdir(prev);
    }
  });

  it("发现期之外调用 loadPrivate 立即报错", async () => {
    await expect(loadPrivate("evals/**")).rejects.toThrow(/outside discovery|发现阶段之外/);
  });

  it("include pattern 匹配不到时报错", async () => {
    const prev = process.cwd();
    try {
      await chdirProject();
      await expect(captureLoadedFiles(() => loadPrivate("evals/task/missing/**"))).rejects.toThrow(
        /loadPrivate|private/,
      );
    } finally {
      process.chdir(prev);
    }
  });
});
