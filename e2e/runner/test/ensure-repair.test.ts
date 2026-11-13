import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// @feature docs/feature/adapters/README.md
// @issue docs/issues/codex-ensure-reuploads-when-only-link-missing.md
test.concurrent("ensure 就地修复后复检，成功时不准备或上传 staged payload", async () => {
  await runnerE2E.case("ensure-repair", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "ensure-repair", "--rerun", "all", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ evalId: "ensure-repair", verdict: "passed" });
    expect(result.expReceipt().completion).toBe("completed");
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent.each(["repair-throws", "repair-misses"])("ensure 的 %s 保留安装回退路径", async (scenario) => {
  await runnerE2E.case(scenario, {}, async ({ commands: { niceeval }, paths }) => {
    const source = join(paths.projectRoot, "experiments/ensure-repair.ts");
    await writeFile(source, (await readFile(source, "utf8")).replace('const scenario: string = "repaired"', `const scenario: string = "${scenario}"`));
    const result = await niceeval.run(["exp", "ensure-repair", "--rerun", "all", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.stderr).toContain("ensure-repair-callback-entered");
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ verdict: "passed" });
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("verify-only 的 ensure 不执行 repair", async () => {
  await runnerE2E.case("ensure-verify-only", {}, async ({ commands: { niceeval }, paths }) => {
    const source = join(paths.projectRoot, "experiments/ensure-repair.ts");
    await writeFile(source, (await readFile(source, "utf8")).replace('const scenario: string = "repaired"', 'const scenario: string = "verify-only"'));
    const result = await niceeval.run(["exp", "ensure-repair", "--rerun", "all", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(1);
    expect(result.stderr).not.toContain("ensure-repair-callback-entered");
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ verdict: "errored" });
  });
});
