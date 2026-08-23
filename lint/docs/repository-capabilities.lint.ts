import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

interface Registry {
  workflows: Array<{ script: string; skill?: string }>;
}

interface CatalogEntry {
  script: string;
}

function pnpm(args: string[]): string {
  return execFileSync("pnpm", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("仓库能力入口", () => {
  it("每个根 package script 都有设计 owner，多步工作流都有实现与守护", () => {
    const receipt = JSON.parse(pnpm(["repo:capabilities", "check", "--json"])) as {
      ok: boolean;
      problems: string[];
    };
    expect(receipt).toEqual({ ok: true, problems: [] });
  });

  it("设计入口实际列出每个正式命令", () => {
    const catalog = readFileSync(
      join(ROOT, "docs/engineering/repository-capabilities/README.md"),
      "utf8",
    );
    const entries = JSON.parse(pnpm(["repo:capabilities", "list", "--json"])) as CatalogEntry[];
    for (const entry of entries) {
      expect(catalog, `能力目录没有展示 pnpm ${entry.script}`).toContain(`pnpm ${entry.script}`);
    }
  });

  it("多步工作流的 Skill 指向同一个 pnpm --help 入口", () => {
    const registry = JSON.parse(readFileSync(
      join(ROOT, "docs/engineering/repository-capabilities/registry.json"),
      "utf8",
    )) as Registry;
    for (const workflow of registry.workflows) {
      if (!workflow.skill) continue;
      const skill = readFileSync(join(ROOT, workflow.skill), "utf8");
      expect(skill, `${workflow.skill} 没有路由到 ${workflow.script}`).toContain(`pnpm ${workflow.script} --help`);
    }
  });

  it("多步命令的 --help 只读且成功", () => {
    const before = readFileSync(join(ROOT, "docs/writing-rules.json"), "utf8");
    const registry = JSON.parse(readFileSync(
      join(ROOT, "docs/engineering/repository-capabilities/registry.json"),
      "utf8",
    )) as Registry;
    for (const workflow of registry.workflows) {
      const output = pnpm([workflow.script, "--help"]);
      expect(output, `${workflow.script} --help 没有 usage`).toMatch(/usage:?/i);
    }
    expect(readFileSync(join(ROOT, "docs/writing-rules.json"), "utf8")).toBe(before);
  }, 20_000);

  it("嵌套命令把 -- 后的字面参数交给叶子命令", () => {
    expect(pnpm(["docs:terms", "list", "--", "--literal-pattern"])).toBe("No banned terms matched.\n");
  });

  it("禁词 add/remove 的 dry-run 给出完整结果但不写规则文件", () => {
    const file = join(ROOT, "docs/writing-rules.json");
    const before = readFileSync(file, "utf8");
    const rules = JSON.parse(before) as { bannedTerms: Array<{ term: string }> };
    const probe = "__docs_terms_dry_run_probe__";
    const added = JSON.parse(pnpm([
      "docs:terms",
      "add",
      probe,
      "--use",
      "specific action",
      "--why",
      "the probe verifies dry-run behavior",
      "--dry-run",
    ])) as { bannedTerms: Array<{ term: string }> };
    expect(added.bannedTerms.some((entry) => entry.term === probe)).toBe(true);

    const removed = JSON.parse(pnpm([
      "docs:terms",
      "remove",
      rules.bannedTerms[0].term,
      "--dry-run",
    ])) as { bannedTerms: Array<{ term: string }> };
    expect(removed.bannedTerms.some((entry) => entry.term === rules.bannedTerms[0].term)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  }, 20_000);
});
