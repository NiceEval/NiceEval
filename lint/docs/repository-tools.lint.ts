import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");
const execFileAsync = promisify(execFile);

interface ToolSkill {
  readonly path: string;
  readonly name: string;
  readonly command: string;
  readonly design: string;
  readonly body: string;
}

function frontmatter(markdown: string, path: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  expect(match, `${path} 缺 YAML frontmatter`).not.toBeNull();
  const value = parse(match?.[1] ?? "") as unknown;
  expect(value, `${path} frontmatter 必须是 object`).toBeTypeOf("object");
  expect(value, `${path} frontmatter 不得为空`).not.toBeNull();
  return value as Record<string, unknown>;
}

function toolSkills(root = ROOT): ToolSkill[] {
  const skills: ToolSkill[] = [];
  for (const directory of readdirSync(join(root, ".agents/skills"), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const path = `.agents/skills/${directory.name}/SKILL.md`;
    const body = readFileSync(join(root, path), "utf8");
    const header = frontmatter(body, path);
    const metadata = header.metadata;
    if (typeof metadata !== "object" || metadata === null) continue;
    const command = (metadata as Record<string, unknown>).command;
    const design = (metadata as Record<string, unknown>).design;
    if (command === undefined && design === undefined) continue;
    expect(command, `${path} metadata.command 必须是字符串`).toBeTypeOf("string");
    expect(design, `${path} metadata.design 必须是字符串`).toBeTypeOf("string");
    expect(header.name, `${path} name 应与目录一致`).toBe(directory.name);
    skills.push({
      path,
      name: directory.name,
      command: command as string,
      design: design as string,
      body,
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function commandArgs(command: string): readonly string[] {
  const match = /^pnpm ([a-z0-9:.-]+(?: [a-z0-9:.-]+)*)$/iu.exec(command);
  expect(match, `metadata.command 必须是无 shell 语法的 pnpm 入口: ${command}`).not.toBeNull();
  return match?.[1]?.split(" ") ?? [];
}

function scriptName(command: string): string {
  const args = commandArgs(command);
  const script = args[0] === "run" ? args[1] : args[0];
  expect(script, `metadata.command 缺少根 package script: ${command}`).toBeTypeOf("string");
  return script ?? "";
}

function linkDependencies(copy: string): void {
  const directories = [copy, ...readdirSync(copy, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name))];
  for (const directory of directories) {
    const dependencies = join(ROOT, relative(copy, directory), "node_modules");
    if (existsSync(dependencies)) symlinkSync(dependencies, join(directory, "node_modules"), "dir");
  }
}

function contentDigest(root: string): string {
  const digest = createHash("sha256");
  const visit = (path: string): void => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    digest.update(JSON.stringify([path, stat.mode]));
    if (stat.isSymbolicLink()) {
      digest.update(JSON.stringify(["symlink", readlinkSync(absolute)]));
    } else if (stat.isDirectory()) {
      digest.update("directory");
      for (const entry of readdirSync(absolute).sort()) visit(join(path, entry));
    } else {
      digest.update("file");
      digest.update(createHash("sha256").update(readFileSync(absolute)).digest());
    }
  };
  visit("");
  return digest.digest("hex");
}

describe("Repository Tools 动态发现", () => {
  it("AGENTS、Skill、设计与根 pnpm 入口形成直接关系", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = manifest.scripts ?? {};

    for (const skill of toolSkills()) {
      const script = scriptName(skill.command);
      expect(agents, `AGENTS.md 没有路由 ${skill.path}`).toContain(skill.path);
      expect(scripts, `${skill.command} 不存在`).toHaveProperty(script);
      expect(scripts[script], `${skill.command} 没有进入 NiceEval repository composition`).toMatch(/^tsx packages\/repo-tools\/src\/cli\.ts(?: |$)/u);
      expect(existsSync(join(ROOT, skill.design)), `${skill.path} 的 design 不存在: ${skill.design}`).toBe(true);
      expect(skill.body, `${skill.path} 没有把完整参数交给 --help`).toContain(`${skill.command} --help`);
    }
  });

  it("每个多步入口的 --help 离线、只读且成功", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "niceeval-help-"));
    try {
      const copy = join(temporary, "checkout");
      const archive = join(temporary, "head.tar");
      mkdirSync(copy);
      execFileSync("git", ["archive", "--format=tar", "--output", archive, "HEAD"], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });
      execFileSync("tar", ["-xf", archive, "-C", copy], { stdio: ["ignore", "pipe", "pipe"] });
      // The repository profile requires a Git root even for --help. Keep its metadata isolated too.
      execFileSync("git", ["-c", "init.templateDir=", "init", "--quiet", copy], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      linkDependencies(copy);
      const before = contentDigest(copy);
      const skills = toolSkills(copy);
      const results: PromiseSettledResult<void>[] = [];
      // Each help command starts pnpm, tsx and the CLI. Bound that startup load
      // on CI runners while retaining every command's own deadline and result.
      for (let offset = 0; offset < skills.length; offset += 2) {
        results.push(...await Promise.allSettled(skills.slice(offset, offset + 2).map(async (skill) => {
          const { stdout: output } = await execFileAsync("pnpm", [...commandArgs(skill.command), "--help"], {
            cwd: copy,
            encoding: "utf8",
            timeout: 20_000,
            killSignal: "SIGKILL",
          });
          expect(output, `${skill.command} --help 没有 usage`).toMatch(/usage:?/i);
        })));
      }
      expect(contentDigest(copy), "--help 改写了隔离副本").toBe(before);
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 180_000);

  it("不恢复中央命令清单或 capability 查询入口", () => {
    const manifest = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(manifest).not.toContain('"repo:capabilities"');
    expect(existsSync(join(ROOT, "docs/engineering/repository-capabilities/registry.json"))).toBe(false);
    expect(existsSync(join(ROOT, "packages/repo-tools/src/repository-capabilities.ts"))).toBe(false);
  });

  it("根 scripts 已退役，部署平台只调用正式 owner", () => {
    expect(existsSync(join(ROOT, "scripts")), "根 scripts/ 不应保留").toBe(false);

    const netlify = readFileSync(join(ROOT, "netlify.toml"), "utf8");
    expect(netlify).toContain('command = "pnpm preview:build"');
    expect(netlify).toContain('publish = ".netlify-view-preview"');
    expect(netlify).toContain("pretty_urls = false");
    expect(netlify).not.toMatch(/packages\/repo-tools\/src|NiceEval-Preview\.git|NETLIFY_AUTH_TOKEN/u);
    expect(existsSync(join(ROOT, "netlify-preview/build-report-preview.sh"))).toBe(false);
    expect(existsSync(join(ROOT, "netlify-preview/ignore-report-preview.sh"))).toBe(false);

    const rootManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const siteManifest = JSON.parse(readFileSync(join(ROOT, "apps/site/package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(rootManifest.scripts?.["site:build"]).toContain("@niceeval/site run build:deploy");
    expect(siteManifest.scripts?.["build:deploy"]).toContain("scripts/submit-indexnow.ts");
    expect(existsSync(join(ROOT, "apps/site/scripts/submit-indexnow.ts"))).toBe(true);
  });

  it("workflow 与 hook 不绕过正式入口调用 Repository Tools 源码或根 scripts", () => {
    const files = [
      ...readdirSync(join(ROOT, ".github/workflows"), { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
        .map((entry) => `.github/workflows/${entry.name}`),
      ...readdirSync(join(ROOT, ".husky"), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `.husky/${entry.name}`),
      "netlify.toml",
    ].filter((path) => existsSync(join(ROOT, path)));

    for (const path of files) {
      const text = readFileSync(join(ROOT, path), "utf8");
      expect(text, `${path} 直接调用 repo-tools 源码`).not.toMatch(/packages\/repo-tools\/src/);
      expect(text, `${path} 直接调用退役的根 scripts`).not.toMatch(/(?:^|\s)(?:node|tsx|bash|sh)\s+(?:\.\/)?scripts\//m);
    }
  });

  it("Skill 名称无重复且没有孤立设计路径", () => {
    const skills = toolSkills();
    expect(new Set(skills.map((skill) => skill.name)).size).toBe(skills.length);
    for (const skill of skills) {
      expect(basename(skill.path)).toBe("SKILL.md");
      expect(readFileSync(join(ROOT, skill.design), "utf8"), `${skill.design} 没有声明 ${skill.command}`)
        .toContain(skill.command);
    }
  });

});
