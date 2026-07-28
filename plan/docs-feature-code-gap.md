# `docs/feature` 目标契约落地 TODO

本计划基于 2026-07-27 的 `docs/feature/**`、`docs/source-map.md` 与实际源码核对结果。
`docs/` 是目标契约，任务默认修实现，不把契约降格成当前代码。本文只安排工作，不分阶段；
树上的依赖标记决定先后关系。

## 标记

- `[S]`：与父节点或列出的依赖串行，前置未完成不能开工。
- `[P]`：依赖满足后可与其它 `[P]` 兄弟并行。
- `[X]`：需要真实外部服务、凭据或制品发布，代码完成不等于任务完成。
- 每个叶子任务都要同时交付：实现、目标契约已登记类别内的测试、公开出口/示例同步、Source Map 差异删除。
- niceeval 仍是 beta；迁移按目标 API 一次完成，不为旧 Results / Scope / Snapshot、Metric 或 `from*`
  公开名保留兼容壳。仓库内部可在一个提交内使用临时适配层，但合并态不得形成两套公共模型。

## 差异结论

```text
docs/feature 目标
├── Record / Sample：目标包与形状尚未落地
│   └── 当前仍是 niceeval/results + Results / Snapshot / Scope + snapshot.json
├── Experiments / Sandbox：身份、重跑与复用尚未闭环
│   └── 当前仍是浅层 fingerprint、--force、provenanceFlags、逐 Attempt Sandbox
├── Reports：目标 Source / Composition / Component 作者模型尚未落地
│   └── 当前仍是 Metric、*Data、专用双面 renderer 与 Scope 命名
├── Eval Source / View：调用树、持续重建、主题和完整静态制品尚未落地
├── Judge：调用失败仍可能变成 0 分
├── Adapters：转换器公开名仍是 from*
├── O11y：沙箱内 __niceeval__/results.json 尚未写入
└── E2B：公共 baseline 仍指向旧 v0.6.1 制品
```

## 树形 TODO

- [ ] 完成 `docs/feature` 与实现一致
  - [ ] `[S]` 建立 Record 事实层，这是 Sample、缓存、源码证据和 View 的共同前置
    - [ ] `[S]` 把磁盘术语与布局迁到目标形状
      - `snapshot.json` / `SnapshotMeta` / snapshot 目录知识改为 `run.json` / `RunMeta` / Run。
      - 将格式、reader、writer、locator、artifact registry 收敛到 `src/record/**` 所有权边界；
        `src/results/**` 不再作为公共概念边界。
      - `RunMeta` 落全契约字段，尤其是 `configHash`、producer、selected/known eval 身份与完成时刻。
      - 保持原子写、版本分流、坏 Run 分类、locator 唯一性和七类 artifact 的懒加载语义。
    - [ ] `[S]` 落地 `niceeval/record` 公共子路径
      - 导出 `openRecord`、`createWriter`、`publish`、`resolveLocator` 及 Record / Run /
        AttemptHandle / AttemptRef 类型；同步 `package.json#exports` 与 bundled index。
      - 将 runner artifacts reporter、show、view、report harness 全部切到新入口。
      - 删除 `niceeval/results`、`openResults`、`createResultsWriter`、`copySnapshots` 等旧公共出口和旧命名。
    - [ ] `[P]` 在 Record reader 闭合证据完整性
      - 计算 `evidenceState: "local" | "borrowed" | "dangling"`，不再用 `null` 混淆未产生与已丢失。
      - 让 `publish()` 对 dangling 整体失败；借用证据解引用、重新去重并形成自包含发布根。
      - 选择器可消费 `dangling-evidence` 与 `missing-startedAt` 的结构化事实。
    - [ ] `[P]` 在 Record writer 闭合源码存储
      - `sources.json` 只保存 `{ path, sha256 }[]` 引用，正文写到 Run 级 `sources/<sha256>.json`。
      - 携带和 publish 时按原 Run 解引用；commands/events/trace/diff 等 registry 行为保持单源。
    - [ ] `[S]` 迁移 CLI 记录根语法
      - show/view 使用 `--record` 与 `--run`，删除 `--results` 与 `--snapshot`。
      - 位置参数始终只表示 eval id 前缀，不按文件系统探测改变含义。

  - [ ] `[S: Record]` 建立 Sample 选择层
    - [ ] `[S]` 落地 `niceeval/sample` 与目标 `Sample` 形状
      - 实现 `latestRunSample(record, options)`、`currentSample(record, options)`。
      - 暴露 `mode`、物化的 `attempts` / `historyAttempts`、真实来源 `runs`、逐实验 `coverage`、
        `issues`；删除 Scope / ScopeWarning / warnings 旧公共模型。
      - `currentSample` 只缝合 `configHash` 相同的 Run；缺 hash 的 Run 只与自身可比。
    - [ ] `[P]` 实现闭集转换算子
      - `sample.pipe(...)` 及 `filterAttempts`、`onlyEvals`、`dropExperiments`、`freshOnly` 等契约算子。
      - 每个算子同步重算 attempts、historyAttempts、runs、coverage、issues，且不修改输入 Sample。
    - [ ] `[P]` 收拢 Sample 身份与 Issue 语义
      - 选择器内置四元组去重，保留最新落盘条目的真实 ref/locator。
      - 落地 `unfinished-run`、`dangling-evidence`、`unreadable-run`、`missing-startedAt`
        Issue 全集；`fresh` 是 attempt 出身口径，不伪装成 Sample 级告警。

  - [ ] `[P: Record]` 修正 Experiments 的身份与缓存链
    - [ ] `[S]` 实现两层嵌套哈希
      - `configHash = hash(resolved config)`，eval fingerprint 再组合 configHash 与 eval 源码闭包。
      - 源码闭包递归跟踪项目内 import 图和 `loadJson` / `loadYaml` 数据内容，排序与路径归一确定。
      - flags 整袋入 hash；移除 `provenanceFlags`。按契约排除 budget、timeoutMs 和运行后 facts。
    - [ ] `[S]` 把 carry 资格统一到一份判定
      - 初次规划与取得用例锁后的二次规划调用同一判定；按具体 attempt 序号携带。
      - 比较 configHash / fingerprint、终态、证据、复用模式和 keep 例外，不再字段深比较。
    - [ ] `[S]` 用目标重跑模型替换 `--force`
      - 实现 `--rerun[=failed|all]` 的解析、选择、机器反馈与帮助文案。
      - 实现一次性 `--carry-ignoring-flag`，在 Run diagnostics 落 `carriedIgnoringFlags`；
        只豁免指定 flag 的搬迁差异，不改长期 fingerprint 规则。

  - [ ] `[P: Record + 缓存判定]` 实现 Sandbox 复用
    - [ ] `[S]` 扩充目标配置与 Provider 能力
      - `ExperimentDef.sandboxReuse` 进入 resolved config 与 configHash。
      - 内置 Sandbox spec 接受 `lifetimeMs`；定义可复用所需 reset/续期能力与不支持时的完整反馈。
    - [ ] `[S]` 将 runner 从逐 Attempt 创建改为复用池调度
      - SandboxSpec setup/teardown 每个 Sandbox 一次；Agent 与 Eval 生命周期仍逐 Attempt 成对。
      - 每题前 reset；reset 失败淘汰实例并新建，不把污染实例交给下一题。
      - 派发前检查剩余寿命，不足则轮换；并发下同一 Sandbox 不被两条 Attempt 同时占用。
    - [ ] `[S]` 实现组合限制
      - `sandboxReuse: true` 禁止 carry，取得锁后仍全量执行。
      - 与 `--keep-sandbox`、`localSandbox()` 及不具备复用能力的自定义 Provider 按契约在创建前报错。
      - 保持 exclusive Provider、全局/实验并发与 teardown 自愈既有语义。

  - [ ] `[P: Record 源码存储]` 落地 Eval Source 调用树
    - [ ] `[S]` 让 `captureLoc()` 捕获项目内完整调用帧，而不是第一帧即返回
      - 为 SourceArtifact 标出唯一 `role: "entry"`；规范化路径、helper 调用链与 package 边界。
      - 源码在调用发生时进入证据采集，读取失败形成结构化 unavailable，不在 Attempt 收尾静默跳过。
    - [ ] `[S]` 实现 `projectSourceView()`
      - 从 entry 建 spine，跨文件 loc 下钻为子 block；未从主干可达的证据进入 detached。
      - package / 缺源码形成 opaque unavailable block；无 loc 的断言仍进入 unmapped，不丢证据。
      - AttemptSource 与计分断言共同消费这一份投影，不按命中数猜主文件。

  - [ ] `[P: Sample]` 迁移 Reports 共享内核与公开作者面
    - [ ] `[S]` 先建立 Source / Composition / Component 运行模型
      - 实现 `defineSource`、`defineComposition`、目标 `defineComponent`，保留对象身份与泛型输入。
      - resolve 顺序固定为 Composition 展开 → Source 解析 → 完整树校验；同层并行、声明顺序不变。
      - page 级缓存键为 Source 对象身份 + input 对象身份，并缓存 Promise；Composition 节点不缓存。
      - `ctx.resolve` 只接受当前 page input 同型 Source；冻结外部数据经 `ctx.data` 注入，禁止 Source
        偷读外部状态。
    - [ ] `[S]` 将 Metric 词表与数据协议迁到目标形状
      - `defineMetric` / `Metric` 改为 `defineMeasure` / `Measure`。
      - `MetricCell` 与各类 `*Data` 改为契约声明的 `MeasureCell`、`*Content`、`*Row`、`*Cell`。
      - `scopeSummaryData` / `ScopeSummary` 改为 `sampleSummary` / `SampleSummaryContent`。
      - 删除报告公共面里的 Results / Snapshot / Scope 词汇。
    - [ ] `[P]` 实现通用 Source 家族
      - sample summary / overview、experiment/eval/attempt rows。
      - measure rows/matrix、scoreboard、delta/stability、chart dataset。
      - attempt summary/assertions/source/conversation/timing/usage/trace/diff。
      - Sample/Run notices、fix prompt 与 execution/trace 诊断源。
    - [ ] `[P]` 实现通用 Component 与布局原语
      - Table / StatGrid / Callouts / Chart、Conversation、SourceView、DiffView、Waterfall、CopyBlock、Markdown。
      - 官方组件只消费 Content，不自行读 Record/Sample，也不保留专用 `*Data` renderer 分叉。
      - 保持 text/web 两面事实一致；排序、过滤、tooltip 等仅作为具名 enhance 渐进增强。
    - [ ] `[P]` 实现页级维度呈现
      - 每个 component 的 `dimensions()` 必填；label keyset 与 visual keyset 分开收集。
      - `ctx.dimension(handle).at(index)` 只能查询已声明值；未声明立即报错。
      - 实现 `presentDimension` / `shortestUniqueLabels`、24 个视觉身份上限、series pins 和 text 降级。
    - [ ] `[S: Source 家族 + Component 原语]` 重写内建 `standard`
      - 用 SampleOverview 与通用源/原语替换 ExperimentComparison、ExperimentList、MetricTable 等专用件。
      - 声明 Overview、Attempts、Traces 三张 sample page 与一张不进导航的 attempt page。
      - 内建报告的 show/view 两面只共享 resolved tree 与 Content，不各算一份口径。
    - [ ] `[S]` 收紧公共导出与构建身份
      - 更新 `niceeval/report`、`niceeval/report/react`、built-in 出口；删除 Metric、Scope 和专用组件旧出口。
      - 保持 raw src 与 `dist/report` 单一模块身份，所有宿主经同一 runtime facade。

  - [ ] `[S: Record + Sample + Reports + Eval Source]` 让 show/view 宿主满足目标契约
    - [ ] `[P]` 共用报告与主题装载链
      - `--report` 按裸内建名/显式路径判别，`standard` 命中内建表，不做文件探测回退。
      - 实现 config.report 与 CLI 的取值链。
      - 实现 `defineTheme`、`basalt`、config.theme、report shell theme 与 `--theme` 四档链；show 明确拒绝 theme。
    - [ ] `[P]` 修正有效根与 locator 寻址
      - 位置参数、`--exp`、`--fresh` 先构造有效根；locator 只在有效根解析。
      - 历史 Attempt 在有效根内可达；范围外不可达，不再清空过滤条件后回扫完整记录根。
    - [ ] `[P]` 修正静态站制品
      - `artifact/` 复制 commands/events/trace/diff、sources 引用及 Run 级正文；不复制 o11y。
      - 携带证据归拢进导出 Run，所有 attempt HTML、assets 与 artifact 路径在子路径/无尾斜杠下成立。
      - 复制与 `publish()` 共用规划、50 MiB 预检和全有全无语义。
    - [ ] `[S: 上述宿主静态能力]` 实现本地持续重建
      - watch 有效记录根、报告/主题的项目内 import 图与项目配置；忽略范围外记录、依赖目录和临时文件。
      - 去抖并合并脏事件；重建期间的新事件只再触发一次，不无限排队。
      - 成功后推送浏览器重载并保留 page/attempt 路由；失败时继续服务上一份站点，同时向终端和页面报告。
      - 本地 server 服务的产物与相同输入的 `--out` 逐字节一致。

  - [ ] `[P: 无主干依赖]` 修复 Judge 调用失败语义
    - [ ] 包住 autoevals 的 HTTP、连接、超时与响应解析边界；缺分数不能 `?? 0`。
    - [ ] 将非 2xx、断连、超时、协议不符/缺分数统一记录为
      `outcome: "unavailable"`、`reason: "judge-call-failed"`，evidence 保存一层状态/异常摘要。
    - [ ] 只对预检允许最多两次传输层重试；实际判分不因隐式重试产生重复费用。
    - [ ] 证明 optional 保留 unavailable 但不改 Verdict，非 optional 使 Attempt errored。

  - [ ] `[P: 无主干依赖]` 迁移 Adapter 转换器公开名
    - [ ] `fromAiSdk` → `turnFromAiSdk`；`fromChatCompletion` / `fromResponses` → `turnFrom*`。
    - [ ] `fromClaudeSdkMessages` / `fromPiAgentEvents` / `fromCodexThreadEvents` /
      `fromLangGraphEvents` → 对应 `create*EventStream`。
    - [ ] 同步实现、测试、TSDoc、`niceeval/adapter` 导出、docs-site、examples 与停用 E2E fixture；
      删除旧别名，保持转换语义逐字节不变。

  - [ ] `[P: 无主干依赖]` 注入沙箱内运行摘要
    - [ ] `[S]` 先在所属 Feature 定稿 `__niceeval__/results.json` 的穷尽形状、写入时点、原子性、
      写失败语义与可见范围。当前只有 Source Map 和外部参考提到目标，Feature 正文不足以指导实现。
    - [ ] `[S]` 契约定稿后定义唯一路径常量与 writer，内容与 `buildO11ySummary()` 同源；不得覆盖
      agent setup manifest，Record 的 `o11y.json` 继续是持久化事实，不复制派生算法。
    - [ ] `[S]` 在 Feature 选定的真实消费边界验收读取结果，证明缺文件、旧内容或静默写失败不会
      让行为断言得到伪造的可信结论。

  - [ ] `[P][X: 无主干依赖]` 发布并切换 E2B 公共 baseline
    - [ ] 用当前 Agent 版本与 recipe revision 生成目标 tag，真实构建 Claude Code、Codex、Bub 三份模板。
    - [ ] 以运行用户验证 Agent CLI、Node/npm global prefix、PATH、写权限与一条实际 eval。
    - [ ] 发布成功后才更新 `sandbox/e2b/published.json` 与 `PUBLISHED_E2B_BASELINE_TAG`；
      不能先让常量指向不存在的制品。
    - [ ] 从公共 ref 新建沙箱再做一次冷启动验收。此任务不涉及 npm publish；niceeval npm 发布仍只走
      `.github/workflows/release.yml`。

  - [ ] `[S: 所有分支]` 收口公共资料与差异台账
    - [ ] 更新 `docs/source-map.md` 的实现落点并删除已完成差异，不在 Feature 正文写实现状态。
    - [ ] 运行 `pnpm docs:reference`，同步 docs-site 中文任务路径、CLI flag、API reference 与 examples。
    - [ ] 删除仅服务旧公共模型的 dead code、旧 locale key、旧 fixture 和旧构建出口。

## 并行与串行关系

```text
Record ──> Sample ──> Reports ──> show/view
   │          │
   │          └───────────────> Reports 数据源与组件（内部可并行）
   ├────> fingerprint/carry ──> sandbox reuse
   └────> Eval Source ─────────> show/view

独立并行：Judge | Adapter 重命名 | results.json 注入 | E2B baseline 发布
最终串行：所有分支合流后，更新公开资料并跑全仓门禁
```

同一工作树直接在 `main` 协作。可并行节点应按所有权拆文件：Record、Sample、Runner/Sandbox、
Report kernel、View、Judge、Adapters、E2B 各自显式提交路径；不要让多个任务同时机械重写
`src/index.ts`、`package.json`、`src/cli.ts` 或生成文件。公共出口变更由对应分支完成后集中串行合并。

## 验收

### 每个叶子任务

- 测试只能实现对应 Feature 测试文档“覆盖规范”已声明的类别；若实现暴露新的契约类别，先补覆盖规范。
- 类型与公共组合：`pnpm run typecheck`。需要同时证明目标子路径可导入、合法组合可推断、禁止组合不编译，
  并证明旧 beta 公共名已经退出。
- 领域规则与组件协作：运行受影响的 Vitest 文件，再运行 `pnpm test`。
- Reports 改动在测试前先 `pnpm run build:report`；View 前端改动运行 `pnpm run view:build`。
- 文档或生成参考变化运行 `pnpm test:docs`、`pnpm docs:reference`、`pnpm test:docs-site`。

### 分支合流验收

| 合流面 | 必须证明 | 命令/观察面 |
|---|---|---|
| Record + Sample + cache | run.json/configHash、两个选择口径、carry/rerun、Issue 与 publish 自包含 | `pnpm test`；`pnpm e2e --repo cli`；`pnpm e2e --repo report` |
| Sandbox reuse | 生命周期次数、reset/轮换、并发独占、carry/keep/local 冲突 | `pnpm test`；`pnpm e2e --group sandbox` |
| Reports + Eval Source + View | Source resolve、两面同口径、调用树、主题、持续重建、静态 artifact 完整 | `pnpm run build:report`；`pnpm run view:build`；`pnpm e2e --repo report` |
| Adapter 名称 | 所有目标导出真实可用，真实协议路径未因改名改变 | `pnpm run typecheck`；对应 `pnpm e2e --repo <id>`，可用仓库按 sdk/sandbox 分组 |
| Judge | 网关故障与低分可区分，optional/非 optional 折叠正确 | `pnpm test`；带真实 Judge 的 E2E/nightly |
| E2B baseline | registry、常量与远端已发布事实一致，运行用户真实启动成功 | `pnpm test`；从每个发布 ref 新建 E2B 沙箱实跑 |

E2E 使用真实模型、网络、Docker/E2B 与凭据；缺少这些条件时不能把“未运行”写成通过，交付记录必须明确
列出未验收的仓库或外部制品。

### 最终完成定义

- `rg` 在公共导出、CLI help、examples 与 docs-site 中不再命中旧 Results / Snapshot / Scope、Metric、
  `fromAiSdk` 等旧公共词汇；历史说明和 memory 不在此零命中要求内。
- `docs/source-map.md` 的“与目标契约的已知实现差异”不再包含本计划条目，且每个目标行为有真实源码落点。
- `pnpm run typecheck`、`pnpm test`、`pnpm test:docs`、`pnpm test:docs-site`、
  `pnpm run prepare` 全绿。
- `pnpm e2e --repo cli` 与 `pnpm e2e --repo report` 全绿；受影响 Adapter/Sandbox 仓库全绿，
  外部基础设施失败必须按 E2E 协议标为 75，不能当产品通过。
- E2B 三份新 tag 已真实存在并通过冷启动，不只是本地常量与台账一致。
- `git status` 中没有误带其它协作者改动；提交按显式路径完成。
