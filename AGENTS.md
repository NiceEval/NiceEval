# Repository Guidelines

## Project Structure & Module Organization

niceeval 是一个 TypeScript evals 库。CLI 入口在 `bin/niceeval.mjs`，运行时通过 `tsx` 直接加载 `src/cli.ts` 和用户项目里的 `.ts` 配置 / eval 文件。核心实现位于 `src/`：类型契约在 `src/types.ts`，定义 API 在 `src/define.ts`，运行器在 `src/runner/`，评分器在 `src/scoring/` 与 `src/expect/`，执行上下文在 `src/context/`，可观测性在 `src/o11y/`，沙箱后端在 `src/sandbox/`，本地结果查看器在 `src/view/`。产品站点位于 `site/`，Mintlify 文档站位于 `docs-site/`，可运行示例位于 `examples/`。

## 文档路由：先读什么

本文件只保留仓库级总规则，正文都在下面四个入口后面，按需读：

- **建立设计心智 / 找某篇设计** → `docs/README.md`（按意图索引全部内部文档；标「设计提案(未实现)」的不是当前行为）。
- **把设计行为定位到源码** → `docs/source-map.md`。
- **动手前查踩坑** → `memory/INDEX.md` 对应分区，命中一行才读正文（见「记录问题的规范」）。
- **改 `docs-site/`** → 必须先读 `docs-site/AGENTS.md`（公开站的写作指南、术语表和校验规则）。

## 设计原则：beta，不背惯性包袱

niceeval 是 beta 软件，DX 可以随便改。做 API / CLI / 契约设计决策时可以打破一切惯性：不必顾虑向后兼容、已有用户习惯、行业惯例或「大家都这么设计」，从第一性原理出发想最理想的形态，破坏性的 API / CLI 重设计也完全可以做。惯性不是理由，理想形态才是标准；唯一的约束是定稿后按下面的「文档写作要求」落成声明式契约，并履行表格里的同步义务。

## 文档写作要求：结果进 docs，过程进 memory

写下任何内容前先按体裁路由到唯一的家：

- **结果（当前定稿的契约与行为）** → `docs/`（设计契约，给实现者）与 `docs-site/zh`（任务文档，给用户）。正文只写定稿形态，声明式表述。理由可以写——「为什么是组件树而不是判别联合」是契约的一部分；时间线不能写——「早先草案」「同日翻案」「现已改为」「2026-07 迭代」是过程。
- **过程（反复改、否决方案、踩坑、修法）** → `memory/`。设计翻案、砍掉的方案记成「设计裁决」条目（裁决 / 曾选方案 / 否决理由 / 日期）；docs 正文需要出处时链条目，不复述叙事。
- **变更审计（这次改了什么、为什么改）** → commit message，不落任何文档正文。

判据：把 docs 任何一段拿给没读过旧稿的人，契约信息完整、没有一个词要靠「知道以前长什么样」才能读懂，就合格。具体规则：

- 不写差分句——「去掉 X 后的类型」「删除了 Y」「不再是 Z」不落正文。
- 不留待定问题——「要不要 / 再议」在定稿前裁决，落进文档的只有决定和理由。
- 改设计时**重写受影响小节**，不在旧文上贴「现已改为」补丁。逐句自测：删掉这句丢契约信息就留；只丢历史，搬 memory 或直接删。
- 「设计提案(未实现)」等实现状态只写在文档开头的状态行，不散在正文里当语气词。
- `docs-site/zh` 额外过「口语测试」与术语裁决，规则在 `docs-site/AGENTS.md`。

一次设计迭代的落文档顺序：**① 分歧在对话里裁决**（不落文档）→ **② 先文档后代码**：按定稿重写 `docs/` 受影响小节与 `docs-site/zh` 对应页（文档写不顺说明设计有问题，回到 ①）→ **③ 改代码**，按下表履行验证与同步义务 → **④ 沉淀过程**：有翻案、弯路或反直觉修法的，记 memory 一条并索引；复盘确认的长期约束升格为本文件或 docs 里的一句规则。

| 改动 | 验证 | 收尾（同步义务） |
| --- | --- | --- |
| `src/` / `bin/` | `pnpm run typecheck`；改 CLI 行为再用 `pnpm run niceeval -- <命令>` 冒烟 | 公开面（导出类型/TSDoc/flag 表）变了：跑 `pnpm docs:reference` 重新生成参考页区块。参考页文案单源在源码紧邻注释——接口/函数看 TSDoc，CLI flag 说明写在 `src/cli.ts` `FLAG_OPTIONS` 各项的 JSDoc（缺注释生成器报错），生成脚本本身不承载文案（`{/* GENERATED */}` 区块内不要手改，`pnpm test` 的漂移守护会拦）；新增/改名 flag 顺手核对 `src/i18n/` 两份 `--help` 速查（手工体裁，只点名常用 flag，不逐条生成）；可观察行为变了（flag、断言语义、结果格式、导出面）：grep `docs/` 与 `docs-site/` 同步声明，或记为明确的阶段性差异；修了 bug 补 memory 台账 |
| `docs/` 或根 README | `pnpm test`（`test/docs-consistency.test.ts` 查索引覆盖与链接真实性） | 新文档在 `docs/README.md` 挂一行索引 |
| `docs-site/` | `docs:validate` + `docs:links`（需 Node 22，见下） | 中文先定稿；英文入口按中文和当前代码核对后同步 |
| `examples/` 各 tier | `pnpm tiers:sync`（动之前先读 memory 的 tier-sync 条目） | 文档 / README 链接示例必须指向真实目录 |
| `site/` | `pnpm run site:build` | — |
| `memory/` | `pnpm test`（`test/memory-index.test.ts` 查索引覆盖） | `INDEX.md` 加一行 |

守护一律搭现有命令的便车：仓库约定需要机器校验时，写成 `test/` 下的 vitest 测试，不新增脚本、package.json 命令或 hook。已批准的例外：`scripts/generate-reference.ts`（`pnpm docs:reference`，参考页从源码 TSDoc 生成的中间层，2026-07 用户明确批准），它的守护同样走 vitest（`test/reference-consistency.test.ts`）。

## Build, Test, and Development Commands

- `pnpm install`：安装依赖。
- `pnpm run typecheck`：运行 TypeScript 类型检查。
- `pnpm test`：运行 vitest（含 memory / docs 一致性校验）。
- `pnpm run niceeval -- --help`：通过本地入口冒烟 CLI。
- `pnpm run site:dev` / `pnpm run site:build`：产品站点开发 / 构建。
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate`：验证 Mintlify 文档构建。
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links`：检查 Mintlify 文档 broken links、anchors 和 redirects。

## Public Docs, Examples & README

公开文档有三层，更新时要保持一致：

- `docs-site/`：Mintlify 官网文档。`docs-site/docs.json` 管导航；顶层 `*.mdx` 是英文入口；`docs-site/zh/` 是中文入口、指南、参考和场景示例。
- `examples/`：可运行示例。当前完整示例在 `examples/zh/`。
- `README.md` / `README.zh.md`：仓库首页文案。只放稳定、短路径信息；详细教程链接到 `docs-site/` 或 `docs/`。

中文内容是产品叙事和场景示例的准绳。更新英文 README、英文 docs-site 或示例索引时，如果发现与中文 README、`docs-site/zh/`、`examples/zh/` 不一致，先按中文和当前代码核对，再把其它语言/入口同步过去；不要为了英文入口临时发明新的能力、路径或产品定位。

## Architecture Boundaries

保持 core 中立。core 负责 eval 发现、断言收集、评分判决、并发调度、缓存、报告和工件。`Agent` / Adapter 负责“连到哪个被测对象、协议怎么说”；`Sandbox` 负责“在哪里跑、如何隔离”。CLI、配置 schema、注册表可以按名字路由；运行器、评分、报告这些核心路径不要写 `agent == codex` 或 `sandbox == docker` 之类的行为分支。需要差异行为时，放到对应 Adapter、Sandbox 或中性的 hook。

## Site
如果开发 Landing Page 用的是 NextJS
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the docs in `node_modules/next/dist/docs/` before coding.
<!-- END:nextjs-agent-rules -->

## Coding Style & Naming Conventions

项目使用 ESM + TypeScript，公共类型优先放在 `src/types.ts`，公共 API 从 `src/index.ts` 或现有子路径导出。沿用现有模块边界，不为单个 case 提前抽象新层。错误信息要直接说明问题和下一步，尤其是 CLI、配置和 eval 发现错误。注释可以用中文，但只解释不显然的设计约束或复杂流程。

## CLI Model

CLI 只有两类输入：位置参数选择“跑哪些 eval”（eval id 前缀），flag 选择“对着哪个 agent、怎么跑”。不要把 agent 名字、URL 或运行配置混进位置参数语义里；新增命令或报错时保持这个模型清晰。

## Git & Collaboration

直接在 `main` 上开发，不要为改动新建 feature 分支；若已有分支则合回 `main`。main 直推下 commit message 是唯一审计线索：说清改了什么行为、为什么，不写 `update` 这类空消息。

不要用 `git reset --hard`、`git clean`、`git checkout -- <path>` 或 `git restore` 去丢弃工作树改动，除非用户明确要求。工作树里出现你没写的改动时，把它当成用户或其他 agent 的工作，不要覆盖。提交前用 `git status` 和 `git diff` 确认只包含本次任务相关文件。

## Release

发版走 CI（`.github/workflows/release.yml`），**不要在本地 `npm publish`**（本地没有
发布凭证，publish 会 401/404）。触发方式只有一种：`git tag vX.Y.Z` → push tag 到
origin。标签号就是发布版本号，CI 自己从标签名解析版本号、在 runner 本地写入
`package.json`（不写回仓库，main 上不需要预先提交版本号变更）→ typecheck →
`pnpm publish`（NPM_TOKEN secret，provenance）→ 创建 GitHub Release。预发布版（如
`0.5.0-alpha.1`）自动发对应 dist-tag，正式版发 latest。

## 记录问题的规范

发现基础设施 bug、API 限制或行为反直觉的地方时，记入 `memory/`（项目根目录下的 `memory/` 文件夹），不写进本文件。`memory/INDEX.md` 是索引兼维护规则——先读后动、写完即索引、已修标注、复盘升格，细则都在它开头，写或读 memory 时照做。

一条条目 = **现象**（什么错误、在哪复现）/ **根因**（为什么）/ **修法**（怎么改、落点文件或 commit、适用场景）。发现问题立刻记，趁上下文还在；修法反直觉（如「调大 timeout 反而让 session 更短」）时尤其要记。memory 同时是修法台账：已修条目不删除，留作后续复盘「这个修法合理不合理」的材料。
