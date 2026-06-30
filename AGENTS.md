# Repository Guidelines

## Project Structure & Module Organization

fasteval 是一个 TypeScript evals 库。CLI 入口在 `bin/fasteval.mjs`，运行时通过 `tsx` 直接加载 `src/cli.ts` 和用户项目里的 `.ts` 配置 / eval 文件。核心实现位于 `src/`：类型契约在 `src/types.ts`，定义 API 在 `src/define.ts`，运行器在 `src/runner/`，评分器在 `src/scoring/` 与 `src/expect/`，执行上下文在 `src/context/`，可观测性在 `src/o11y/`，沙箱后端在 `src/sandbox/`，本地结果查看器在 `src/view/`。产品站点位于 `site/`。

## Documentation Index

文档位于 `docs/`，主要用于建立项目心智模型和查具体行为：

- `docs/README.md`：文档首页，先读这里了解 fasteval 是什么、如何快速开始。
- `docs/vision.md`：产品原则，尤其是 core / Agent(Adapter) / Sandbox 的边界。
- `docs/concepts.md`：术语表；遇到 Agent、Adapter、Sandbox、Experiment、Artifact 等词先查这里。
- `docs/architecture.md`：模块分层、数据流和核心职责。
- `docs/source-map.md`：文档行为到源码文件的映射；找实现入口时优先读它。
- `docs/authoring.md`：如何编写 eval。
- `docs/scoring.md`：gate / soft、匹配器、judge、判决规则。
- `docs/agents-and-adapters.md`：如何接被测对象、如何写 agent adapter。
- `docs/sandbox.md`：沙箱接口和 Docker / 三方后端边界。
- `docs/runner.md`：发现、调度、并发、缓存、attempt 编排。
- `docs/experiments.md`：实验矩阵、可对比组、`fasteval exp`。
- `docs/lifecycle.md`：运行级和沙箱级环境起停钩子。
- `docs/observability.md`：标准事件流、OTLP trace(canonical = OTel GenAI 语义约定,每 agent 一个薄 mapper,view 只认 canonical)、usage、cost、工件和 `fasteval view`。
- `docs/cli.md`：CLI 参数模型和命令参考。
- `docs/getting-started.md`：目标 DX 示例。
- `docs/roadmap.md`：MVP 范围和后续计划。

## Product Positioning

fasteval 的核心定位是一个轻量、通用、DX 体验好的 agent eval 工具：容易理解、容易上手，适合放进各种项目里，用同一套 eval surface 评 agents、services、functions 和 coding-agent fixtures。

新文案、示例和代码注释要同时传达两件事：第一，它是通用的 agent eval，而不是绑定某个协议、平台或项目的专用工具；第二，它用低心智负担的 TypeScript API 提供可验证的能力，例如 `defineEval`、评分、运行矩阵、trace、cost、diff、工件和 sandbox。避免只写空泛的 “framework” 或 “software” 而不说明它具体轻在哪里、通用在哪里、如何更容易上手。

## Architecture Boundaries

保持 core 中立。core 负责 eval 发现、断言收集、评分判决、并发调度、缓存、报告和工件。`Agent` / Adapter 负责“连到哪个被测对象、协议怎么说”；`Sandbox` 负责“在哪里跑、如何隔离”。CLI、配置 schema、注册表可以按名字路由；运行器、评分、报告这些核心路径不要写 `agent == codex` 或 `sandbox == docker` 之类的行为分支。需要差异行为时，放到对应 Adapter、Sandbox 或中性的 hook。

## Build, Test, and Development Commands

- `pnpm install`：安装依赖。
- `pnpm run typecheck`：运行 TypeScript 类型检查。
- `pnpm run fasteval -- --help`：通过本地入口冒烟 CLI。
- `pnpm run site:dev`：启动产品站点开发服务器。
- `pnpm run site:build`：构建产品站点。

改 `src/` 或 `bin/` 后至少跑 `pnpm run typecheck`。改 `site/` 后至少跑 `pnpm run site:build`。改 CLI 行为后，用 `pnpm run fasteval -- <命令>` 做对应冒烟。

## Coding Style & Naming Conventions

项目使用 ESM + TypeScript，公共类型优先放在 `src/types.ts`，公共 API 从 `src/index.ts` 或现有子路径导出。沿用现有模块边界，不为单个 case 提前抽象新层。错误信息要直接说明问题和下一步，尤其是 CLI、配置和 eval 发现错误。注释可以用中文，但只解释不显然的设计约束或复杂流程。

## CLI Model

CLI 只有两类输入：位置参数选择“跑哪些 eval”（eval id 前缀），flag 选择“对着哪个 agent、怎么跑”。不要把 agent 名字、URL 或运行配置混进位置参数语义里；新增命令或报错时保持这个模型清晰。

## Git & Collaboration

直接在 `main` 上开发，不要为改动新建 feature 分支；若已有分支则合回 `main`。

不要用 `git reset --hard`、`git clean`、`git checkout -- <path>` 或 `git restore` 去丢弃工作树改动，除非用户明确要求。工作树里出现你没写的改动时，把它当成用户或其他 agent 的工作，不要覆盖。提交前用 `git status` 和 `git diff` 确认只包含本次任务相关文件。

## 已知问题与 Know-How

### Sandbox $HOME 不能 hardcode

**现象**：bub agent 在 Vercel sandbox 上出现 `$HOME/.local/bin/bub: No such file or directory`。

**根因**：`BUB_HOME` 和 `BUB_CHECKPOINT_PATHS` 硬编码了 `/home/node`（Docker sandbox 的用户 home），但不同 sandbox backend 的 Linux 用户不同（Vercel 是 `/home/vercel-sandbox`）。checkpoint tar 里嵌入的是绝对路径，解压后文件在 `/home/node/...`，而 `$HOME` 展开成 `/home/vercel-sandbox/...`，路径错位。

**修法**：在 agent `setup()` 里用 `printf '%s' $HOME` 检测实际 home，存入 `Map<sandboxId, home>` 闭包变量供 `send()` 使用；checkpoint 路径和磁盘缓存 key 都带上 home，避免不同 sandbox 共用同一份缓存。不应有 `if (backend === 'vercel')` 之类的分支，对所有 backend 一视同仁。

### Vercel 免费计划 session 寿命约 360-390s

**现象**：eval 跑到 360-390s 时出现 `StreamError: Stream ended before command finished` 或 `TypeError: terminated`。

**根因**：Vercel 免费计划有 session 硬上限。`extendTimeout` 返回 HTTP 400，`snapshot()` 返回 HTTP 402，均不支持续期。并发跑多个 eval 时，多路 LLM API 同时竞争，每个 agent 耗时被拉长到 280-400s，逼近上限。

**修法**（两者都需要）：
1. 实验配置里加 `maxConcurrency: 1` 串行跑，把每个 agent 耗时压到 50-200s
2. `VercelSandbox.readSourceFiles` 改两阶段：`find`-only shell（约 1s）+ 并行 `readFileToBuffer` HTTP GET（约 2s），避免 30s 的 NDJSON 流在 session 快到期时 StreamError

**附**：`SESSION_TIMEOUT_MS` 必须是固定常量（1_200_000），不能从 `commandTimeoutMs` 推导——透传给 Vercel API 的 `timeout` 越大，实际拿到的 session 反而更短。

### ExperimentDef 的 maxConcurrency 字段曾无效

**现象**：实验文件里写 `maxConcurrency: 1` 不起作用，仍以默认并发 4 跑。

**根因**：`ExperimentDef` 类型里没有 `maxConcurrency` 字段，CLI 只读全局 `config.maxConcurrency`，实验级别的值被 TypeScript 静默忽略。

**修法**：已在 `src/types.ts` 的 `ExperimentDef` 里加 `maxConcurrency?: number`，并在 `src/cli.ts` 的 `exp` 命令里取所有选中实验的 `Math.min(...maxConcurrency)` 作为实际并发上限。

## 记录问题的规范

发现基础设施 bug、API 限制或行为反直觉的地方时，在本文件的「已知问题与 Know-How」小节追加一条，格式为：

```
### 问题标题（一句话描述）

**现象**：复现路径或错误信息
**根因**：为什么会这样
**修法**：怎么改，以及哪些场景适用
```

不要只改代码不留文档——下一个遇到同类问题的人（或未来的自己）需要这些上下文。
