// cases: docs/engineering/unit-tests/adapters/cases.md
// Claude Code native plugin 安装(installPlugins)的单测:单 plugin 的命令构造、同名
// marketplace 的去重、add 后的注册名回读校验、ref 钉定时改走 clone+checkout+本地路径连接、
// resolvedVersion 取不到时优雅省略、marketplace/plugin 安装失败的报错;外加 settingsFile
// (原生配置文件)的 setup 流。沙箱是内存 fake,风格与 src/agents/skills.test.ts 一致
// (记命令的 FakeSandbox + 按命令前缀打脚本),不另起一套。
// 定稿见 docs/feature/adapters/architecture/coding-agent-extensions.md。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAgent, installPlugins, type ClaudeCodePluginSpec } from "./claude-code.ts";
import type { AgentContext, AgentSetupManifest, CommandResult, Sandbox, SandboxFile } from "../types.ts";

/** 内存沙箱:runShell 记命令(可按命令包含的子串打脚本化输出),uploadFile / writeFiles 记内容。 */
class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly commands: string[] = [];
  readonly uploads: { path: string; content: Buffer }[] = [];
  readonly written: Record<string, string> = {};
  script: { match: string; result: (cmd: string) => Partial<CommandResult> }[] = [];

  async runShell(script: string): Promise<CommandResult> {
    this.commands.push(script);
    const hit = this.script.find((s) => script.includes(s.match));
    return { stdout: "", stderr: "", exitCode: 0, ...hit?.result(script) };
  }
  async writeFiles(files: Record<string, string>): Promise<void> {
    Object.assign(this.written, files);
  }
  async uploadFile(path: string, content: Buffer): Promise<void> {
    this.uploads.push({ path, content });
  }
  async uploadFiles(_files: SandboxFile[]): Promise<void> {}
  async fileExists(): Promise<boolean> {
    return false;
  }
  async readFile(): Promise<string> {
    throw new Error("not used in this test");
  }
}

const sb = (s?: FakeSandbox["script"]): FakeSandbox => {
  const box = new FakeSandbox();
  // add 后的注册名回读默认回到配置名(校验通过);mismatch 用例把自己的脚本放前面覆盖。
  box.script = [
    ...(s ?? []),
    { match: "claude plugin marketplace list --json", result: () => ({ stdout: JSON.stringify([{ name: "acme" }]) }) },
  ];
  return box;
};
const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

describe("claude-code installPlugins · 命令构造", () => {
  it("单 plugin:先连 marketplace 再装 plugin,manifest 记 marketplace/name(无 ref 时不带 ref 键)", async () => {
    const box = sb();
    const plugins: ClaudeCodePluginSpec[] = [
      { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
    ];
    const out = await installPlugins(asSandbox(box), plugins);

    expect(box.commands).toEqual([
      "claude plugin marketplace add 'acme/claude-code-plugins'",
      "claude plugin marketplace list --json",
      "claude plugin install 'safe-shell@acme'",
      "claude plugin list --json",
    ]);
    expect(out).toEqual([
      { agent: "claude-code", marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
    ]);
  });

  it("同名 marketplace 只连一次:两个 plugin 共用一个 marketplace.name → 只有一条 marketplace add,两条 install", async () => {
    const box = sb();
    const plugins: ClaudeCodePluginSpec[] = [
      { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
      { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "repo-map" },
    ];
    const out = await installPlugins(asSandbox(box), plugins);

    const marketplaceAdds = box.commands.filter((c) => c.startsWith("claude plugin marketplace add"));
    expect(marketplaceAdds).toHaveLength(1);
    const installs = box.commands.filter((c) => c.startsWith("claude plugin install"));
    expect(installs).toEqual(["claude plugin install 'safe-shell@acme'", "claude plugin install 'repo-map@acme'"]);
    expect(out.map((p) => p.name)).toEqual(["safe-shell", "repo-map"]);
    expect(out.every((p) => p.marketplace.name === "acme")).toBe(true);
  });

  it("ref 钉定:先 git clone + checkout,再以本地 clone 路径连接 marketplace(claude CLI 没有钉 ref 的入口);manifest 保留 ref", async () => {
    const box = sb();
    const plugins: ClaudeCodePluginSpec[] = [
      { marketplace: { name: "acme", source: "acme/claude-code-plugins", ref: "v1.3.0" }, name: "safe-shell" },
    ];
    const out = await installPlugins(asSandbox(box), plugins);

    const clone = box.commands.find((c) => c.includes("git clone"))!;
    expect(clone).toContain("https://github.com/acme/claude-code-plugins.git");
    expect(clone).not.toContain("--depth 1"); // ref 可能是任意 commit,浅克隆 checkout 不到
    expect(clone).toContain("checkout --quiet 'v1.3.0'");
    const cloneDir = /rm -rf '([^']+)'/.exec(clone)?.[1];
    expect(cloneDir).toBeTruthy();

    // marketplace add 用的是 clone 出来的本地路径,不是原始 "acme/claude-code-plugins" 字符串
    const add = box.commands.find((c) => c.startsWith("claude plugin marketplace add"))!;
    expect(add).toBe(`claude plugin marketplace add '${cloneDir}'`);

    expect(out).toEqual([
      {
        agent: "claude-code",
        marketplace: { name: "acme", source: "acme/claude-code-plugins", ref: "v1.3.0" },
        name: "safe-shell",
      },
    ]);
  });

  it("resolvedVersion:装完读 `claude plugin list --json` 命中 → manifest 记版本", async () => {
    const box = sb([
      {
        match: "claude plugin list --json",
        result: () => ({ stdout: JSON.stringify([{ id: "safe-shell@acme", version: "1.2.3" }]) }),
      },
    ]);
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
    ]);
    expect(out[0]?.resolvedVersion).toBe("1.2.3");
  });

  it("resolvedVersion 取不到时优雅省略(不阻断安装):list 命令失败 → manifest 里没有 resolvedVersion 键", async () => {
    const box = sb([{ match: "claude plugin list --json", result: () => ({ exitCode: 1 }) }]);
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("resolvedVersion");
  });

  it("resolvedVersion 取不到时优雅省略:list 输出不是合法 JSON(如空 stdout)同样不阻断安装", async () => {
    const box = sb(); // 默认 stdout 为空字符串,JSON.parse("") 抛错,installedVersion 内部吞掉
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
    ]);
    expect(out[0]).not.toHaveProperty("resolvedVersion");
  });
});

describe("claude-code installPlugins · 失败语义", () => {
  it("marketplace 连接失败:抛错并点名 marketplace 名与来源,不继续装 plugin", async () => {
    const box = sb([{ match: "claude plugin marketplace add", result: () => ({ exitCode: 1, stderr: "boom" }) }]);
    await expect(
      installPlugins(asSandbox(box), [
        { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
      ]),
    ).rejects.toThrow(/acme/);
    expect(box.commands.some((c) => c.startsWith("claude plugin install"))).toBe(false);
  });

  it("plugin 安装失败:抛错并点名 plugin 名", async () => {
    const box = sb([{ match: "claude plugin install", result: () => ({ exitCode: 1, stderr: "boom" }) }]);
    await expect(
      installPlugins(asSandbox(box), [
        { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
      ]),
    ).rejects.toThrow(/safe-shell/);
  });
});

describe("claude-code installPlugins · marketplace 名回读校验", () => {
  const plugins: ClaudeCodePluginSpec[] = [
    { marketplace: { name: "acme", source: "acme/claude-code-plugins" }, name: "safe-shell" },
  ];

  it("add 静默注册成别的名字(仓库 manifest 的真实 name)→ 立刻抛带两个名字的错误,不走到 plugin install", async () => {
    const box = sb([
      {
        match: "claude plugin marketplace list --json",
        result: () => ({ stdout: JSON.stringify([{ name: "duyet-claude-plugins" }]) }),
      },
    ]);
    const err = await installPlugins(asSandbox(box), plugins).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("acme");
    expect((err as Error).message).toContain("duyet-claude-plugins");
    expect(box.commands.some((c) => c.startsWith("claude plugin install"))).toBe(false);
  });

  it("回读命令失败 → 按回读失败抛错,不静默放行", async () => {
    const box = sb([
      { match: "claude plugin marketplace list --json", result: () => ({ exitCode: 1, stderr: "boom" }) },
    ]);
    await expect(installPlugins(asSandbox(box), plugins)).rejects.toThrow(/marketplace/);
  });

  it("回读输出解析不出(未知形状)→ 同样按回读失败抛错", async () => {
    const box = sb([
      { match: "claude plugin marketplace list --json", result: () => ({ stdout: "not json" }) },
    ]);
    await expect(installPlugins(asSandbox(box), plugins)).rejects.toThrow(/acme/);
  });
});

describe("claudeCodeAgent settingsFile · setup", () => {
  let root: string;
  let cwdBefore: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "niceeval-claude-settings-"));
    cwdBefore = process.cwd();
    process.chdir(root); // settingsFile 相对项目根 = process.cwd()(docs 定稿口径)
  });

  afterEach(async () => {
    process.chdir(cwdBefore);
    await rm(root, { recursive: true, force: true });
  });

  const ctx = {} as AgentContext; // 本组用例不配 postSetup,setup 不会读 ctx 的字段

  it("原始字节原样上传并 mv 成用户级 ~/.claude/settings.json;manifest 记项目相对路径 + SHA-256,不落正文", async () => {
    const body = '{\n  "$schema": "https://json.schemastore.org/claude-code-settings.json",\n  "permissions": { "deny": ["WebSearch", "WebFetch"] }\n}\n';
    await mkdir(join(root, "configs"), { recursive: true });
    await writeFile(join(root, "configs/no-web.json"), body);

    const box = sb();
    await claudeCodeAgent({ apiKey: "k", settingsFile: "./configs/no-web.json" }).setup!(asSandbox(box), ctx);

    // 原始字节走 uploadFile(不走会补换行的 heredoc),再 mv 到用户层落点
    expect(box.uploads).toHaveLength(1);
    expect(box.uploads[0]!.content.toString("utf8")).toBe(body);
    const mv = box.commands.find((c) => c.includes("~/.claude/settings.json"))!;
    expect(mv).toContain(`mv ${box.uploads[0]!.path} ~/.claude/settings.json`);

    const manifest = JSON.parse(box.written["__niceeval__/agent-setup.json"]!) as AgentSetupManifest;
    expect(manifest.nativeConfigFile).toEqual({
      agent: "claude-code",
      path: "configs/no-web.json",
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    expect(box.written["__niceeval__/agent-setup.json"]).not.toContain("permissions");
  });

  it("保留键(model / env)出现在文件里 → setup 报错点名冲突键,什么都不上传", async () => {
    await writeFile(join(root, "bad.json"), '{ "model": "opus", "permissions": {} }');
    const box = sb();
    await expect(
      claudeCodeAgent({ apiKey: "k", settingsFile: "bad.json" }).setup!(asSandbox(box), ctx),
    ).rejects.toThrow(/model/);
    expect(box.uploads).toHaveLength(0);
    expect(box.written["__niceeval__/agent-setup.json"]).toBeUndefined();
  });

  it("路径不存在 / 逃出项目根 → setup 报错(attempt errored 的通道)", async () => {
    const box = sb();
    await expect(
      claudeCodeAgent({ apiKey: "k", settingsFile: "configs/nope.json" }).setup!(asSandbox(box), ctx),
    ).rejects.toThrow(/configs\/nope\.json/);
    await expect(
      claudeCodeAgent({ apiKey: "k", settingsFile: "../escape.json" }).setup!(asSandbox(box), ctx),
    ).rejects.toThrow(/相对路径|relative/);
  });

  it("没配 settingsFile 时不碰 settings.json,也不为它写 manifest", async () => {
    const box = sb();
    await claudeCodeAgent({ apiKey: "k" }).setup!(asSandbox(box), ctx);
    expect(box.uploads).toHaveLength(0);
    expect(box.commands.some((c) => c.includes("settings.json"))).toBe(false);
    expect(box.written["__niceeval__/agent-setup.json"]).toBeUndefined();
  });
});

describe("claudeCodeAgent mcpServers · 形态落位", () => {
  const ctx = {} as AgentContext;

  it("HTTP 形态写成 ~/.claude.json 的 type http + url + headers 条目,stdio 条目不变;manifest 只记非 secret 字段", async () => {
    const box = sb();
    await claudeCodeAgent({
      apiKey: "k",
      mcpServers: [
        { name: "browser", command: "npx", args: ["-y", "server"], env: { TOKEN: "env-sekret" } },
        { name: "team-memory", url: "https://mem.example.com/mcp/", headers: { Authorization: "Bearer sekret" } },
      ],
    }).setup!(asSandbox(box), ctx);

    // 用户级 MCP 配置经 heredoc 写进 ~/.claude.json(shared.writeFile),内容在命令里。
    const write = box.commands.find((c) => c.includes("cat > ~/.claude.json"))!;
    expect(write).toContain('"type": "http"');
    expect(write).toContain('"url": "https://mem.example.com/mcp/"');
    expect(write).toContain('"Authorization": "Bearer sekret"');
    expect(write).toContain('"command": "npx"');

    const manifestRaw = box.written["__niceeval__/agent-setup.json"]!;
    const manifest = JSON.parse(manifestRaw) as AgentSetupManifest;
    expect(manifest.mcpServers).toEqual([
      { name: "browser", command: "npx", args: ["-y", "server"] },
      { name: "team-memory", url: "https://mem.example.com/mcp/" },
    ]);
    expect(manifestRaw).not.toContain("sekret");
  });

  it("边界:HTTP 形态无 headers → 条目不带 headers 字段", async () => {
    const box = sb();
    await claudeCodeAgent({
      apiKey: "k",
      mcpServers: [{ name: "team-memory", url: "https://mem.example.com/mcp/" }],
    }).setup!(asSandbox(box), ctx);

    const write = box.commands.find((c) => c.includes("cat > ~/.claude.json"))!;
    expect(write).toContain('"type": "http"');
    expect(write).not.toContain("headers");
  });
});
