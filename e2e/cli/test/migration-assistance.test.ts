import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test.concurrent("旧 Judge 配置在执行前给出源码位置与离线英文迁移指南 [necase_YS0ZMXF74ZS12WD4]", async () => {
  await cliE2E.case("judge-migration", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await writeFile(join(projectRoot, "niceeval.config.ts"), [
      'import { defineConfig } from "niceeval";',
      'export default defineConfig({',
      '  judgeRuntime: { model: "old-model", apiKeyEnv: "OLD_JUDGE_KEY" },',
      '});',
    ].join("\n"));
    const result = await niceeval.run(["exp", "normal", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("judge-provider");
    expect(result.stderr).toMatch(/niceeval\.config\.ts:\d+:\d+/u);
    expect(result.stderr).toContain('from "niceeval/judge"');
    expect(result.stderr).toContain("OpenAIProvider");
    expect(result.stderr.match(/# Use an explicit Judge provider/gu)).toHaveLength(1);
    expect(result.stderr).toContain("OPENAI_API_KEY");
    expect(result.stderr).not.toContain("OLD_JUDGE_KEY=");
    await expect(stat(join(projectRoot, ".niceeval"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  await cliE2E.case("judge-migration-discovery", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    for (const name of ["old-a", "old-b"]) {
      await writeFile(join(projectRoot, "evals", `${name}.eval.ts`), [
        'import { defineEval } from "niceeval";',
        'export default defineEval({',
        '  judge: { model: "old-model" },',
        '  test() { throw new Error("BODY_MUST_NOT_RUN"); },',
        '});',
      ].join("\n"));
    }
    const result = await niceeval.run(["check", "normal"]);
    expect(result.exitCode, result.diagnostic()).toBe(1);
    expect(result.stderr).toContain("old-a.eval.ts");
    expect(result.stderr).toContain("old-b.eval.ts");
    expect(result.stderr).toContain("OpenAIProvider");
    expect(result.stderr.match(/# Use an explicit Judge provider/gu)).toHaveLength(1);
    expect(result.stderr).not.toContain("BODY_MUST_NOT_RUN");
    await expect(stat(join(projectRoot, ".niceeval"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
