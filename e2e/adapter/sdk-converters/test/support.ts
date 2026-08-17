import { join, resolve } from "node:path";
import {
  assertExpEvalOutcomes,
  createE2EContext,
} from "@niceeval/testkit";
import { expect } from "vitest";

/**
 * Tests run concurrently by default. Every case gets a disposable project and
 * the retained record lands in the ctx invocation + case namespace, so no two
 * workers can write the source scenario's .niceeval or JUnit roots.
 */
export const sdkConverterE2E = createE2EContext({
  repoId: "sdk-converters",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-sdk-converters-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

/** 每个 case 保留其 .niceeval 记录到 ctx 的 invocation/case namespace。 */
export const sdkConverterRecordArtifacts = {
  artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }],
} as const;

/**
 * Common public readback shell for one converter owner. Domain expectations
 * stay in each Eval; this helper only proves the owner was run, persisted and
 * readable through installed CLI entry points.
 */
export async function proveSdkConverterOwner(options: {
  experimentId: string;
  evalId: string;
  caseName: string;
  source: {
    file: string;
    content: string;
  };
  executionMarkers: readonly string[];
}): Promise<void> {
  await sdkConverterE2E.case(
    options.caseName,
    sdkConverterRecordArtifacts,
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", options.experimentId, "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      // The terminal stream event is the Record v1 InvocationReceipt; it carries
      // no verdicts, so business results come from each eval event's identity
      // and verdict below (docs/feature/experiments/cli.md).
      const receipt = run.expReceipt();
      expect(receipt.completion).toBe("completed");
      expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
      expect(receipt.runIds, run.diagnostic()).not.toHaveLength(0);
      const evalEvents = assertExpEvalOutcomes(
        run.expEvalEvents(),
        [
          // 通用 converter owner：锁定输入的协议断言与公开读回须一次全部成立，因此期望 passed/1。
          {
            evalId: options.evalId,
            experimentId: options.experimentId,
            verdict: "passed",
            attempts: 1,
            passed: 1,
          },
        ],
        () => run.diagnostic(),
      );
      const evalEvent = evalEvents[0]!;

      // receipt 的 runId 驱动公开读回(adapter/README.md「Live 验收说明」第 3 步)：
      // 运行已发布为完整 Run、slot included，selection 精确指向本轮 receipt。
      const shown = await niceeval.run(["show", "--run", receipt.runIds[0]!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const selection = shown
        .json<{ selection: { kind: "explicit-runs"; runIds: readonly string[] } }>()
        .selection;
      expect(selection.runIds, shown.diagnostic()).toEqual([receipt.runIds[0]!]);

      // locator 驱动的公开 source 读回：本轮 Eval 的 immutable source snapshot
      // 必须标出 recorded source、source availability，并呈现指定源码片段。
      const source = await niceeval.run(["show", evalEvent!.locator, "--source"]);
      expect(source.exitCode, source.diagnostic()).toBe(0);
      expect(source.stdout).toContain("Recorded source");
      expect(source.stdout).toContain(options.source.file);
      expect(source.stdout).toContain("sourceItem");
      expect(source.stdout).toContain("available");
      expect(source.stdout).toContain(options.source.content);

      // 同一 Attempt 仍带 runner 自己记录的实际阶段 timing。只读公开页面，既不
      // 新跑 Experiment，也不把 timing 反过来当作协议事件的判分依据。这些 direct
      // Agent 没有声明 setup，因此不能要求虚构的 agent.setup。
      const timing = await niceeval.run(["show", evalEvent!.locator, "--timing"]);
      expect(timing.exitCode, timing.diagnostic()).toBe(0);
      expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
      expect(timing.stdout, timing.diagnostic()).toMatch(/agent\.send\s+turn1\b/);

      // locator 驱动的真实执行读回(adapter/README.md「Live 验收说明」第 3 步)：
      // execution 页是「适配器收到了什么」的用户可见投影，逐项断言该 converter
      // 的真实 marker 落在公开读面上。
      const execution = await niceeval.run(["show", evalEvent!.locator, "--execution", "--json"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      for (const marker of options.executionMarkers) {
        expect(execution.stdout, execution.diagnostic()).toContain(marker);
      }
    },
  );
}
