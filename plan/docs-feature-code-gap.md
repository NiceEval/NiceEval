# Reports 目标契约落地 TODO

本计划只负责把 `docs/feature/reports/**` 的目标契约落实到代码、测试、公开文档和内建报告。
它描述依赖、并行边界与验收条件，不规定提交批次或开发阶段。

`docs/` 是目标契约；`docs/source-map.md` 和测试规范描述当前实现。
迁移时按目标 API 一次切换，不为 Source / Composition / `ctx.data` / `data=` /
`content` page 保留公共兼容层。

## 标记

- `[S]`：串行节点。列出的依赖全部完成后才能开始。
- `[P]`：并行节点。父节点或 `依赖` 满足后，可以与其它 `[P]` 节点同时进行。
- `[X]`：需要真实浏览器、真实进程、候选包或外部凭据的验收。
- `验收`：节点完成的可观察证据；只有代码存在不算完成。

## 已裁决前提

实现不得重新打开以下问题：

- page render 的宿主输入只有 `Sample` 或 `AttemptEvidence`。
  外部业务数据由报告 import 冻结快照模块；没有 External 泛型、第二参数、`--data`
  或 `config.reportData`。
- `rollup()` 的产物固定 `basis: "eval"`。
  samples / total 数 Experiment × Eval 单元；refs 恒为 Attempt locator。
- coverage 缺口计入 total，不进入终值，不伪造 refs。
- `aggregate().by` 在 Eval 级分组，不能把同一道题的 attempts 分开。
- 维度视觉分配以页为单位；槽位为 1–24。
  未固定值只保证页内一致，跨页一致必须使用 `dimensionPins`。
- `dimensionPins` 装载期只校验结构、非空键和槽位范围，不检查未知维度名。
- Sample 派生图表默认校验证据；`external: true` 是可搜索的显式退出，
  NiceEval 不验证外部行的真实来源。
- Source / Composition / `ctx.data` 公共作者面已删除；`defineMeasure` 与 metric-views
  内部路径本轮回撤；文档与测试登记随代码目录一并收口。

## 树形 TODO

- [ ] `[S]` 完成 Reports 目标契约

  - [x] `[S]` 关闭唯一剩余的跨层前置：coverage 缺口的分组事实

    - [x] 在 Sample 契约中为每个 `SampleCoverage` 保留确定的 Experiment 锚点 Run。
      `latestRunSample()` 使用 latest Run；
      `currentSample()` 使用确定该 Experiment 可比性配置的 latest Run。
    - [x] 将分组主体定稿为至少包含
      `{ experimentId, evalId, run }`，且不向分组函数暴露 attempts。
    - [x] 明确官方分组的事实来源：
      `experiment` 读 experimentId，`agent` / `model` 读 Run 顶层，
      flags / labels / 运行配置读 `run.experiment`。
    - [x] 同步：
      `docs/feature/sample/**`、
      `docs/feature/record/architecture.md`、
      `docs/feature/reports/{architecture,library}.md`、
      `memory/report-aggregation-subject-eval-cell.md` 与 `memory/INDEX.md`。
    - [x] 先在
      `docs/engineering/testing/unit/{sample,reports}.md`
      登记锚点选择、全缺口 Experiment 和分组口径的覆盖类别。

    验收：

    - 文档能唯一回答“零 attempt 的 Eval 按 agent 分到哪一行”。
    - `pnpm test:docs` 通过。
    - `rg` 不再命中只含 `{ evalId, experiment }` 的旧主体形状。

  - [x] `[P]` 建立普通值计算内核（依赖：coverage 分组事实）

    - [x] `[P]` Reducer
      - 实现带稳定身份的 `mean`、`sum`、`min`、`max`、`percentile(p)`。
      - 空集合返回 `null`；percentile 参数和插值规则符合契约。
    - [x] `[P]` 证据结果值
      - 实现 `MetricValue` / `metricValue()`。
      - 实现 `EvidenceRow` / `evidenceRow()`。
      - 守住 `0 <= samples <= total`、refs 稳定去重、JSON 往返无需水化。
    - [x] `[S]` `rollup()`（依赖：Reducer + 证据结果值）
      - Attempt 取值后先题内折叠，再跨 Eval 折叠。
      - `null` Attempt 留在 refs，不进入题级值。
      - 缺口 Eval 进入 total，不进入 samples、value 或 refs。
      - 输出固定 `basis: "eval"`，顺序与字节稳定。
    - [x] `[S]` `aggregate()`（依赖：rollup）
      - 由 Sample coverage 和 attempts 建立完整 Experiment × Eval 单元。
      - 在 Eval 级执行 `by`，再执行 Calculation。
      - `by` / `values` 键互斥，`refs` 为保留键；类型与运行时都拒绝冲突。
      - 分组函数错误包含字段名与 Experiment × Eval 坐标。
    - [x] `[P]` 官方函数（依赖：aggregate）
      - Calculation：`passRate`、`costUSD`、`durationMs`、`tokens`、
        `totalScore` 等。
      - GroupFunction：`agent`、`model`、`experiment`、`evalId`、
        flags / labels / 运行配置投影。
    - [x] `[P]` 普通转换（依赖：证据结果值）
      - `toAttemptRows()`、`toExperimentRows()`、`toConversationTurns()`、
        `toDiffFiles()`、`toTraceNodes()` 等立即执行函数。
      - 异步 artifact 读取由 page render 显式 `await`，不注册查询对象。
    - [x] 将新计算 API 从 `niceeval/report` 导出；
      更新对应 TSDoc 和类型 fixture。

    验收：

    - 区分力 fixture 至少覆盖：
      attempts 数量不等、题内部分 null、题内全 null、零 attempt coverage、
      多 Experiment 分组、全缺口 Experiment。
    - 删除 coverage 单元或把 basis 改回 attempt 时，相关测试必须失败。
    - `pnpm test` 与 `pnpm run typecheck` 通过。

  - [x] `[P]` 把 ReportDefinition 切到惰性 page render（依赖：coverage 分组事实）

    - [x] `[P]` 定义面
      - `ReportPage.content` 改为 `render`。
      - 输入判别统一为 `"sample"` / `"attempt"`。
      - 提供 `defineReport(render)` 单页缩写，规范化为 `report` page。
      - page 清单静态非空、id 唯一；至多一张不进导航的 attempt page。
    - [x] `[P]` 外壳
      - 穷尽为 `title`、`theme`、`dimensionPins`、`head`、`pages`。
      - links / footer 改为普通组件组合；装载期拒绝 LEGACY
        `links` / `footer` / `scripts` / `styles` / `content`。
      - 组件脚本与样式移交 renderer assets；站点级注入才进入 `head`。
    - [x] `[S]` 唯一 page 执行入口（依赖：定义面 + 外壳）
      - 选择 page、校验输入分支、执行并 await render、校验完整结果树。
      - 同一 page 实例缓存 render Promise；text / web / locale 投影不重复执行。
      - 本地模式只执行被请求或已订阅 page；静态导出执行全部 page。
      - 单页失败隔离；静态导出失败不留下半套目录。
    - [x] 删除 runtime 对 Source memo、Composition 展开、`ctx.resolve`
      和 `ctx.data` 的依赖。

    验收：

    - 装载报告不执行 render；打开一页不执行兄弟页。
    - 同一实例的 text/web 与 en/zh-CN 投影，render 调用计数均为 1。
    - page 输入错位、未知 page、非法外壳和 render 失败都有完整用户反馈。
    - `pnpm test` 与 `pnpm run typecheck` 通过。

  - [x] `[P]` 建立普通值双面 renderer 协议（依赖：coverage 分组事实）

    - [x] `defineRenderer({ text, web, assets? })`
      - text 与 web 必填。
      - 输入只允许已经计算好的普通值。
      - renderer context 不提供 Sample、Record、Source、IO 或异步取数。
    - [x] renderer assets
      - 声明本地资产时显式传 `import.meta.url`，只接受浏览器可直接执行的
        `.js` / `.mjs` 与 `.css`，不把 TypeScript 源码原样发给浏览器。
      - 当前页只收实际出现 renderer 的 assets。
      - CSS / JS 按内容哈希去重，输出顺序确定。
      - text 不加载 web assets；初始 HTML 不依赖增强脚本才可读。
    - [x] 建立 `niceeval/report/extension` 公共子路径；
      `niceeval/report/react` 只保留纯 Web 显示面。

    验收：

    - 缺任一 renderer、非法 asset、不可序列化输入按完整用户反馈失败。
    - 未使用组件的 asset 不进入页面或静态导出。
    - package export 与消费方编译 fixture 通过。
    - `pnpm run build:report`、`pnpm test`、`pnpm run typecheck` 通过。

  - [x] `[P]` 把组件迁成角色明确的普通值 props（依赖：计算内核 + renderer 协议）

    - [x] `[P]` 布局与基础原语
      - `Page`、`Stack`、`Row`、`Col`、`Grid`、`Section` 只负责结构。
      - `Table rows={...}`、`Stat value={...}`、`Callouts items={...}`。
      - 删除通用 `source` / `data` / `input` 绑定。
      - 内部实体列表通过不公开的 `TableContentView` 复用富 Cell 双面实现；
        公开 `Table` 只有 `rows=` 一条数据轨。
    - [x] `[P]` 图表
      - 提供 `Scatter`、`Line`、`Bars`、`Area`（已从 `niceeval/report` 公开导出）。
      - Sample 派生路径校验 EvidenceRow、MetricValue 和 refs。
      - `external: true` 只退出证据校验，不伪造 Attempt 下钻。
      - `Chart` 只保留多 mark 组合用途。
      - 说明：Bars 的 `sort` / `limit` 在 `marks.tsx` 显示层实现（不重新聚合）；
        类别轴经 Dataset 维度字段进入 Chart 内核。
    - [x] `[P]` Attempt 与证据显示
      - `AttemptDetails attempt={evidence}` 作为公开组合。
      - Conversation、Waterfall、SourceView、DiffView、CopyBlock
        接收已经转换好的具体值。
      - `AttemptList attempts={...}` 只作为同步转换加 Table 的薄组合。
    - [x] `[P]` 页级维度呈现
      - 保留 label keyset / visual keyset 分离。
      - 固定值原样占 1–24 槽；未固定值稳定哈希并探测剩余槽。
      - 固定但未出现的值不占槽；visual keyset 超过 24 拒绝该页。
      - text 面只消费 label，不暴露颜色、线型或 pattern。
    - [x] `[S]` 删除能由通用原语装配出的领域 renderer（依赖：以上组件族）；
      只保留提供新显示形状的组件。
      说明：`metric-views/**` 已删；`src/report/slices`（delta / stability）与
      entity-lists Content 是 show / 内部投影路径，不是公开领域 renderer。

    验收：

    - 公开组件 props 中不再出现 `SourceInput`、`DataProps`、`source | data`
      或待 resolve 的查询对象。
    - 同一结果 fixture 的 text/web 面拥有相同事实值、覆盖和 refs；
      排版差异不在单元层逐字比较。
    - 页内声明顺序变化不改变维度槽位；第 25 个视觉身份明确失败。
    - `pnpm run build:report`、`pnpm test`、`pnpm run typecheck` 通过。

  - [x] `[P]` 重写内建报告（依赖：计算内核 + page render + 普通值组件）

    - [x] 用公开 Calculation、普通转换和公开组件装配 standard 报告。
    - [x] 保留 Overview、Attempts、Traces 三张 sample page，
      以及一张不进导航的 attempt page。
    - [x] 内建报告不 import 私有 compute、私有 renderer 或宿主专用数据通道。
    - [x] `show` 默认摘要 / JSON 结果与内建 page 复用同一任务 Result，
      不维护第二套聚合口径。

    验收：

    - 内建报告可以作为普通 `ReportDefinition` 被 show/view 装载。
    - 代表性自定义报告只用公开入口即可复刻内建页的核心能力。
    - 内建报告与公共计算函数对同一 Sample 的 value、samples、total、refs 一致。
    - `pnpm run build:report`、`pnpm test`、`pnpm run typecheck` 通过。

  - [x] `[S]` 迁移 show/view 宿主（依赖：page render + renderer 协议 + 内建报告）

    - [x] show 与 view 共用同一份报告装载、规范化、page 执行和标题回退。
    - [x] show 渲染初始页并输出其它页索引命令；
      attempt locator 只在报告声明 attempt page 时可下钻。
    - [x] view 本地 server 按订阅执行 page；
      watch 报告及项目内 import 图，包含冻结快照模块。
    - [x] 静态导出全量执行 page，物化当前页 renderer assets，
      保持 artifact 与 locator 深链自包含。
    - [x] 删除宿主对旧 links / footer / scripts / styles 外壳字段、
      Source resolve 和 External 数据注入的消费。

    验收：

    - show/view 对同一 Sample、报告 import 图和 NiceEval 版本产生同源结果。
    - 修改冻结快照模块会触发 view 重建；没有 `--data` 或配置旁路。
    - 本地 server 与 `view --out` 对同一 page 的 HTML 逐字节一致。
    - `pnpm run view:build`、`pnpm run build:report`、
      `pnpm test`、`pnpm run typecheck` 通过。

  - [x] `[S]` 删除旧 Reports 模型（依赖：所有代码消费者已迁移）

    - [x] 删除公共与内部的 Source / Composition、`ctx.resolve` / `ctx.data`。
    - [x] 删除 Source 侧记忆化取数路径；`ResolveMemo` 仅保留为树 resolve 缓存
      （不从 `niceeval/report` 导出）；`report/slices` 保留为 show 切片计算。
    - [x] 删除 `defineMeasure` API 与 `metric-views/**` 目录；
      chart-math / plot 迁至 `src/report/model/chart/`；
      show 仍用的 delta / stability 迁至 `src/report/slices/`。
      说明：Cell / Dataset 统一 `kind: "metric"` + `MetricValue`；
      内部 AttemptMetric 字面量服务 aggregate / Chart；无 `defineMeasure` /
      `MeasureCell` 公开符号。
    - [x] 删除 `ReportPage.content`、`input: "scope"`、
      Table 三轨 props 和旧外壳字段。
    - [x] 删除过渡导出、死类型、死 fixture 和只证明旧协议的测试。
    - [x] 检查 `package.json#exports`、bundled index 和 `dist/report/**`
      不再发布旧入口（仅 `./report`、`./report/react`、`./report/built-in`、
      `./report/extension` 与静态 assets）。
      `build:report` 先清理专用 `dist` 输出树，避免已删除源码留下的旧 `.js` /
      `.d.ts` 混入 tarball。

    验收：

    - `rg` 对旧标识的命中只允许出现在 memory、迁移计划或明确引用历史的文本中。
    - 从已打包 tarball 的公共入口无法 import 旧 API。
    - `pnpm run prepare`、`pnpm test`、`pnpm run typecheck` 通过。

  - [x] `[S]` 收口文档、测试登记与实现地图（依赖：旧模型删除）

    - [x] 按目录删除 `docs/feature/reports/components/sources/**`；
      外链改指 `library.md` / `calculations.md` / primitives。
    - [x] 将 callouts、copy-block、charts、attempt 与 shell 文档改为最终普通值 props
      （`docs/feature/reports/**`；`docs-site/zh/**` 与英文入口另 agent 收口）。
    - [x] 更新 `docs/engineering/testing/unit/reports.md`：
      删除旧覆盖类别，只保留已经由目标契约声明的新类别。
    - [x] 更新 `docs/source-map.md` 为最终源码落点，不保留“当前/目标”双写。
    - [x] 统一 `docs/feature/reports/**` 普通值作者口径：
      `AggregationSubject` 分组、`basis: "eval"`、无 Source/`defineMeasure`/
      `components/sources/**` 假路径；`library/measures.md` 恢复
      `#题型构成与主读数` / `#维度与数值轴` 锚点。
    - [x] 同步 `docs-site/zh/**`、源码 TSDoc、生成参考和可运行示例。
      汇合验收：`pnpm test:docs` 与 Node 22 下 `pnpm test:docs-site` 绿。
    - [x] 新的翻案或反直觉实现约束写入 memory 并挂入 INDEX；
      普通迁移过程不写 memory。

    验收：

    - `pnpm docs:reference` 后工作树没有生成区块漂移。
    - `pnpm test:docs` 通过。
    - `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:docs-site` 通过。
    - 示例按 `examples/README.md` 的对应命令通过。

  - [ ] `[X]` 完成真实用户路径验收（依赖：文档与实现收口）

    **环境阻塞（2026-07-29）**：网关 `Insufficient Balance`（exit 75 / infra）。
    脚本与夹具已对齐工作树口径；**未**完成真实浏览器 / 候选包端到端绿跑，
    下列三项保持未勾，不假勾。

    已就绪（不算验收通过）：

    - flag / 夹具：`--record`、`openRecord`、`run.json`、`latestRun`、
      `--rerun all`；自定义报告 `site.tsx` / `branded.tsx` 用公开 plain-value API
      （`kind: "metric"` + `MetricValue`）。
    - 真实验收必须走编排器候选 tarball（`pnpm pack` 工作树），不能仓库根旁路
      `pnpm exec niceeval`；独立 `cd e2e/report && pnpm e2e`（lock 钉 0.10.2）不算。
    - 编排器已能注入候选包并跑到 `produceEvidence()`，卡在余额不足。

    一键命令（余额充足后）：

    ```bash
    # 需要 Node >=22、e2e/report/.env 里可用的 OPENAI_*（余额充足）、
    # Playwright Chromium（postinstall 会装）
    pnpm e2e --repo report
    ```

    - [ ] 在 `e2e/report/` 使用候选包验证：
      默认报告、自定义单页、多页、attempt page、自定义 renderer、
      冻结快照 import 和静态导出。
    - [ ] 用真实浏览器验证：
      导航、折叠、过滤、locator 深链、零 JS 基线和 renderer assets。
    - [ ] 验证消费方无 tsconfig、classic JSX、react-jsx 三种配置，
      均从 package-owned 预编译入口装载。

    验收：

    - `e2e/report/` 经编排器注入候选包后 `pnpm e2e` 返回 0。
    - 候选包指纹核验通过，验收未从仓库 `src/` 旁路导入。
    - 失败时保留 `.niceeval/`、导出站、日志和浏览器证据供定位。

## 并行关系摘要

```text
coverage 分组事实
├── 计算内核 ───────────────────────┐
├── page render ───────────────┐     │
└── renderer 协议 ─────────┐   │     │
                           └── 普通值组件
                                │    │
                                ├────┴── 内建报告
                                │           │
page render ────────────────────┴───────────┤
renderer 协议 ─────────────────────────────┤
                                            ▼
                                      show / view
                                            │
                                            ▼
                                      删除旧模型
                                            │
                                            ▼
                                 文档与实现地图收口
                                            │
                                            ▼
                                      真实 E2E 验收
```

计算内核、page render 与 renderer 协议是第一组并行主干。
普通值组件在计算内核和 renderer 协议完成后开始；
内建报告在计算、page 与组件完成后开始。
show/view 必须等 page、renderer 和内建报告汇合。
旧模型删除、文档最终收口与 E2E 是三段串行尾链。

## 整体完成定义

以下条件必须同时成立：

- 目标作者路径只有
  `Sample / AttemptEvidence → 普通函数 → 可序列化结果值 → 组件 → text/web`。
- coverage 缺口在所有官方与自定义分组下都有确定归属，total 不会因缺 attempt 静默缩水。
- show、view、内建报告和 JSON 出口不维护重复聚合口径。
- 公共包、源码、Feature 文档、测试覆盖规范、Source Map、docs-site 与示例使用同一代模型。
- `pnpm run prepare`、`pnpm run typecheck`、`pnpm test`、`pnpm test:docs` 全部通过。
- Node 22 下 `pnpm test:docs-site` 通过。
- `e2e/report/` 对候选包的真实验收通过。
