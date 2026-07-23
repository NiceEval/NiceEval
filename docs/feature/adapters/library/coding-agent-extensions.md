# 配置 Coding Agent 扩展

Claude Code、Codex CLI 和 Bub 的 Adapter factory 可以在每个 attempt 开始前安装 Skills、MCP servers 和各自的原生扩展；Claude Code 与 Codex 还可以安装各自的官方原生配置文件。安装全部完成后，factory 的 `postSetup` 钩子在沙箱里按序运行用户脚本。扩展、配置文件与钩子作为 Agent 构造参数进入 experiment，便于组织可复现的 A/B 对比。

## 安装本地 Skill

```ts
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  skills: [
    { kind: "local", path: "skills/effect-ts/SKILL.md" },
    { kind: "local", path: "skills/repository-guide.md", name: "repository-guide" },
  ],
});
```

`path` 相对运行 niceeval 的项目根。Adapter 将内容写到目标 Agent 能发现的位置；路径不存在或内容无法安装时，attempt 在 setup 阶段报错。

## 安装 Repo Skill

```ts
const agent = claudeCodeAgent({
  skills: [{
    kind: "repo",
    source: "Effect-TS/skills",
    ref: "8f3c1a2",
    skills: ["effect", "effect-sql"],
  }],
});
```

外部 Skill 建议固定 `ref`。仓库包含多个 Skill 时显式填写 `skills`；指定不存在的名称或无法解析多 Skill 仓库时，setup 失败并列出可选项。

## 添加 MCP Server

MCP server 有两种形态，按形状判别：本地 stdio 进程写 `command`，远程 Streamable HTTP 端点写 `url`。

```ts
const browser = {
  name: "browser",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-browser"],
  env: { BROWSER_MODE: "headless" },
};

const memory = {
  name: "team-memory",
  url: "https://mem.example.com/mcp/",
  headers: { Authorization: `Bearer ${process.env.MEM_API_KEY}` },
};

const claude = claudeCodeAgent({ mcpServers: [browser, memory] });
const codex = codexAgent({ mcpServers: [browser, memory] });
```

`url` 必须是沙箱内可达的端点：沙箱在云端时，宿主机上的服务先经隧道（cloudflared / tailscale 等）暴露成公网 URL，再把隧道地址传进来。`headers` 逐字进入每个请求的 HTTP 头，常用于 `Authorization`。header 值与 stdio 形态的 `env` 同属 secret：manifest 对 stdio 只记 `name`/`command`/`args`，对 HTTP 只记 `name`/`url`，两者的敏感字段都不落盘。一个 server 同时写 `command` 和 `url` 属于配置错误，setup 阶段报错点名该 server。

MCP 只在 factory 构造时传入。需要条件变体时包装 factory 并合并数组，不在 Agent 构造后修改配置文件。

## 安装后运行脚本：`postSetup`

插件生态的标准动作里有一类「装完插件后跑一次它自带的 setup 脚本」——写全局 hook、把插件自己的配置块登记进 agent 主配置。这类脚本必须在 Adapter 全部安装步骤（写主配置、挂 MCP、装 Skills 与 Plugin、写 manifest）之后执行，否则它写下的配置会被后续步骤覆盖。把它声明成 factory 的 `postSetup` 钩子：

```ts
import type { SandboxHook } from "niceeval/sandbox";

const installMemHooks: SandboxHook = async (sandbox) => {
  await sandbox.runShell("python ~/.codex/plugins/nowledge-mem/scripts/install_hooks.py");
};

const agent = codexAgent({
  plugins: [{
    marketplace: { name: "nowledge-community", source: "nowledge/codex-plugins", ref: "v0.9.4" },
    name: "nowledge-mem",
  }],
  postSetup: [installMemHooks],
});
```

`postSetup` 复用沙箱钩子的类型与窄上下文（`SandboxHook` / `SandboxHookContext`，见 [Sandbox · 沙箱生命周期钩子](../../sandbox/library.md#沙箱生命周期钩子setup-teardown)）：拿到 sandbox 句柄和 `experimentId`/`signal`/`progress`/`diagnostic`，不借用完整 `AgentContext`。多个钩子按数组顺序执行；成对的 `preTeardown` 数组承载收尾：按逆序、先于 agent teardown 执行（LIFO 镜像——`postSetup` 跑在 agent 安装之后，`preTeardown` 就跑在 agent 收尾之前），当且仅当 `postSetup` 的时点走到过才触发（四层统一的成对语义见 [Runner · 环境预置](../../../runner.md#环境预置不进运行器但按顺序调它)）。钩子抛错按基础设施错误计（attempt errored），不是 agent 解题失败。

钩子往 codex 全局配置里登记的 hook 不需要交互式信任确认即可生效——Codex Adapter 执行时绕过 codex 的 hook 信任门槛，见 [Codex CLI · 执行信任姿态](../sdk/codex-cli/README.md#执行信任姿态)。

它与 `sandbox.setup()` 的分工只看相对 agent 安装的时机：与 agent 配置无关的环境预置进沙箱钩子（跑在 agent 安装之前）；要读写 agent 安装产物（插件文件、agent 主配置）的脚本进 `postSetup`（跑在 agent 安装之后）。`postSetup` 是过程钩子，不是配置声明——MCP、Skills、Plugin 仍走 factory 对应字段，钩子不复制 factory 拥有的配置知识。

## 使用官方原生配置文件

原生配置保留官方文件格式，不改写成 TypeScript 对象。先在项目里准备完整配置文件：

`configs/claude-code/no-web.json`：

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": { "deny": ["WebSearch", "WebFetch"] }
}
```

`configs/codex/no-web.toml`：

```toml
#:schema https://developers.openai.com/codex/config-schema.json
web_search = "disabled"
```

再把路径交给各自的 factory：

```ts
const claude = claudeCodeAgent({
  settingsFile: "configs/claude-code/no-web.json",
});

const codex = codexAgent({
  configFile: "configs/codex/no-web.toml",
});
```

`settingsFile` 和 `configFile` 是运行 niceeval 的机器上的本地文件路径，不是 Sandbox 内路径；它们相对本地 niceeval 项目根解析，分别指向完整的 Claude Code `settings.json` 与 Codex `config.toml`。字段只接受项目根内的相对路径：`configs/codex/no-web.toml` 与 `./configs/codex/no-web.toml` 合法，包含 `..` 的路径、绝对路径、`~` 路径和解析后逃出项目根的符号链接都在 setup 阶段报错。

项目根是执行 niceeval 时的当前工作目录，也就是包含 `niceeval.config.ts` 的目录；路径不相对 Eval、Experiment 或声明 Agent 的源码文件。文件可以分开放置：

```text
my-evals/
├── niceeval.config.ts
├── evals/web/search.eval.ts
├── experiments/web/no-search.ts
└── configs/codex/no-web.toml
```

即使 `codexAgent` 写在 `experiments/web/no-search.ts`，仍使用 `configFile: "configs/codex/no-web.toml"`，不写相对源码文件的 `../../configs/...`。项目根外的配置先复制到项目内再引用。

Adapter 先从本地读取原始字节，再上传到 Sandbox 的隔离 Agent 配置目录。它不继承宿主机的 `~/.claude/settings.json` 或 `~/.codex/config.toml`；传入文件原样替换 Sandbox 中原本为空的用户配置层，不做字符串拼接、deep merge 或重新序列化。仓库自己的项目级配置仍由被测 CLI 按官方优先级读取。

model、鉴权、MCP 和 OTel 导出由 experiment 与 Adapter 通过独立配置层或 CLI 参数叠加，对应的键不允许出现在原生配置文件里，冲突在 setup 阶段报错，不做静默覆盖。配置文件内容的 SHA-256 进入安装 checkpoint key；secret 走环境变量，不写进配置文件。每个 Agent 的保留键清单见页尾链接的各 Agent 页。

上例两边都关掉内置联网检索：评测答案能被搜到时，联网会污染通过率。注意原生配置只能关掉 Agent 的检索工具，挡不住它用 shell 命令访问网络；更强的网络隔离属于 Sandbox 层。

## 组织 A/B 实验

```ts
// experiments/skills/baseline.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: codexAgent(),
  runs: 5,
});
```

```ts
// experiments/skills/with-review-skill.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: codexAgent({
    skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  }),
  runs: 5,
});
```

两个文件的路径只形成 experiment id；运行或查看时用 `--exp skills` 一起选中即可比较。每个文件只默认导出一个 `defineExperiment`；niceeval 不读取 `export const experiments = { ... }` 这种聚合导出。

model、reasoning effort 和业务 flags 仍由 experiment 配置；扩展内容属于 Agent 变体。`runs` 默认跑满、给出完整通过率分布,两组 A/B 天然可比。

## 查看安装结果

Sandbox Agent setup 写出安装 manifest，attempt 结果保存实际安装的 Skill、来源、ref、插件、解析版本，以及原生配置文件的项目相对路径与 SHA-256；manifest 不保存配置文件正文。安装失败属于基础设施错误，不记作 Agent 解题失败。

每个 Agent 支持的字段和示例见：

- [Claude Code](../sdk/claude-code/README.md)
- [Codex CLI](../sdk/codex-cli/README.md)
- [Bub](../sdk/bub/README.md)
