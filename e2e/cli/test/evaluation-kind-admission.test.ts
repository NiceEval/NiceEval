// rerun: pnpm e2e test --repo cli -- --run test/evaluation-kind-admission.test.ts

import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("运行与 check 在执行前拒绝混合 Pass Eval 与 Score Eval 的 Experiment 和 Eval Group [necase_9MQ99DC3XKAN6NNW]", async () => {
  await cliE2E.case("mixed-experiment-kinds", async ({ paths, commands: { niceeval } }) => {
    await writeFile(join(paths.projectRoot, "experiments", "mixed-evaluation-kinds.ts"), `
import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  agent: deterministicAgent("mixed-evaluation-kinds"),
  evals: ["greet", "deliberate-score"],
});
`);

    const receipt = await niceeval.run(["exp", "mixed-evaluation-kinds", "--json"]);

    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
    expect(receipt.stdout).toBe("");
    expect(receipt.stderr).toContain('Experiment "mixed-evaluation-kinds"');
    expect(receipt.stderr).toContain("pass (1): greet/hello");
    expect(receipt.stderr).toContain("score (1): deliberate-score/scored");
    expect(receipt.stderr).toContain("Split the Experiment");
    await expect(stat(join(paths.projectRoot, ".niceeval"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  await cliE2E.case("mixed-group-kinds", async ({ paths, commands: { niceeval } }) => {
    const groupDir = join(paths.projectRoot, "evals", "mixed-evaluation-kinds");
    await mkdir(groupDir, { recursive: true });
    await writeFile(join(groupDir, "eval-group.ts"), `
import { defineEvalGroup } from "niceeval";
import passEval from "../greet/hello.eval.ts";
import scoreEval from "../deliberate-score/scored.eval.ts";

export default defineEvalGroup({
  evals: [passEval, scoreEval],
  onUnavailable: "stop-group",
});
`);

    const receipt = await niceeval.run(["check", "normal"]);

    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
    expect(receipt.stdout).toBe("");
    expect(receipt.stderr).toContain('Eval Group "mixed-evaluation-kinds"');
    expect(receipt.stderr).toContain("pass (1): greet/hello");
    expect(receipt.stderr).toContain("score (1): deliberate-score/scored");
    expect(receipt.stderr).toContain("Split the Eval Group");
  });
});
