import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E as e2e } from "./context.ts";

// @concord-case necase_3HDDG0091KDYCM47
// @concord-owner docs/engineering/testing/e2e/cli.md#cli-init-inspection-guidance
// @concord-regression memory/init-inspection-guidance-drift.md
// @concord-test-file e2e/cli/test/init-inspection-guidance.test.ts
test.concurrent("init 生成可用于当前 CLI 的结果查看指引 [necase_3HDDG0091KDYCM47]", async () => {
  await e2e.case("init-inspection-guidance", async ({ paths, commands: { niceeval } }) => {
    const initialized = await niceeval.run(["init"]);
    expect(initialized.exitCode, initialized.diagnostic()).toBe(0);
    const rules = await readFile(join(paths.projectRoot, "AGENTS.md"), "utf8");
    expect(rules).toContain("`niceeval view --run <run-id>`");
    expect(rules).toContain("`niceeval show @<locator>`");
    expect(rules).toContain("`niceeval query`");
    expect(rules).not.toContain("optionally with an `@<locator>`");

    const viewHelp = await niceeval.run(["view", "--help"]);
    expect(viewHelp.exitCode, viewHelp.diagnostic()).toBe(0);
    expect(viewHelp.stdout).toContain("--run <run-id>");
    const showHelp = await niceeval.run(["show", "--help"]);
    expect(showHelp.exitCode, showHelp.diagnostic()).toBe(0);
    expect(showHelp.stdout).toContain("@<locator>");

    const refreshed = await niceeval.run(["init"]);
    expect(refreshed.exitCode, refreshed.diagnostic()).toBe(0);
    expect(await readFile(join(paths.projectRoot, "AGENTS.md"), "utf8")).toBe(rules);
  });
});
