import { only } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("install 声明完成安装循环，公开时间线使用 agent.install", async () => {
  await runnerE2E.case("agent-install-declaration", async ({ commands: { niceeval }, paths }) => {
    const source = join(paths.projectRoot, "experiments/agent-install-identity.ts");
    await writeFile(source, (await readFile(source, "utf8")).replace("ensure:", "install:"));
    const imported = await niceeval.run([
      "run",
      "import",
      join(paths.projectRoot, "fixtures/legacy-agent-install/record.sqlite"),
      "--json",
    ]);
    expect(imported.exitCode, imported.diagnostic()).toBe(0);
    const dry = await niceeval.run(["exp", "agent-install-identity", "--dry", "--json"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(dry.json()).reused).toBe(1);
    const run = await niceeval.run(["exp", "agent-install-identity", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const locator = only(run.expEvalEvents(), () => true).locator;
    const timing = await niceeval.run(["show", locator, "timing", "--json"]);
    expect(timing.exitCode, timing.diagnostic()).toBe(0);
    expect(timing.inspectionSuccess("attempt.timing").timing.activities).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "agent.install" })]),
    );
    expect(timing.stdout).not.toContain("agent.ensure");
    const shown = await niceeval.run(["show", locator, "timing"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("agent.install");
    expect(shown.stdout).not.toContain("agent.ensure");
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("旧 ensure 声明加载时仅警告一次并点名文件与 install 替换写法", async () => {
  await runnerE2E.case("agent-install-legacy-warning", async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "agent-install-identity", "--dry", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    const warnings = result.stderr
      .split("\n")
      .filter(
        (line) =>
          line.includes("deprecated") &&
          line.includes("ensure") &&
          line.includes("experiments/agent-install-identity.ts"),
      );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("experiments/agent-install-identity.ts");
    expect(warnings[0]).toContain("install");
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("同时声明 install 与 ensure 是定义错误", async () => {
  await runnerE2E.case("agent-install-conflict", async ({ commands: { niceeval }, paths }) => {
    const source = join(paths.projectRoot, "experiments/agent-install-identity.ts");
    await writeFile(source, (await readFile(source, "utf8")).replace("    ensure:", "    install: [],\n    ensure:"));
    const result = await niceeval.run(["exp", "agent-install-identity", "--dry", "--json"]);
    expect(result.exitCode, result.diagnostic()).not.toBe(0);
    expect(result.stderr).toMatch(/install.*ensure|ensure.*install/);
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("历史 Agent 安装相位通过公开 Record 读回时统一展示新名", async () => {
  await runnerE2E.case("agent-install-legacy-record", async ({ commands: { niceeval }, paths }) => {
    const record = join(paths.projectRoot, "fixtures/legacy-agent-install/record.sqlite");
    const locator = "@151915Q5R3N0J";
    const timing = await niceeval.run(["show", locator, "timing", "--record", record, "--json"]);
    expect(timing.exitCode, timing.diagnostic()).toBe(0);
    expect(timing.inspectionSuccess("attempt.timing").timing.activities).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "agent.install", label: "agent.install" })]),
    );
    expect(timing.stdout).not.toContain("agent.ensure");
    const shown = await niceeval.run(["show", locator, "--record", record, "timing"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("agent.install");
    expect(shown.stdout).not.toContain("agent.ensure");
  });
});
