# 例子：评测 Claude Code Skill 插件

这个例子展示如何用 fasteval **量化一个 Claude Code Skill 对编码质量的实际提升**。

被测对象是 [effect-ts](https://github.com/Effect-TS/skills) skill——它向 Claude Code 注入
Effect-TS 库的最佳实践与 API 用法。我们通过 A/B 实验对比「有 skill」vs「无 skill」，
衡量 agent 在 Effect-TS 相关编码任务上的通过率差异。

## 目录结构

```
claude-code-skill/
├── fasteval.config.ts         # 全局配置(sandbox、judge)
├── evals/
│   ├── parse-with-schema.eval.ts   # 用 Effect Schema 解析 JSON
│   └── error-handling.eval.ts      # 用 Effect 做错误处理
└── experiments/
    ├── with-skill.ts          # 安装 effect-ts skill 后跑
    └── baseline.ts            # 对照组:裸 claude-code
```

## 快速开始

### 1. 安装依赖

```sh
npm install -D fasteval
```

### 2. 配置环境变量

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. 确保 Docker 可用

```sh
docker info   # 应该有输出
```

### 4. 在项目根安装 effect-ts skill

skill 来自 [Effect-TS/skills](https://github.com/Effect-TS/skills)。
先在你的项目里安装（fasteval 会把 `skills-lock.json` 带进沙箱）：

```sh
npx skills add Effect-TS/skills
```

这会拉取 GitHub 上的 `Effect-TS/skills` repo，读取 skill manifest，把 `"effect-ts"` 写进
项目根的 `skills-lock.json`（local name 由 skill manifest 声明，不是自己起的）。

### 5. 运行对比实验

```sh
# 跑两组实验（有 skill vs 无 skill）
npx fasteval exp compare

# 只看「有 skill」这组
npx fasteval exp compare/with-skill

# 看报告
npx fasteval view
```

## 理解实验设计

### 有 skill 的实验（`experiments/with-skill.ts`）

```ts
import { claudeCodeAgent } from "fasteval";

export default defineExperiment({
  agent: claudeCodeAgent({ skills: ["Effect-TS/skills"] }),
  // ...
});
```

`claudeCodeAgent({ skills: ["Effect-TS/skills"] })` 在沙箱 setup 阶段执行
`npx skills add Effect-TS/skills`，拉取 GitHub repo 并把 skill 写进沙箱里的 `skills-lock.json`；
claude CLI 启动时自动读取，将 skill 的 `.md` 文件注入到上下文里。
Agent 收到 prompt 时已经"知道" Effect-TS 的 API 风格与最佳实践。

### 无 skill 的对照组（`experiments/baseline.ts`）

```ts
import { claudeCodeAgent } from "fasteval";

export default defineExperiment({
  agent: claudeCodeAgent(),   // 没有 skills 参数
  // ...
});
```

两组跑同一批 eval，对比通过率即可量化 skill 的收益。

## 扩展：测试 MCP Server 插件

除了 skill，你也可以测试 MCP Server 插件是否正确工作：

```ts
import { claudeCodeAgent } from "fasteval";

const agentWithMCP = claudeCodeAgent({
  mcpServers: [
    {
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    },
  ],
});
```

然后写 eval 断言 agent 确实调用了 MCP 工具：

```ts
t.calledTool("mcp__filesystem__read_file");
```
