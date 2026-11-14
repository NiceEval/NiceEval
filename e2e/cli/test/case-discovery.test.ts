import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/eval/README.md
// @regression memory/case-directory-descendant-discovery.md
test.concurrent("Case 目录的嵌套仓库是资产，普通文件入口旁的子目录仍被发现", async () => {
  await cliE2E.case("case-discovery", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const definition = 'import { defineEval } from "niceeval"; export default defineEval({ test() {} });\n';
    for (const [path, content] of [
      ["case-boundary/task/eval.ts", definition],
      ["case-boundary/task/repo/eval.ts", 'throw new Error("ASSET_EVAL_IMPORTED");'],
      ["case-boundary/task/repo/nested.eval.ts", 'throw new Error("ASSET_FILE_IMPORTED");'],
      ["case-boundary/task/repo/nested.eval.tsx", 'throw new Error("ASSET_TSX_IMPORTED");'],
      ["case-boundary/task/repo/eval-group.ts", 'throw new Error("ASSET_GROUP_IMPORTED");'],
      ["case-boundary/plain.eval.ts", definition],
      ["case-boundary/plain/child.eval.ts", definition],
    ]) {
      const file = join(projectRoot, "evals", path!);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content!);
    }
    await writeFile(
      join(projectRoot, "experiments", "case-boundary.ts"),
      [
        'import { defineExperiment } from "niceeval";',
        'import { deterministicAgent } from "../agents/deterministic.ts";',
        'export default defineExperiment({ adapter: deterministicAgent("case-discovery"), model: "deterministic", evals: ["case-boundary"] });',
      ].join("\n"),
    );
    const receipt = await niceeval.run(["exp", "case-boundary", "--dry", "--json"]);
    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    const plan = decodeExpPlanDocument(receipt.json());
    expect(plan.matrix.map(({ evalId }) => evalId).sort()).toEqual([
      "case-boundary/plain",
      "case-boundary/plain/child",
      "case-boundary/task",
    ]);
  });
});
