import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runProcess } from "@niceeval/testkit";
import { cliBinary, cliE2E as e2e } from "./context.ts";

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

// @feature docs/feature/ai-native/README.md
test.concurrent.each([
  ["missing end", "<!-- BEGIN:niceeval-agent-rules -->\n"],
  ["missing begin", "<!-- END:niceeval-agent-rules -->\n"],
  ["reversed", "<!-- END:niceeval-agent-rules -->\n<!-- BEGIN:niceeval-agent-rules -->\n"],
  ["duplicate", "<!-- BEGIN:niceeval-agent-rules -->\n<!-- END:niceeval-agent-rules -->\n<!-- BEGIN:niceeval-agent-rules -->\n<!-- END:niceeval-agent-rules -->\n"],
])("init 在写入前拒绝损坏的规则标记 %s", async (_kind, markers) => {
  await e2e.case("init-invalid-markers", async ({ paths, commands: { niceeval } }) => {
    const agents = `User rules\n${markers}`;
    const claude = "User claude rules\n";
    await writeFile(join(paths.projectRoot, "AGENTS.md"), agents);
    await writeFile(join(paths.projectRoot, "CLAUDE.md"), claude);
    const result = await niceeval.run(["init"]);
    expect(result.exitCode, result.diagnostic()).not.toBe(0);
    expect(result.stderr).toContain("agent-rules-markers-invalid");
    expect(result.stderr).toContain("AGENTS.md:2");
    expect(await readFile(join(paths.projectRoot, "AGENTS.md"), "utf8")).toBe(agents);
    expect(await readFile(join(paths.projectRoot, "CLAUDE.md"), "utf8")).toBe(claude);
    await expect(access(join(paths.projectRoot, ".agents/skills/niceeval/SKILL.md"))).rejects.toThrow();
  });
});

// @feature docs/feature/ai-native/README.md
test.concurrent("init 保留用户自己的同名 skill 并拒绝所有指引写入", async () => {
  await e2e.case("init-user-skill", async ({ paths, commands: { niceeval } }) => {
    await mkdir(join(paths.projectRoot, ".agents/skills/niceeval"), { recursive: true });
    await writeFile(join(paths.projectRoot, ".agents/skills/niceeval/SKILL.md"), "User skill\n");
    await writeFile(join(paths.projectRoot, "AGENTS.md"), "User rules\n");
    const result = await niceeval.run(["init"]);
    expect(result.exitCode, result.diagnostic()).not.toBe(0);
    expect(result.stderr).toContain("agent-skill-not-managed");
    expect(await readFile(join(paths.projectRoot, "AGENTS.md"), "utf8")).toBe("User rules\n");
    expect(await readFile(join(paths.projectRoot, ".agents/skills/niceeval/SKILL.md"), "utf8")).toBe("User skill\n");
    await expect(access(join(paths.projectRoot, ".claude/skills/niceeval/SKILL.md"))).rejects.toThrow();
  });
});

// @feature docs/feature/ai-native/README.md
test.concurrent("子包 init 在 Git 根写入可读取的索引路径与命令", async () => {
  await e2e.case("init-package-path", async ({ paths, run }) => {
    const git = await run(["git", "init"]);
    expect(git.exitCode, git.diagnostic()).toBe(0);
    const packageRoot = join(paths.projectRoot, "tools/evals");
    await mkdir(packageRoot, { recursive: true });
    await symlink(join(paths.projectRoot, "node_modules"), join(packageRoot, "node_modules"), "dir");
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ type: "module", packageManager: "pnpm@11.18.0" }));
    const result = await runProcess([...cliBinary, "init"], { cwd: packageRoot });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    const agents = await readFile(join(paths.projectRoot, "AGENTS.md"), "utf8");
    expect(agents).toContain("tools/evals/node_modules/niceeval/INDEX.md");
    expect(agents).toContain("pnpm --dir 'tools/evals' exec niceeval");
    await expect(access(join(packageRoot, "AGENTS.md"))).rejects.toThrow();
  });
});

// @feature docs/feature/ai-native/README.md
test.concurrent("init 在索引未落盘时说明安装限制且不写指引", async () => {
  await e2e.case("init-missing-index", async ({ paths }) => {
    const packageRoot = join(paths.projectRoot, "missing-dependency");
    await mkdir(packageRoot);
    const result = await runProcess([...cliBinary, "init"], { cwd: packageRoot });
    expect(result.exitCode, result.diagnostic()).not.toBe(0);
    expect(result.stderr).toContain("bundled-docs-not-on-disk");
    expect(result.stderr).toContain("Plug'n'Play");
    await expect(access(join(packageRoot, "AGENTS.md"))).rejects.toThrow();
    await expect(access(join(packageRoot, ".agents/skills/niceeval/SKILL.md"))).rejects.toThrow();
  });
});
