// cases: docs/engineering/unit-tests/adapters/cases.md
// Codex native plugin 安装(installPlugins)的单测:单 plugin 的命令构造、同名 marketplace
// 的去重、add 后的注册名回读校验、ref 钉定走 `--ref`(不像 claude-code 需要先 clone)、
// resolvedVersion 取不到时优雅省略(含 `codex plugin list --json` 的真实输出形状
// `{ installed: [...], available: [...] }`,字段名 `pluginId`——实测 codex-cli 0.144.1,
// 2026-07-13 native plugin e2e 复现过按裸数组 / `{ plugins: [...] }` 猜形状的旧版本恒返回
// undefined,见 memory/native-plugin-marketplace-name-not-caller-assignable.md)、
// marketplace/plugin 安装失败的报错;外加 configFile(原生配置文件)的 setup 流。
// 风格与 src/agents/skills.test.ts、src/agents/claude-code.test.ts 一致,不另起一套。
// 定稿见 docs/feature/adapters/architecture/coding-agent-extensions.md。
// bug: memory/native-plugin-marketplace-name-not-caller-assignable.md

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAgent, installPlugins, type CodexPluginSpec } from "./codex.ts";
import { createAgentSession } from "../context/session.ts";
import type { AgentContext, AgentSetupManifest, CommandOptions, CommandResult, McpServer, Sandbox, SandboxFile } from "../types.ts";

/** 内存沙箱:runShell 记命令(可按命令包含的子串打脚本化输出),uploadFile / writeFiles 记内容。 */
class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly commands: string[] = [];
  readonly uploads: { path: string; content: Buffer }[] = [];
  readonly written: Record<string, string> = {};
  script: { match: string; result: (cmd: string) => Partial<CommandResult> }[] = [];

  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    this.commands.push(script);
    const hit = this.script.find((s) => script.includes(s.match));
    const result = { stdout: "", stderr: "", exitCode: 0, ...hit?.result(script) };
    // 故意从 JSONL 中间切开，验证 adapter 自己负责跨 chunk 拼行，不依赖 provider 恰好
    // 一行一回调的幸运时序。
    if (result.stdout) {
      const split = Math.max(1, Math.floor(result.stdout.length / 2));
      await opts.onStdout?.(result.stdout.slice(0, split));
      await opts.onStdout?.(result.stdout.slice(split));
    }
    if (result.stderr) await opts.onStderr?.(result.stderr);
    return result;
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
    {
      match: "codex plugin marketplace list --json",
      result: () => ({ stdout: JSON.stringify({ marketplaces: [{ name: "acme" }] }) }),
    },
  ];
  return box;
};
const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

describe("codex installPlugins · 命令构造", () => {
  it("单 plugin:先连 marketplace(不带 --ref)再用 `plugin add` 装,manifest 记 marketplace/name", async () => {
    const box = sb();
    const plugins: CodexPluginSpec[] = [
      { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
    ];
    const out = await installPlugins(asSandbox(box), plugins);

    expect(box.commands).toEqual([
      "codex plugin marketplace add 'acme/codex-plugins'",
      "codex plugin marketplace list --json",
      "codex plugin add 'repo-map@acme'",
      "codex plugin list --json --marketplace 'acme'",
    ]);
    expect(out).toEqual([
      { agent: "codex", marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
    ]);
  });

  it("marketplace.sparse → add 命令带 --sparse(缺省不含由上面的精确命令断言覆盖);manifest 不记录 sparse", async () => {
    const box = sb();
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/codex-plugins", sparse: true }, name: "repo-map" },
    ]);
    expect(box.commands[0]).toBe("codex plugin marketplace add 'acme/codex-plugins' --sparse");
    expect(out[0]!.marketplace).toEqual({ name: "acme", source: "acme/codex-plugins" });
  });

  it("同名 marketplace 只连一次:两个 plugin 共用一个 marketplace.name → 只有一条 marketplace add,两条 plugin add", async () => {
    const box = sb();
    const plugins: CodexPluginSpec[] = [
      { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
      { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "safe-shell" },
    ];
    const out = await installPlugins(asSandbox(box), plugins);

    const marketplaceAdds = box.commands.filter((c) => c.startsWith("codex plugin marketplace add"));
    expect(marketplaceAdds).toHaveLength(1);
    const adds = box.commands.filter((c) => c.startsWith("codex plugin add"));
    expect(adds).toEqual(["codex plugin add 'repo-map@acme'", "codex plugin add 'safe-shell@acme'"]);
    expect(out.map((p) => p.name)).toEqual(["repo-map", "safe-shell"]);
    expect(out.every((p) => p.marketplace.name === "acme")).toBe(true);
  });

  it("ref 钉定:直接走 `marketplace add --ref`,不像 claude-code 需要先 clone;manifest 保留 ref", async () => {
    const box = sb();
    const plugins: CodexPluginSpec[] = [
      { marketplace: { name: "acme", source: "acme/codex-plugins", ref: "8f3c1a2" }, name: "repo-map" },
    ];
    const out = await installPlugins(asSandbox(box), plugins);

    expect(box.commands.some((c) => c.includes("git clone"))).toBe(false);
    const add = box.commands.find((c) => c.startsWith("codex plugin marketplace add"))!;
    expect(add).toBe("codex plugin marketplace add 'acme/codex-plugins' --ref '8f3c1a2'");

    expect(out).toEqual([
      {
        agent: "codex",
        marketplace: { name: "acme", source: "acme/codex-plugins", ref: "8f3c1a2" },
        name: "repo-map",
      },
    ]);
  });

  it("resolvedVersion:list 输出真实 `{ installed: [...] }` 形状、按 pluginId 命中 → manifest 记版本(实测 codex-cli 0.144.1)", async () => {
    const box = sb([
      {
        match: "codex plugin list --json",
        result: () => ({
          stdout: JSON.stringify({
            installed: [{ pluginId: "repo-map@acme", name: "repo-map", version: "2.0.0" }],
            available: [],
          }),
        }),
      },
    ]);
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
    ]);
    expect(out[0]?.resolvedVersion).toBe("2.0.0");
  });

  it("resolvedVersion:`installed` 条目缺 pluginId、只有 name 时按 name 命中 → manifest 记版本", async () => {
    const box = sb([
      {
        match: "codex plugin list --json",
        result: () => ({ stdout: JSON.stringify({ installed: [{ name: "repo-map", version: "2.1.0" }] }) }),
      },
    ]);
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
    ]);
    expect(out[0]?.resolvedVersion).toBe("2.1.0");
  });

  it("resolvedVersion 取不到时优雅省略(不阻断安装):list 命令失败 → manifest 里没有 resolvedVersion 键", async () => {
    const box = sb([{ match: "codex plugin list --json", result: () => ({ exitCode: 1 }) }]);
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("resolvedVersion");
  });

  it("resolvedVersion 取不到时优雅省略:list 输出不是合法 JSON(如空 stdout)同样不阻断安装", async () => {
    const box = sb(); // 默认 stdout 为空字符串,JSON.parse("") 抛错,installedVersion 内部吞掉
    const out = await installPlugins(asSandbox(box), [
      { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
    ]);
    expect(out[0]).not.toHaveProperty("resolvedVersion");
  });
});

describe("codex installPlugins · 失败语义", () => {
  it("marketplace 连接失败:抛错并点名 marketplace 名与来源,不继续装 plugin", async () => {
    const box = sb([{ match: "codex plugin marketplace add", result: () => ({ exitCode: 1, stderr: "boom" }) }]);
    await expect(
      installPlugins(asSandbox(box), [
        { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
      ]),
    ).rejects.toThrow(/acme/);
    expect(box.commands.some((c) => c.startsWith("codex plugin add"))).toBe(false);
  });

  it("plugin 安装失败:抛错并点名 plugin 名", async () => {
    const box = sb([{ match: "codex plugin add", result: () => ({ exitCode: 1, stderr: "boom" }) }]);
    await expect(
      installPlugins(asSandbox(box), [
        { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
      ]),
    ).rejects.toThrow(/repo-map/);
  });
});

describe("codex installPlugins · marketplace 名回读校验", () => {
  const plugins: CodexPluginSpec[] = [
    { marketplace: { name: "acme", source: "acme/codex-plugins" }, name: "repo-map" },
  ];

  it("add 静默注册成别的名字(仓库 manifest 的真实 name)→ 立刻抛带两个名字的错误,不走到 plugin add", async () => {
    const box = sb([
      {
        match: "codex plugin marketplace list --json",
        result: () => ({ stdout: JSON.stringify({ marketplaces: [{ name: "duyet-claude-plugins" }] }) }),
      },
    ]);
    const err = await installPlugins(asSandbox(box), plugins).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("acme");
    expect((err as Error).message).toContain("duyet-claude-plugins");
    expect(box.commands.some((c) => c.startsWith("codex plugin add"))).toBe(false);
  });

  it("回读命令失败 / 输出解析不出 → 按回读失败抛错,不静默放行", async () => {
    const failing = sb([
      { match: "codex plugin marketplace list --json", result: () => ({ exitCode: 1, stderr: "boom" }) },
    ]);
    await expect(installPlugins(asSandbox(failing), plugins)).rejects.toThrow(/marketplace/);

    const garbled = sb([{ match: "codex plugin marketplace list --json", result: () => ({ stdout: "not json" }) }]);
    await expect(installPlugins(asSandbox(garbled), plugins)).rejects.toThrow(/acme/);
  });
});

describe("codexAgent configFile · setup", () => {
  let root: string;
  let cwdBefore: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "niceeval-codex-config-"));
    cwdBefore = process.cwd();
    process.chdir(root); // configFile 相对项目根 = process.cwd()(docs 定稿口径)
  });

  afterEach(async () => {
    process.chdir(cwdBefore);
    await rm(root, { recursive: true, force: true });
  });

  const ctx = { model: "gpt-5", reasoningEffort: "high", flags: {} } as AgentContext;

  it("用户 config.toml 原始字节夹在 Adapter 顶层键与 Adapter 表之间(TOML 没有回到根表的语法);manifest 记路径 + SHA-256,不落正文", async () => {
    const body = '#:schema https://developers.openai.com/codex/config-schema.json\nweb_search = "disabled"\n';
    await mkdir(join(root, "configs"), { recursive: true });
    await writeFile(join(root, "configs/no-web.toml"), body);

    const box = sb();
    await codexAgent({ apiKey: "k", baseUrl: "https://s2a.example.com/v1", configFile: "configs/no-web.toml" }).setup!(
      asSandbox(box),
      ctx,
    );

    // 1) Adapter 顶层键先写(不带任何表头)
    const topLevelIdx = box.commands.findIndex((c) => c.includes("cat > ~/.codex/config.toml"));
    expect(topLevelIdx).toBeGreaterThan(-1);
    const topLevel = box.commands[topLevelIdx]!;
    expect(topLevel).toContain('model = "gpt-5"');
    expect(topLevel).toContain('model_reasoning_effort = "high"');
    expect(topLevel).not.toContain("[model_providers");

    // 2) 用户文件原始字节经 uploadFile 追加(不走会改字节的 heredoc / 重新序列化)
    expect(box.uploads).toHaveLength(1);
    expect(box.uploads[0]!.content.toString("utf8")).toBe(body);
    const appendIdx = box.commands.findIndex((c) => c.includes(`cat ${box.uploads[0]!.path} >> ~/.codex/config.toml`));
    expect(appendIdx).toBeGreaterThan(topLevelIdx);

    // 3) Adapter 的表([model_providers.s2a])最后追加
    const tableIdx = box.commands.findIndex((c) => c.includes("[model_providers.s2a]"));
    expect(tableIdx).toBeGreaterThan(appendIdx);
    expect(box.commands[tableIdx]!).toContain('base_url = "https://s2a.example.com/v1"');

    const manifest = JSON.parse(box.written["__niceeval__/agent-setup.json"]!) as AgentSetupManifest;
    expect(manifest.nativeConfigFile).toEqual({
      agent: "codex",
      path: "configs/no-web.toml",
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    expect(box.written["__niceeval__/agent-setup.json"]).not.toContain("web_search");
  });

  it("保留键([mcp_servers.x] 表头)出现在文件里 → setup 报错点名冲突键,不写沙箱配置", async () => {
    await writeFile(join(root, "bad.toml"), '[mcp_servers.browser]\ncommand = "npx"\n');
    const box = sb();
    await expect(
      codexAgent({ apiKey: "k", configFile: "bad.toml" }).setup!(asSandbox(box), ctx),
    ).rejects.toThrow(/mcp_servers/);
    expect(box.uploads).toHaveLength(0);
    expect(box.commands.some((c) => c.includes("config.toml"))).toBe(false);
  });

  it("没配 configFile 时布局与从前一致:一次 heredoc 写完顶层键 + provider 表,无 uploadFile", async () => {
    const box = sb();
    await codexAgent({ apiKey: "k", baseUrl: "https://s2a.example.com/v1" }).setup!(asSandbox(box), ctx);
    const write = box.commands.find((c) => c.includes("cat > ~/.codex/config.toml"))!;
    expect(write).toContain('model_reasoning_effort = "high"');
    expect(write).toContain("[model_providers.s2a]");
    expect(box.uploads).toHaveLength(0);
    expect(box.written["__niceeval__/agent-setup.json"]).toBeUndefined();
  });
});

describe("codexAgent · live step feedback", () => {
  it("逐块消费 codex --json stdout，把 tool 与 assistant step 送进 progress，完整 transcript 仍正常解析", async () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "item.started", item: { type: "command_execution", id: "cmd-1", command: "pnpm test" } }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", id: "cmd-1", command: "pnpm test", exit_code: 0 } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "All tests passed." } }),
    ].join("\n") + "\n";
    const box = sb([{ match: "codex exec", result: () => ({ stdout }) }]);
    const progress: string[] = [];
    const ctx: AgentContext = {
      signal: new AbortController().signal,
      flags: {},
      sandbox: asSandbox(box),
      session: createAgentSession(),
      progress: (update) => progress.push(update.message),
      diagnostic() {},
      log() {},
    };

    const turn = await codexAgent({ apiKey: "test-key" }).send!({ text: "run the tests" }, ctx);

    expect(progress).toEqual([
      "tool: pnpm test",
      "tool: pnpm test · completed",
      "assistant: All tests passed.",
    ]);
    expect(turn.events).toMatchObject([
      { type: "action.called", name: "command_execution", tool: "shell" },
      { type: "action.result", callId: "cmd-1", status: "completed" },
      { type: "message", role: "assistant", text: "All tests passed." },
    ]);
    expect(ctx.session.id).toBe("thread-1");
  });
});

describe("codexAgent mcpServers · 形态落位", () => {
  const ctx = { flags: {} } as AgentContext;

  it("HTTP 形态:url 行 + [mcp_servers.<name>.http_headers] 子表;manifest 只记 name/url,headers 值不落盘", async () => {
    const box = sb();
    await codexAgent({
      apiKey: "k",
      mcpServers: [
        { name: "team-memory", url: "https://mem.example.com/mcp/", headers: { Authorization: "Bearer sekret" } },
      ],
    }).setup!(asSandbox(box), ctx);

    const mcp = box.commands.find((c) => c.includes("[mcp_servers.team-memory]"))!;
    expect(mcp).toContain('url = "https://mem.example.com/mcp/"');
    expect(mcp).toContain("[mcp_servers.team-memory.http_headers]");
    expect(mcp).toContain('"Authorization" = "Bearer sekret"');
    expect(mcp).not.toContain("command =");

    const manifestRaw = box.written["__niceeval__/agent-setup.json"]!;
    const manifest = JSON.parse(manifestRaw) as AgentSetupManifest;
    expect(manifest.mcpServers).toEqual([{ name: "team-memory", url: "https://mem.example.com/mcp/" }]);
    expect(manifestRaw).not.toContain("sekret");
  });

  it("边界:HTTP 形态无 headers → 不写空 http_headers 子表", async () => {
    const box = sb();
    await codexAgent({
      apiKey: "k",
      mcpServers: [{ name: "team-memory", url: "https://mem.example.com/mcp/" }],
    }).setup!(asSandbox(box), ctx);

    const mcp = box.commands.find((c) => c.includes("[mcp_servers.team-memory]"))!;
    expect(mcp).toContain('url = "https://mem.example.com/mcp/"');
    expect(mcp).not.toContain("http_headers");
  });

  it("反例:同一 server 同时给出 command 与 url → setup 报错点名该 server,不写 MCP 块", async () => {
    const box = sb();
    // 形状判别不设 kind 标签,双字段的错误配置在类型上可能混得进来 —— 运行期兜底点名报错。
    const dup = { name: "dup-server", command: "npx", url: "https://x.example.com/mcp" } as McpServer;
    await expect(codexAgent({ apiKey: "k", mcpServers: [dup] }).setup!(asSandbox(box), ctx)).rejects.toThrow(
      /dup-server/,
    );
    expect(box.commands.some((c) => c.includes("[mcp_servers."))).toBe(false);
  });
});

describe("codexAgent postSetup · 安装后钩子", () => {
  const mkCtx = (): AgentContext =>
    ({
      flags: {},
      experimentId: "exp-1",
      signal: new AbortController().signal,
      progress: () => {},
      diagnostic: () => {},
    }) as unknown as AgentContext;

  it("钩子在 Adapter 安装与 manifest 之后按数组顺序执行,拿到 SandboxHook 窄上下文", async () => {
    const box = sb();
    const seen: string[] = [];
    let manifestPresentAtHook = false;
    await codexAgent({
      apiKey: "k",
      mcpServers: [{ name: "browser", command: "npx" }],
      postSetup: [
        async (sandbox, hookCtx) => {
          manifestPresentAtHook = box.written["__niceeval__/agent-setup.json"] !== undefined;
          seen.push(`a:${hookCtx.experimentId}`);
          await sandbox.runShell("post-hook-a");
        },
        async (sandbox) => {
          seen.push("b");
          await sandbox.runShell("post-hook-b");
        },
      ],
    }).setup!(asSandbox(box), mkCtx());

    expect(seen).toEqual(["a:exp-1", "b"]);
    expect(manifestPresentAtHook).toBe(true);
    const configIdx = box.commands.findIndex((c) => c.includes("config.toml"));
    const aIdx = box.commands.indexOf("post-hook-a");
    const bIdx = box.commands.indexOf("post-hook-b");
    expect(aIdx).toBeGreaterThan(configIdx);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it("钩子返回的 cleanup 合成一个闭包交还 runner,按 LIFO 执行", async () => {
    const box = sb();
    const order: string[] = [];
    const cleanup = await codexAgent({
      apiKey: "k",
      postSetup: [() => () => void order.push("a"), () => () => void order.push("b")],
    }).setup!(asSandbox(box), mkCtx());

    expect(typeof cleanup).toBe("function");
    await (cleanup as () => Promise<void> | void)();
    expect(order).toEqual(["b", "a"]);
  });

  it("反例:钩子抛错从 setup 传播(attempt errored 通道)", async () => {
    const box = sb();
    await expect(
      codexAgent({
        apiKey: "k",
        postSetup: [
          () => {
            throw new Error("hook boom");
          },
        ],
      }).setup!(asSandbox(box), mkCtx()),
    ).rejects.toThrow("hook boom");
  });
});
