import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/error-classification/README.md
test.concurrent("未分类内部异常说明失败命令、执行阶段、原因和可行动的下一步", async () => {
  await cliE2E.case("internal-error-feedback", async ({ paths, commands: { niceeval } }) => {
    // Use the supported configuration module boundary to raise a synchronous
    // unclassified exception after module loading, when planning reads a value.
    // The installed CLI owns the actual Effect defect and its human rendering;
    // no private runtime, database, or implementation mock participates.
    await writeFile(
      join(paths.projectRoot, "niceeval.config.ts"),
      [
        'import { defineConfig, type Config } from "niceeval";',
        "const config: Config = {",
        "  ...defineConfig({}),",
        "  get maxConcurrency(): number {",
        '    throw new TypeError("unclassified planning defect canary");',
        "  },",
        "};",
        "export default config;",
        "",
      ].join("\n"),
      "utf8",
    );

    const failed = await niceeval.run(["exp", "deliberate-fail", "--dry"]);
    expect(failed.exitCode, failed.diagnostic()).toBe(2);
    expect(failed.stdout, failed.diagnostic()).toBe("");
    expect(failed.stderr, failed.diagnostic()).toContain("Internal defect during niceeval exp command execution.");
    expect(failed.stderr).toContain("Cause: unclassified planning defect canary");
    expect(failed.stderr).toContain("Next: report this failure");
    expect(failed.stderr).toContain("NiceEval version");
    expect(failed.stderr).not.toMatch(/^niceeval error:\s*(?:TypeError: )?unclassified planning defect canary\s*$/u);
    expect(failed.stderr).not.toMatch(/\bat .*\/src\//u);
  });
});
