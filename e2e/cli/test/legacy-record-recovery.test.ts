import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E as e2e } from "./context.ts";

// @concord-case necase_CQYTFVY7A9TQCDFZ
// @concord-owner docs/engineering/testing/e2e/cli.md#cli-legacy-record-recovery
// @concord-regression memory/legacy-record-recovery-guidance.md
// @concord-test-file e2e/cli/test/legacy-record-recovery.test.ts
test.concurrent("旧项目状态拒绝写入并提供保留数据的恢复指引 [necase_CQYTFVY7A9TQCDFZ]", async () => {
  await e2e.case("legacy-record-recovery", async ({ paths, commands: { niceeval } }) => {
    // Hostile predecessor input, never a source of expected current Record facts.
    const legacyRoot = join(paths.projectRoot, ".niceeval", "locks");
    const legacyLock = join(legacyRoot, "unknown-owner.json");
    const legacyBytes = '{"owner":"unknown-predecessor","preserve":true}\n';
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(legacyLock, legacyBytes);

    const rejected = await niceeval.run(["exp", "normal", "--rerun", "all", "--json"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr).toContain("record-schema-unsupported");
    expect(rejected.stderr).toContain("No automatic migration is available");
    expect(rejected.stderr).toContain("Keep the original project and its .niceeval directory");
    expect(rejected.stderr).toContain("original NiceEval version");
    expect(rejected.stderr).toContain("separate project copy without .niceeval");
    expect(await readFile(legacyLock, "utf8")).toBe(legacyBytes);

    const guide = await readFile(join(paths.projectRoot, "node_modules", "niceeval", "docs-site", "zh", "tutorials", "agent-feedback-loop.mdx"), "utf8");
    expect(guide).not.toContain("niceeval migrate");
    const reference = await readFile(join(paths.projectRoot, "node_modules", "niceeval", "docs-site", "zh", "reference", "cli.mdx"), "utf8");
    expect(reference).not.toContain("`niceeval migrate`");
  });
});
