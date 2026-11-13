import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E as e2e } from "./context.ts";

// @use-case docs/feature/ai-native/use-case/upgrade-and-refresh.md
test.concurrent("init 刷新全部项目指引并保留用户内容", async () => {
  await e2e.case("init-inspection-guidance", async ({ paths, commands: { niceeval } }) => {
    await writeFile(join(paths.projectRoot, "AGENTS.md"), "User agents rules\n");
    await writeFile(join(paths.projectRoot, "CLAUDE.md"), "User claude rules\n");
    const initialized = await niceeval.run(["init"]);
    expect(initialized.exitCode, initialized.diagnostic()).toBe(0);
    const agents = await readFile(join(paths.projectRoot, "AGENTS.md"), "utf8");
    const claude = await readFile(join(paths.projectRoot, "CLAUDE.md"), "utf8");
    expect(agents).toContain("User agents rules\n");
    expect(claude).toContain("User claude rules\n");
    expect(agents).toContain("node_modules/niceeval/INDEX.md");
    expect(claude).toContain("node_modules/niceeval/INDEX.md");
    const codexSkill = await readFile(join(paths.projectRoot, ".agents/skills/niceeval/SKILL.md"), "utf8");
    const claudeSkill = await readFile(join(paths.projectRoot, ".claude/skills/niceeval/SKILL.md"), "utf8");
    expect(codexSkill).toBe(claudeSkill);
    expect(codexSkill).toContain("name: niceeval");
    expect(codexSkill).toContain("node_modules/niceeval/INDEX.md");
    expect(codexSkill).toContain("niceeval show");
    expect(codexSkill).toContain("niceeval query");
    expect(codexSkill).toContain("niceeval view");
    const refreshed = await niceeval.run(["init"]);
    expect(refreshed.exitCode, refreshed.diagnostic()).toBe(0);
    expect(await readFile(join(paths.projectRoot, "AGENTS.md"), "utf8")).toBe(agents);
    expect(await readFile(join(paths.projectRoot, "CLAUDE.md"), "utf8")).toBe(claude);
    expect(await readFile(join(paths.projectRoot, ".agents/skills/niceeval/SKILL.md"), "utf8")).toBe(codexSkill);
  });
});
