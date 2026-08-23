# 配置 Coding Agent 扩展

Claude Code、Codex CLI 和 Bub 的 Adapter factory 可以在每个 attempt 开始前安装 Skills、MCP servers 和各自的原生扩展；Claude Code 与 Codex 还可以安装各自的官方原生配置文件。安装全部完成后，factory 的 `postSetup` Hook 在沙箱里按序运行用户脚本。扩展、配置文件与 Hook 作为 Agent 构造参数进入 experiment，便于组织可复现的 A/B 对比。

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

`path` 相对运行 niceeval 的项目根。Adapter 将内容写到目标 Agent 能发现的位置；路径不存在或内容无法安装时，setup 阶段写结构化执行错误通道事件，并形成该 Attempt 的 `errored` Verdict。

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

外部 Skill 建议固定 `ref`。仓库包含多个 Skill 时显式填写 `skills`；指定不存在的名称或无法识别多 Skill 仓库时，setup 失败并列出可选项。

## 添加 MCP Server

MCP server 有两种形态，按形状判别：本地 stdio 进程写 `command`，远程 Streamable HTTP 端点写 `url`。

```ts
const browser = {
  name: "browser",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-browser"],
  env: { BROWSER_AUTH_TOKEN: process.env.BROWSER_AUTH_TOKEN! },
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

插件生态的标准动作里有一类「装完插件后跑一次它自带的 setup 脚本」——写全局 hook、把插件自己的公开配置块登记进 agent 主配置。脚本只依赖固定 Plugin 文件和公开输入时，把它写进 Plugin 的 `install.after`；Adapter 会把它编译为可恢复的 Agent-owned action：

```ts
import type { SandboxCommand } from "niceeval/sandbox";

const agent = codexAgent({
  plugins: [{
    marketplace: { name: "nowledge-community", source: "nowledge/codex-plugins", ref: "v0.9.4" },
    name: "nowledge-mem",
    install: {
      after: command("python", ["scripts/install_hooks.py"]),
      changeFrequency: 30,
    },
  }],
});
```

Adapter 在 Invocation 内查找 `ref` 对应的完整 commit。相同 commit、sparse 选择、插件名、安装协议与安装后 recipe 命中同一前缀；tag 或 branch 推进后自动重新安装。

## 动态安装后 Hook：`postSetup`

需要 API key、远端 Space、cohort、租约或当前 Attempt identity 的动作不能进入共享安装前缀。把它声明成 factory 的 `postSetup` Hook：

```ts
const agent = codexAgent({
  plugins: [nowledgePlugin],
  postSetup: [bindCurrentSpace],
  preTeardown: [verifyRemoteStillReachable],
});
```

`postSetup` 复用 prepare command 的类型与窄上下文（`SandboxCommand` / `SandboxCommandContext`，见 [Sandbox Layer](../../sandbox/layers.md)）。
- 拿到 sandbox 句柄和 `signal`/`progress`/`diagnostic`/`facts`，不借用完整 `AgentContext`。
- `phase` 分别是 `agent.post-setup` / `agent.pre-teardown`，`owner` 是当前 agent。
- 多个 Hook 按数组顺序执行；成对的 `preTeardown` 数组承载收尾：按逆序、先于 agent teardown 执行（LIFO 镜像——`postSetup` 跑在 agent 安装之后，`preTeardown` 就跑在 agent 收尾之前），当且仅当 `postSetup` 的时点走到过才触发。
- Hook 通过 `onCleanup()` 登记的收尾在 `preTeardown` 之后按全局逆序执行；其中一项失败不会阻断后续收尾，失败最后一并上报。
- `niceeval debug <experiment> <eval>` 会在 Adapter 的 opaque setup / teardown 边界内展开 Hook；`shell()` / `command()` 显示脱敏后的声明，函数 callback 保持 opaque。
- Hook 抛错按基础设施错误计（结构化执行错误通道事件 → `errored` Verdict），不是 agent 解题失败；Attempt lifecycle 仍不使用 verdict token。

Hook 往 codex 全局配置里登记的 hook 不需要交互式信任确认即可生效——Codex Adapter 执行时绕过 codex 的 hook 信任门槛，见 [Codex CLI · 执行信任姿态](../sdk/codex-cli/README.md#执行信任姿态)。

## 与 Sandbox 复用组合

声明 `plugins` 的 Experiment 可以同时声明 `sandboxReuse: true`。固定 Plugin 安装通过准备前缀 restore 或 replay；动态 overlay 每条 Attempt 重做。Adapter 仍验证最终 provenance，不能把 `$HOME` 里恰好存在的同名目录当作命中。

两件事仍归作者：`postSetup` 脚本每条 attempt 都在残留的 `$HOME` 上重跑，必须可重复执行；Plugin 运行期要跨 attempt 留下的数据必须存在安装目录之外，安装目录每条 attempt 被重装覆写。
用例叙事见[插件实验开复用](../../sandbox/use-case/Sandbox复用/插件实验开复用.md)。

它与作者 sandbox layer 的分工只看相对 agent 安装的时机。与 agent 配置无关的准备逻辑进 Eval / Experiment layer 的 prepare command，跑在 agent 安装之前；要读写 agent 安装文件（插件文件、agent 主配置）的脚本进 `postSetup`，跑在 agent 安装之后。`postSetup` 是过程 Hook，不是配置声明——MCP、Skills、Plugin 仍走 factory 对应字段，Hook 不复制 factory 拥有的配置知识。

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

`settingsFile` 和 `configFile` 是运行 niceeval 的机器上的本地文件路径，不是 Sandbox 内路径；它们相对本地 niceeval 项目根定位，分别指向完整的 Claude Code `settings.json` 与 Codex `config.toml`。字段只接受项目根内的相对路径：`configs/codex/no-web.toml` 与 `./configs/codex/no-web.toml` 合法，包含 `..` 的路径、绝对路径、`~` 路径和解开符号链接后逃出项目根的路径都在 setup 阶段报错。

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

model、鉴权、MCP 和 OTel 导出由 experiment 与 Adapter 通过独立配置层或 CLI 参数叠加，对应的键不允许出现在原生配置文件里，冲突在 setup 阶段报错，不做静默改写。配置文件内容的 SHA-256 进入安装 checkpoint key；secret 走 env var，不写进配置文件。例外只有 Hermes——它的凭据面只认 `~/.hermes` 下的文件，落盘范围与理由见 [Hermes 页](../sdk/hermes/README.md)。每个 Agent 的保留键清单见页尾链接的各 Agent 页。

上例两边都关掉内置联网检索：评测答案能被搜到时，联网会污染通过率。注意原生配置只能关掉 Agent 的检索工具，挡不住它用 shell 命令访问网络；更强的网络隔离属于 Sandbox 层。

## 组织 A/B 实验

```ts
// experiments/skills/baseline.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: codexAgent(),
  attempts: 5,
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
  attempts: 5,
});
```

两个文件的路径只形成 experiment id。运行完成后，用 `niceeval show --experiment <baseline-id> --experiment <candidate-id> --page /comparison` 明确选择两组结果。每个文件只默认导出一个 `defineExperiment`；niceeval 不读取 `export const experiments = { ... }` 这种聚合导出。

model、reasoning effort 和业务 flags 仍由 experiment 配置；扩展内容属于 Agent 变体。`attempts` 默认跑满、给出完整通过率分布,两组 A/B 天然可比。

## 查看安装结果

Sandbox Agent setup 把安装 manifest 写入具名 Attempt channel。Report 可以读取实际安装的 Skill、出处、ref、插件、版本，以及原生配置文件的项目相对路径与 SHA-256；manifest 不保存配置文件正文。安装失败属于基础设施错误，写执行错误通道与 `errored` Verdict，不记作 Agent 解题失败。

每个 Agent 支持的字段和示例见：

- [Claude Code](../sdk/claude-code/README.md)
- [Codex CLI](../sdk/codex-cli/README.md)
- [Bub](../sdk/bub/README.md)
