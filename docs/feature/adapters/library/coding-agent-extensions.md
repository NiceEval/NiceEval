# 配置 Coding Agent 扩展

Claude Code、Codex CLI 和 Bub 的 Adapter factory 可以在每个 attempt 开始前安装 Skills、MCP servers 和各自的原生扩展。扩展作为 Agent 构造参数进入 experiment，便于组织可复现的 A/B 对比。

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

```ts
const browser = {
  name: "browser",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-browser"],
  env: { BROWSER_MODE: "headless" },
};

const claude = claudeCodeAgent({ mcpServers: [browser] });
const codex = codexAgent({ mcpServers: [browser] });
```

MCP 只在 factory 构造时传入。需要条件变体时包装 factory 并合并数组，不在 Agent 构造后修改配置文件。

## 组织 A/B 实验

```ts
// experiments/skills/baseline.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: codexAgent(),
  runs: 5,
  earlyExit: false,
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
  earlyExit: false,
});
```

两个文件位于同一个 `experiments/skills/` 目录，因此组成一组可对比实验。每个文件只默认导出一个 `defineExperiment`；niceeval 不读取 `export const experiments = { ... }` 这种聚合导出。

model、reasoning effort 和业务 flags 仍由 experiment 配置；扩展内容属于 Agent 变体。评估通过率分布时设置 `earlyExit: false`，避免首次通过后提前停止剩余 runs。

## 查看安装结果

Sandbox Agent setup 写出安装 manifest，attempt 结果保存实际安装的 Skill、来源、ref、插件和解析版本。安装失败属于基础设施错误，不记作 Agent 解题失败。

每个 Agent 支持的字段和示例见：

- [Claude Code](../sdk/claude-code/README.md)
- [Codex CLI](../sdk/codex-cli/README.md)
- [Bub](../sdk/bub/README.md)
