<div align="center">

# Fast Eval

**渐进式、全功能、DX优秀的轻量 ai agent evals 工具**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)

[English](README.md) 

</div>

fasteval 是一个受[eve](eve.dev)启发的通用型 agent eval 工具。首先有非常优秀的 DX 设计，任何人可以在 10 分钟左右上手并配置。并且设计非常的通用。即可以用来 eval 给 Claude Code/Codex 写的 coding agent 的插件、Hook还有Skill。更可以直接 eval 自己的 AI Agent 框架(无论是基于 AI SDK、LangGraph、Pi还是什么接口都可以轻松接入)。

在 eval 完成之后可以生成易读的报告与查看 Agent 的行为细节。方便 Debug 与优化。

## 架构

fasteval 支持两种接入方式，取决于被测系统是否需要隔离工作区。

**模式一：Sandbox（Docker）—— 跑 Codex、Claude Code 等需要 sandbox 的 coding agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     fasteval        │
   └─────────────────────┘
        │
        │ Agent 适配器(官方)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox         │
   │   ┌────────────────────────┐  │
   │   │ Codex / Claude Code /  │  │
   │   │ 需要隔离工作区的应用    │  │
   │   └────────────────────────┘  │
   └──────────────────────────────┘
```

**模式二：直连 —— 直接连接你自己的 AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     fasteval        │
   └─────────────────────┘
        │
        │ Agent 适配器(官方，或者自己实现)
        ▼
   ┌──────────────────────────────┐
   │       你自己的 Web Agent       │
   │   (HTTP / AI SDK·LangGraph·   │
   │    Pi 等自有框架，无需 Docker) │
   └──────────────────────────────┘
```

- **fasteval 核心** 负责发现 eval、调度运行、打分、生成报告与 artifacts。
- **Agent 适配器** 是开放的边界：你来决定如何调用被测系统。
- 需要文件系统隔离的 coding agent 走 **Docker Sandbox**；自有的 Web Agent 可以直连，无需 Docker。


## 示例

```ts
// evals/测试是否能正常理解图片.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "实现一个带 label 和 onClick props 的 Button 组件。",
  async test(t) {
    await t.send("创建 src/components/Button.tsx，支持 label 和 onClick props。");

    t.succeeded();
    t.fileChanged("src/components/Button.tsx");
    t.check(t.file("src/components/Button.tsx"), includes("onClick"));
    t.testsPassed();
  },
});
```

```sh
npx fasteval button --agent codex --sandbox docker
npx fasteval view
```

## 快速开始

```text
READ https://raw.githubusercontent.com/CorrectRoadH/fasteval/refs/heads/main/INIT.md and install fasteval for this repo.
```

从你的场景开始：

- [如果你需要 eval 你的 Claude Code / Codex 插件](https://fasteval.mintlify.site/zh/example/claude-code-codex-plugin)
- [如果你需要 eval 你的 Claude Code / Codex Skill](https://fasteval.mintlify.site/zh/example/claude-code-codex-skill)
- [如果你需要 eval 你的 AI Agent 应用](https://fasteval.mintlify.site/zh/example/ai-agent-application)


## Roadmap
官方适配器
- [ ] Agent 软件
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent 框架
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## 文档

- [Mintlify 文档站](https://fasteval.mintlify.site/)
- [Mintlify 文档源码](docs-site/zh/index.mdx)
- [文档首页](docs/README.md)
- [Getting Started](docs/getting-started.md)
- [Authoring](docs/authoring.md)
- [Scoring](docs/scoring.md)
- [Agents and Adapters](docs/agents-and-adapters.md)
- [Sandbox](docs/sandbox.md)
- [Runner](docs/runner.md)
- [Experiments](docs/experiments.md)
- [Observability](docs/observability.md)
- [CLI](docs/cli.md)
- [Source Map](docs/source-map.md)

# 感谢
该项目受下面项目所启发或者是由AI从下面项目中学习代码所写
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

感谢下列社区
