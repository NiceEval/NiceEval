# Coding Agent Skills / Plugins DX

这篇只讨论沙箱型 coding agent adapter:Claude Code、Codex、bub 这类 CLI agent 如何在 niceeval 里安装 skill 与 plugin,并让实验可以 A/B 对比它们的收益。

先定词:

- **Skill** 是模型上下文。它告诉 agent "遇到某类任务时怎么想、怎么写、用哪些约定"。典型形态是一个本地 Markdown / `SKILL.md`,或一个可以用 `npx skill add` 安装的 repo skill。
- **Plugin** 是可执行能力。它给 agent 增加工具、MCP server、Python package、hook 或其它运行时扩展。它可能也带文档,但核心价值是让 agent 能调用新的东西。

不要把两者混在一个 `flags.skill = true` 里。skill 影响 prompt / context,plugin 影响工具面 / runtime;这两个维度要能独立打开,否则无法判断收益来自"指导更清楚"还是"多了工具"。

## 设计目标

1. **实验决定装什么。** base agent 只知道怎么跑 Claude Code / Codex / bub;某次实验要不要加 skill / plugin,在 experiment 里表达,而不是 CLI 位置参数或全局 config。
2. **adapter 负责翻译。** niceeval core 不知道 Claude Code 怎么读 skill、Codex 配置文件在哪、bub 插件怎么装。统一配置只到 adapter 边界,再由具体 adapter 翻译成它自己的安装动作。
3. **安装发生在 `setup`。** 每个 attempt 的沙箱建好后、第一次 `send` 前安装。多轮会话不能在每轮 `send` 里重装。
4. **结果可对比。** 同一组 eval 应该能跑 `baseline`、`with-local-skill`、`with-installed-skill`、`with-plugin` 四类实验,报告里 agent 名字要带出变体。
5. **选择要显式。** 一个 repo 里有多个 skill 时,必须能选择其中几个;不要默认把整个 repo 全部启用。

## 目标 API

建议内置 coding-agent adapter 都收敛到同一组概念字段:

```typescript
type SkillSpec =
  | {
      kind: "local";
      path: string;          // repo 内文件或目录,如 "skills/zod.md" / "skills/ponytail/SKILL.md"
      name?: string;         // 展示名;省略则由文件名推导
    }
  | {
      kind: "repo";
      source: string;        // "owner/repo" 或 git URL,传给 npx skill add
      skills?: string[];     // repo 内只启用这些 skill;省略 = repo 只有一个 skill 时可接受
      ref?: string;          // 可选 pin:tag / commit / branch
    };

type PluginSpec =
  | {
      kind: "mcp";
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      kind: "python";
      package: string;       // bub:uv tool install --with <package>
    }
  | {
      kind: "agent-native";
      source: string;        // 预留给 Claude Code / Codex 自己的 plugin installer
      plugins?: string[];    // repo 内选择其中几个 plugin
      ref?: string;
    };
```

在 experiment 里使用:

```typescript
import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { claudeCodeAgent, codexAgent, bubAgent } from "niceeval/adapter";

export default defineExperiment({
  description: "codex + local zod skill",
  agent: codexAgent({
    name: "codex+zod-skill",
    skills: [{ kind: "local", path: "examples/zh/coding-agent-skill/skills/zod.md" }],
  }),
  model: "gpt-5.4",
  sandbox: dockerSandbox(),
});
```

当前代码里 `claudeCodeAgent` / `codexAgent` 已有 `skills?: string[]` 和 `mcpServers?: McpServer[]`,`bubAgent` 已有 `pythonPlugins?: string[]`。上面的 `SkillSpec` / `PluginSpec` 是 DX 目标:把已有字符串数组升级成可选择、可 pin、可解释的结构。

## Skill 两种来源

### 1. 本地 skill

本地 skill 适合团队内部规范、项目知识、API 使用约定、迁移指南。`examples/zh/coding-agent-skill/` 当前就是这个形状:实验 wrapper 在 `setup` 阶段把 `skills/zod.md` 写成工作区 `CLAUDE.md`,让 Claude Code 自动读到。

目标 DX 不应该要求每个实验手写 wrapper。adapter 应提供统一注入:

```typescript
const agent = claudeCodeAgent({
  name: "claude-code+zod",
  skills: [{ kind: "local", path: "skills/zod.md" }],
});
```

adapter 翻译规则:

| Agent | 本地 skill 注入 |
|---|---|
| Claude Code | 写入工作区 `CLAUDE.md`,或写入 Claude Code 原生 skill 目录(如果当前 CLI 版本支持) |
| Codex | 写入工作区 `AGENTS.md` / Codex skill 目录,保持和 Codex CLI 当前读取规则一致 |
| bub | 写入工作区 `AGENTS.md` 或 bub 支持的项目说明文件;如果 bub 没有原生 skill 概念,就把 skill 作为明确的 project instruction 注入 |

规则是:本地 skill 是 eval fixture 的一部分,应该随 repo 签入,并被沙箱上传 / 写入;不要依赖用户机器上的全局 skill 状态。

### 2. `npx skill add` 安装的 skill

第三方 skill 适合复用公开仓库,也适合把一个组织维护的 skill repo 分发给多项目。DX 应支持:

```typescript
const agent = claudeCodeAgent({
  name: "claude-code+effect-sql",
  skills: [
    {
      kind: "repo",
      source: "Effect-TS/skills",
      skills: ["effect", "effect-sql"],
      ref: "8f3c1a2",
    },
  ],
});
```

安装流程放在 `setup`:

```sh
npx skill add Effect-TS/skills --ref 8f3c1a2 --only effect --only effect-sql
```

如果实际 installer 叫 `skills add` 或选择参数不是 `--only`,这是 adapter 的翻译细节;文档层只要求表达能力:

- `source` 指明装哪个 repo;
- `ref` 固定版本,保证 eval 可复现;
- `skills` 在多 skill repo 中选择启用集合;
- 安装后写 lock/artifact,让 `.niceeval/<run>/` 能看见实际安装了什么。

选择规则:

| 情况 | 行为 |
|---|---|
| repo 只有一个 skill,`skills` 省略 | 可以安装并启用这个 skill |
| repo 有多个 skill,`skills` 省略 | adapter 应 fail fast,错误里列出可选 skill,要求显式选择 |
| 指定的 skill 不存在 | adapter 应 fail fast,把 source/ref/skill 名写进错误 |
| 同一个 skill 既本地又 repo 安装 | 不自动合并;按配置顺序注入,并在 agent 名字或安装 manifest 中保留来源 |

## Plugin 设计

plugin 不应该通过 skill 文本偷偷安装。它改变运行时能力,必须独立配置,否则 trace / tool 调用 / 失败诊断会很难读。

### MCP plugin

Claude Code 和 Codex 都能走 MCP 这条共同抽象。DX:

```typescript
const agent = codexAgent({
  name: "codex+browser-mcp",
  plugins: [
    {
      kind: "mcp",
      name: "browser",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-browser"],
    },
  ],
});
```

adapter 翻译:

| Agent | MCP 写入位置 |
|---|---|
| Claude Code | `~/.claude.json` 顶层 `mcpServers` 字段(不是 `~/.claude/claude.json`——后者 claude CLI 不读) |
| Codex | `~/.codex/config.toml` 的 `[mcp_servers.<name>]`(复数——单数 `[mcp_server.x]` 会被 codex 静默忽略) |
| bub | 不支持——没有 MCP 概念,`kind: "mcp"` 对 bub agent fail fast |

MCP 只有一条进入路径:adapter factory 的构造期配置(现为 `mcpServers`,未来收敛进 `plugins`)。不提供「给已构造 Agent 后置追加 MCP」的原语——那会把两家 CLI 配置文件的格式知识复制出 factory,并在中立模块里引入按 `agent.name` 分发的行为分支。条件包装器(如"只在某个实验变体上多挂一个 MCP server")的正确姿势是接收 factory 而不是已构造的 Agent,在包装内部把 MCP 并进构造入参——这条规则管的是**构造期配置**(MCP / skills / model),不管**环境预置**:按实验变化的环境准备(装二进制、预热、写 hook 文件、载入/回存跨 attempt 状态)不写进 Agent wrapper,挂在 `experiment.sandbox` 的 `.setup()` / `.teardown()` 链式钩子上,见 [Sandbox · 沙箱生命周期钩子](../sandbox.md#沙箱生命周期钩子setup--teardown)。

### bub Python plugin

bub 当前更自然的 plugin 面是 Python package:

```typescript
const agent = bubAgent({
  name: "bub+otel-memory",
  plugins: [
    { kind: "python", package: "bub-plugin-memory" },
    { kind: "python", package: "git+https://github.com/acme/bub-tools.git" },
  ],
});
```

adapter 翻译为:

```sh
uv tool install --reinstall --python 3.12 --prerelease allow bub --with <package>
```

这类 plugin 应进安装 checkpoint 的 hash。否则一次 eval 装了插件、下一次没装插件却复用了缓存,结果会污染。

### agent-native plugin

给未来 Claude Code / Codex 原生 plugin installer 预留:

```typescript
const agent = claudeCodeAgent({
  name: "claude-code+org-plugin",
  plugins: [
    {
      kind: "agent-native",
      source: "acme/coding-agent-plugins",
      plugins: ["safe-shell", "repo-map"],
      ref: "v1.3.0",
    },
  ],
});
```

和 repo skill 一样:多 plugin repo 必须显式选择,安装结果要落 manifest。

## A/B 组织方式

不要用 CLI flag 临时开关 skill/plugin。用 experiment 文件表达可比组:

```text
experiments/
└── skill-ab/
    ├── baseline.ts
    ├── claude-zod-local.ts
    ├── codex-zod-local.ts
    ├── claude-ponytail-repo.ts
    └── bub-python-plugin.ts
```

每个文件引用一个明确 agent 变体:

```typescript
export default defineExperiment({
  description: "claude-code + ponytail repo skill",
  agent: claudeCodeAgent({
    name: "claude-code+ponytail",
    skills: [{ kind: "repo", source: "DietrichGebert/ponytail", skills: ["ponytail"], ref: "..." }],
  }),
  model: "claude-sonnet-4-6",
  evals: (id) => id.startsWith("ponytail-"),
  runs: 3,
  earlyExit: false,
});
```

这样 `niceeval exp skill-ab` 的含义清楚:同一批任务,不同 agent 上下文 / runtime 变体。`niceeval view` 里也能直接按 agent 名比较通过率、成本、工具调用和 diff 质量。

## 安装 Manifest

adapter 在 setup 结束后应写一份标准 manifest 到沙箱和结果工件,例如:

```json
{
  "agent": "codex+zod-local",
  "skills": [
    { "kind": "local", "name": "zod", "path": "skills/zod.md", "sha256": "..." },
    { "kind": "repo", "source": "Effect-TS/skills", "ref": "8f3c1a2", "skills": ["effect"] }
  ],
  "plugins": [
    { "kind": "mcp", "name": "browser", "command": "npx" }
  ]
}
```

建议路径:

- 沙箱内:`__niceeval__/agent-setup.json`
- 结果目录:`.niceeval/<run>/<eval>/<attempt>/agent-setup.json`

这份 manifest 不参与评分,但用于复现和诊断:"这次失败到底有没有装 skill"应该能从 artifact 一眼确认。

## 失败语义

skill/plugin 安装失败是 **errored**,不是 agent 做题失败:

- 本地 skill 路径不存在;
- `npx skill add` 下载失败;
- 多 skill repo 未指定 `skills`;
- MCP command 找不到;
- bub Python plugin 安装失败。

这些都发生在 adapter setup 阶段,应该进入 `EvalResult.verdict = "errored"`。不要让它伪装成 `Turn.status = "failed"` 或一个 gate assertion fail。

## 当前示例如何演进

`examples/zh/coding-agent-skill/` 当前有两个好点:

- 它已经用 experiment 表达 baseline vs skill 变体;
- 它把本地 `zod.md` 与迁移来的 `ponytail.md` 分成两组 eval。

这个 wrapper 做的是**往 workspace 里注入一个文件**(把 skill 内容写成 `CLAUDE.md`),不是环境层预置——它不装二进制、不跨 attempt 存状态,只在这一次 `setup` 里写一个内容已知的文件到工作区,所以现阶段继续用手写 wrapper 是合理的过渡写法。真正的环境层动作(装某个实验专属的二进制、预热、按 `ctx.experimentId` 载入/回存记忆状态)不要塞进这类 wrapper,应该挂在 `experiment.sandbox` 的 `.setup()` / `.teardown()` 上,见 [Sandbox · 沙箱生命周期钩子](../sandbox.md#沙箱生命周期钩子setup--teardown)。

下一步可以把手写 wrapper:

```typescript
const baseAgent = claudeCodeAgent();
const zodAgent = {
  ...baseAgent,
  name: "claude-code+zod-skill",
  async setup(sb, ctx) {
    const cleanup = await baseAgent.setup?.(sb, ctx);
    await sb.writeFiles({ "CLAUDE.md": zodSkill });   // targetDir 省略 → workdir,跨 provider 可移植
    return cleanup;
  },
};
```

收敛为:

```typescript
const zodAgent = claudeCodeAgent({
  name: "claude-code+zod-skill",
  skills: [{ kind: "local", path: "examples/zh/coding-agent-skill/skills/zod.md" }],
});
```

ponytail 如果继续 vendored 到本 repo,就用 `kind: "local"`;如果希望测试真实第三方安装路径,就用 `kind: "repo"` 并指定 `skills: ["ponytail"]` 与 `ref`。

## 落地顺序

1. 在 `src/types.ts` 增加 `SkillSpec` / `PluginSpec`,并让内置 adapter config 复用它们。
2. 先实现本地 skill 注入,替换 `examples/zh/coding-agent-skill/` 的 wrapper。
3. 实现 repo skill 安装和多 skill 选择失败提示。
4. 把 `mcpServers` / `pythonPlugins` 兼容迁移到 `plugins`,旧字段保留一版并打印 deprecation。
5. 写 `agent-setup.json` artifact,让 view 可以展示每个 attempt 的安装清单。

这套设计不改变 core:core 仍只看 Agent/Adapter 契约、标准事件流、sandbox 与 result artifact。所有 Claude Code / Codex / bub 的差异都留在对应 adapter 的 setup 翻译层。
