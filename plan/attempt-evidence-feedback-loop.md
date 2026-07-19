# PLAN：以 Attempt 为中心重构报告与 AI 反馈闭环

> 来源：`docs-site/zh/guides/report-components.mdx` 与 `agent-feedback-loop.mdx` 的目标体验。
>
> 状态：设计已定，代码尚未实现。这是一次完整重构 TODO，不分阶段交付，不保留全局 React shim、旧组件兼容层或两套证据 renderer 作为中间终点。
>
> 最终验收仓库：`/Users/ctrdh/Code/coding-agent-memory-evals`。
>
> **要求宿主保留默认 Attempt 首页内容的部分已被 `plan/report-pages-attempt-detail-alignment.md` 与 `memory/attempt-detail-is-a-parametrized-page.md` 取代**：attempt 详情不再是宿主默认持有的首页内容，而是报告里唯一的参数化 page；没有该 page 时宿主不回退到任何内建详情。本文件里 `AttemptEvidence` 的字段草案（缺 `trace`、`capabilities.eval` 而非 `capabilities.source`）也已被 `src/results/attempt-evidence.ts` 的实际实现取代，字段以当前源码与 `docs/concepts.md`《Attempt 证据》词条为准。CLI 用法（`show @<id> [--source|--execution|--diff]`）与证据装配分层的部分仍然成立。

## 完成后的唯一体验

`niceeval show` 输出低 token 的 Attempt 索引：

```text
✗ weather/brooklyn  @7K2M9Q✗[E,X,⏱]  gate calledTool("get_weather")

inspect: niceeval show @<id> [--eval|--execution|--diff]
```

Agent 选中 locator 后一步进入精确 Attempt：

```bash
niceeval show @7K2M9Q
niceeval show @7K2M9Q --eval
niceeval show @7K2M9Q --execution
niceeval show @7K2M9Q --diff
```

- 默认面：Eval 断言摘要、执行摘要、可选 OTel 时间、工作区 diff 摘要。
- `--eval`：运行时保存的 Eval 源码，gate/soft 结果标回源码行。
- `--execution`：消息、thinking、Skill load、tool call/result；有 OTel 时在同一节点补时间，没有时只显示 timing unavailable。
- `--diff`：被测 Agent 在 Sandbox 工作区造成的文件变化，不是 Eval 源码差异。

## 承重架构

### 双面组件

一个报告组件由一份准备好的 model 和两个显式 renderer 组成：

```ts
defineComponent({
  web(model, ctx): ReactNode,
  text(model, ctx): string,
});
```

- text 直接返回字符串，这是正式契约，不需要终端 IR。
- web 与 text 接收同一个 model；排序、过滤结果、聚合、locator、证据能力和文案选择都在 model 准备阶段确定。
- renderer 只负责各自媒介的排版，不读取 artifact、不重新聚合、不重新挑 Attempt。
- web 可以使用 React 表格、`details`、代码高亮和链接；text 根据 `ctx.width` 换行、截断并返回纯字符串。
- model 中保存语义引用，不保存宿主字符串：web 用 `ctx.attemptHref(ref)`，text 用 `ctx.attemptCommand(ref)`。
- 不尝试把 React 树自动转成 ASCII，也不让 text renderer 解析 JSX。
- 自定义组件必须同时提供 web/text；缺一面在类型检查时报错。

### 中性数据准备

报告组件的数据准备与 Attempt 证据装配是两层不同职责：

```ts
interface AttemptEvidence {
  locator: AttemptLocator;
  identity: { experimentId: string; snapshotStartedAt: string; evalId: string; attempt: number };
  result: EvalResult;
  evalSource: AnnotatedEvalSource | null;
  execution: ExecutionTree | null;
  diff: DiffData | null;
  artifactPaths: EvidencePaths;
  capabilities: { eval: boolean; execution: boolean; timing: boolean; diff: boolean };
}
```

- results/evidence 层负责读取和装配事实。
- component `.data(...)` 负责把事实变成稳定、已格式化的 view model。
- web/text renderer 只消费 view model。
- show、view、静态导出和报告列表必须复用同一个 `AttemptEvidence` assembler。

### ExecutionTree

- 标准事件流是骨架：message、thinking、Skill load、tool call/result、subagent、error。
- OTel span 是可选 enrichment：开始时间、耗时、父子关系、错误状态。
- 没有 OTel 时节点、顺序和内容不变，只缺时间。
- tool result 按 call ID 归入 tool call；Skill load 是一等事件，不靠文本猜。
- span 只通过明确 correlation ID/semantic attributes 关联；无法唯一关联时作为 telemetry-only 节点保留，不误绑。

## 当前 gap

| 领域 | 当前 | 目标 |
| --- | --- | --- |
| 组件 | `ExperimentTable` 混合三级实体，`MetricTable.expand` 与 `CaseList` 重叠 | `ExperimentList` / `EvalList` / `AttemptList`；指标图形只展示聚合值 |
| 双面数据 | 部分组件 selection-form、data-form、renderer 责任交错 | `.data()` / resolve 只准备 model；web/text 纯展示同一 model |
| Attempt 定位 | Eval 前缀 + `--experiment` + 数字 `--attempt` | 可复制、可发布、精确的短 `@locator` |
| Eval 证据 | 只列 AssertionResult，不显示运行时源码 | 保存 Eval 源码与哈希，断言带 SourceLoc，show/view 共用标注模型 |
| 执行证据 | events 与 trace 两套 renderer | 一棵 ExecutionTree，OTel 只补时间 |
| Skill | 没有一等 `skill.loaded` 事件 | 标准事件流正式表达 Skill load |
| diff | 通过 Eval 选择后读取 | locator 精确读取同一 Attempt 的 workspace diff |
| TSX | 包内 TSX 受消费方 cwd/tsconfig 影响，出现 `React is not defined` | package-owned 与 user-owned module loader 边界明确 |
| 外部验收 | 仓库内测试不能覆盖 link 消费方 | `coding-agent-memory-evals` 中真实命令与文档一致 |

## 一步到位 TODO

以下 TODO 按依赖顺序执行，但不是独立发布阶段。全部勾完、旧路径清理完、外部验收通过后才能提交为完成。

### 文档与契约收口

- [ ] 以本计划、`report-components.mdx`、`agent-feedback-loop.mdx` 为目标契约，清理 `docs/reports.md`、`docs/view.md`、`docs/concepts.md` 与 `viewing-results.mdx` 中仍在描述 `ExperimentTable`、`CaseList`、`MetricTable.expand`、`--transcript`、独立 `--trace` 的冲突内容。
- [ ] 在 CLI 契约中定稿 `@locator`、`--eval`、`--execution`、`--diff[=<path>]`；`--execution` 取代分裂的 output/transcript/trace 阅读入口。
- [ ] 更新源码 TSDoc/flag JSDoc 后运行 `pnpm docs:reference`，不手改 GENERATED 区块。
- [ ] 新增设计翻案 memory：实体列表替代混合表、ExecutionTree 合并 events/trace、全局 React shim 被否决，并在 `memory/INDEX.md` 索引。

### 修正包内/用户模块加载边界

- [x] 删除把 `globalThis.React` 当运行时依赖的补丁设计。
- [x] package-owned CLI、report runtime 和 built-in 必须固定使用 niceeval 自己的 tsconfig/JSX 语义，不读取消费方 tsconfig。
- [ ] user-owned config、Eval、Agent 和 `--report` 文件由单独的 user-module loader 加载。
- [x] 优先验证 tsx 的显式 `tsconfig` + namespace 是否能可靠隔离两类模块；若不能，package-owned runtime 发布预编译 ESM，tsx 只处理用户模块。
- [ ] 加消费方 e2e：无 tsconfig、classic JSX、react-jsx、symlink/link/file 依赖四种情况都能运行 built-in 和用户 `.tsx` 报告。
- [ ] 在 `/Users/ctrdh/Code/coding-agent-memory-evals` 裸跑 `pnpm exec niceeval show`，确认不再出现 `React is not defined`。

### 建立持久 Attempt locator

- [ ] 定义公共 `AttemptLocator`，以 `@` 开头，与 Eval ID 前缀无歧义。
- [ ] locator 从 experiment ID、快照 startedAt、Eval ID、Attempt index 的不可变身份生成，不使用数组下标或当前 Selection 顺序。
- [ ] 使用带版本的确定性短编码；reader 打开结果根时建立 locator → AttemptHandle 索引并检测碰撞。
- [ ] writer 持久化 locator；reader 验证；`copySnapshots` 保留；resume/carry 沿用原 Attempt locator。
- [ ] locator 不存在、损坏或冲突时直接报结构化错误，不回退“最新失败”。
- [ ] CLI 让 `niceeval show @<id>` 直接选择 Attempt；普通 Eval 前缀选择仍保持明确。
- [ ] report model、web href、text command 和 view route 全部携带同一 locator/AttemptRef 映射。

### 保存运行时 Eval 源码并标注断言

- [ ] Eval discovery 时捕获规范化源码、项目相对路径与 SHA-256。
- [ ] 同一快照内相同 Eval 源码只保存一份；Attempt 通过引用关联，避免每次重试复制源码。
- [ ] AssertionResult 保存稳定 SourceLoc；所有 `check`、`require`、作用域断言和 Judge 都能关联到声明位置。
- [ ] 无 SourceLoc 的程序化断言进入 `unmapped assertions`，不能丢失。
- [ ] resume/carry 保留原源码引用；`copySnapshots` 将引用与 artifact 本地化。
- [ ] schemaVersion 递增；旧结果显示 `Eval source unavailable`，禁止读取当前工作区文件解释历史结果。
- [ ] 建立 `AnnotatedEvalSource` model：源码行、断言状态、严重度、分数、detail/evidence、摘要计数。
- [ ] web 代码视图和 text `--eval` renderer 只消费同一 `AnnotatedEvalSource`。

### 建立统一 AttemptEvidence

- [ ] 在中性 results/evidence 层实现 locator 解析和 `AttemptEvidence` assembler。
- [ ] assembler 一次装配 identity、result、annotated Eval source、events、trace、diff、artifact paths 与 capabilities。
- [ ] capability 由 artifact 实际存在性决定：`[E]` Eval、`[X]` execution、`[⏱]` OTel timing、`[D]` diff。
- [ ] show、view、静态导出、报告列表不得自行读取或重算 capability。
- [ ] 默认 `show @<id>` 使用该 model 输出紧凑全景；`--eval`、`--execution`、`--diff` 只是同一 model 的不同投影。

### 重构标准事件与 ExecutionTree

- [ ] 给标准事件增加稳定 event/node ID、顺序、可选时间锚和 correlation 字段。
- [ ] 增加一等 `skill.loaded` 事件，Adapter/转换器负责从原生协议映射，不在 renderer 猜。
- [ ] 工具调用与结果按 call ID 合成一个 ExecutionNode；subagent、input request、compaction、error 各有正式节点。
- [ ] 建立纯函数 `buildExecutionTree(events, spans)`；events 为骨架，spans 为可选 enrichment。
- [ ] 通过明确 correlation ID 或 GenAI semantic attributes 关联 span；无唯一匹配时保留 telemetry-only 节点并标注来源。
- [ ] 有 OTel 时同一节点显示相对时间、耗时、父子关系和错误；无 OTel 时保持同一节点内容与顺序并显示 timing unavailable。
- [ ] `--execution` renderer 同时展示 message、thinking、Skill load、tool call input/result、subagent 和 error。
- [ ] 长文本、tool I/O 按统一预算截断，并给 events/trace 原始 artifact 路径。
- [ ] 删除 show/view 各自维护的 transcript/trace/tool-I/O 解释逻辑。

### 明确 diff 证据

- [ ] diff 定义固定为被测 Agent 对 Sandbox 工作区的文件变化，不与 Eval source diff 或当前 git diff 混用。
- [ ] 默认 Attempt 全景只显示文件摘要；`--diff` 显示全局摘要；`--diff=<path>` 展开单文件。
- [ ] remote agent、没有文件工作区、没有变化、artifact 缺失分别给可区分的 unavailable 原因。
- [ ] resume/carry 与复制发布后 locator 仍读取同一份 diff。

### 重做报告组件 model

- [ ] 为 `ExperimentList`、`EvalList`、`AttemptList` 定义稳定 view model；每个 item 携带 locator、verdict、原因摘要与 evidence capabilities。
- [ ] `ExperimentList.data(selection)` 返回普通 `ExperimentListItem[]`；每项一个 experiment。
- [ ] `EvalList.data(selection)` 返回普通 `EvalListItem[]`；每项一个 experiment × Eval。
- [ ] `AttemptList.data(selection)` 返回普通 `AttemptListItem[]`；每项一个 Attempt。
- [ ] 报告作者使用原生 `.filter()` / `.slice()`；组件不提供查询 DSL，不静默删除 passed。
- [ ] 数据准备统一完成排序、格式化、折叠判定、成本、持续时间、locator 与 capability。
- [ ] 每个组件以 `defineComponent({ web, text })` 提供显式双面：web 返回 ReactNode，text 返回 string。
- [ ] web/text 不读取 Selection、AttemptHandle 或 artifact，不调用 `.data()`，不重新格式化业务值。
- [ ] web 用 `ctx.attemptHref(ref)`，text 用 `ctx.attemptCommand(ref)`；model 不硬编码 URL 或 CLI 字符串。
- [ ] text 输出只在整份报告末尾给一次命令模板，避免每个 Attempt 重复长命令。
- [ ] 加 token 预算测试：给定 N 个 experiment/Eval/Attempt，text 输出增长主要来自实体事实，不来自重复命令。

### 清理旧组件与默认报告

- [ ] 默认报告改为 `MetricScatter + ExperimentList`，两者消费宿主注入的同一 Selection。
- [ ] 删除 `ExperimentTable` 公共 API、类型、计算、web/text faces 与测试。
- [ ] 删除 `CaseList`；失败/通过 Attempt 都由可过滤的 `AttemptList` 表达。
- [ ] 删除 `MetricTable.expand` 及其子行证据逻辑；`MetricTable` 只表达维度 × 指标。
- [ ] 更新内置报告与用户报告等价测试：相同 model 在 built-in 和包外 `defineReport` 中产生相同事实。
- [ ] show/view 继续允许不同排版，但必须比较同一 component model 和 AttemptEvidence。

### CLI 与错误模型

- [ ] `show` 参数解析先识别 `@locator`，再处理 Eval 前缀；不把 locator 混成 agent/URL/运行配置。
- [ ] `--eval`、`--execution`、`--diff` 只接受单个 locator；多 locator 或与报告槽冲突时给直接下一步。
- [ ] 旧 `--attempt`、`--transcript`、`--trace` 的去留一次裁决；beta 允许删除，不保留隐式别名造成双模型。
- [ ] 所有新错误加入 `src/i18n/` 两种语言，并由 CLI 测试覆盖。
- [ ] `--help`、CLI reference 与随包 `INDEX.md` 同步反馈闭环。

### 测试与格式迁移

- [ ] Results writer/reader/copy 测试覆盖 locator、Eval source、SourceLoc、events、trace、diff 与 schemaVersion。
- [ ] locator 测试覆盖多 experiment、同 Eval 多 Attempt、历史快照、合成 Selection、resume/carry、copy 与碰撞。
- [ ] ExecutionTree 测试覆盖有 OTel、无 OTel、部分关联、无法关联、Skill load、tool error、长输出截断。
- [ ] 双面组件测试直接比较共享 model；web 断言关键结构，text 断言字符输出，不用大 snapshot 掩盖语义。
- [ ] show/view 等价测试比较 AttemptEvidence 与 component model，不比较 HTML/ASCII 排版。
- [ ] 消费方 e2e 真实 spawn CLI，不直接 import 内部函数；覆盖 cwd/tsconfig/link 问题。
- [ ] 不新增独立校验脚本或 package 命令；守护进入现有 Vitest。

### 删除临时和重复结构

- [ ] 删除全局 React shim、重复 web/text 数据装配、旧 transcript/trace renderer、旧实体组件与失效类型。
- [ ] `rg` 确认公开文档、源码、测试不再把 `ExperimentTable`、`CaseList`、`MetricTable.expand`、分裂的 output/trace 当当前契约。
- [ ] 保留历史设计过程只写 memory；docs 正文只有定稿形态。

## 最终外部验收

实现完成后必须从真实消费方执行：

```bash
cd /Users/ctrdh/Code/coding-agent-memory-evals
pwd
pnpm exec niceeval show
```

从输出选择一个带 `[E,X,⏱]` 的 locator：

```bash
pnpm exec niceeval show @<locator>
pnpm exec niceeval show @<locator> --eval
pnpm exec niceeval show @<locator> --execution
```

预期：默认面是紧凑全景；`--eval` 显示运行时源码和全部断言；`--execution` 显示消息、thinking、Skill、工具调用/结果，并把 OTel 时间贴在相同节点。

选择一个带 `[X]` 但没有 `[⏱]` 的 locator：

```bash
pnpm exec niceeval show @<locator> --execution
```

预期：执行步骤完整，时间明确 unavailable。

选择一个带 `[D]` 的 locator：

```bash
pnpm exec niceeval show @<locator> --diff
pnpm exec niceeval show @<locator> --diff=<输出中列出的文件>
```

预期：先显示工作区文件摘要，再显示单文件补丁。

完成一次真实闭环：

```bash
pnpm exec niceeval exp local <失败的eval-id> --force
pnpm exec niceeval show
pnpm exec niceeval exp local --force
pnpm exec niceeval show
```

局部重跑生成新 locator；旧 locator 仍能打开旧 Attempt。全量命令退出码为 0，最终 show 无新增 failed/errored。

## 仓库内验收

```bash
pnpm run typecheck
pnpm test
pnpm run niceeval -- show --run <fixture-result-root>
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

## 不接受

- 用 `globalThis.React`、当前 cwd 或消费方 tsconfig 修补包内 JSX。
- 把 React 树自动转成 ASCII；或让 text renderer 解析 JSX。
- web/text 各自计算排序、聚合、locator、capability 或证据事实。
- 运行 `show @locator` 时读取当前工作区 Eval 文件解释历史结果。
- locator 使用数组下标、随机临时号或“最新一次”回退。
- 没有 OTel 就隐藏 tool call、Skill load 或 AI 消息。
- 按名字/文本猜 span 对应关系并把不确定耗时贴到事件上。
- 每个 Attempt 重复打印完整 `niceeval show ...` 命令。
- 继续给 `ExperimentTable`、`MetricTable.expand`、`CaseList` 增加例外。
