# PLAN：让 `niceeval show` 与 `niceeval view` 使用同一份现刻水位

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；每个阶段都必须先满足自己的验收条件，再进入下一阶段。
>
> 来源：用户确认的三段垂直切片——统一默认 Selection、建立宿主等价契约测试、收口公开文档与真实 CLI 冒烟。
>
> 范围：只统一 `show` / `view` 报告槽的结果选择与验收契约。不要重做报告组件、Results Format、证据室、历史时间轴或 artifact 布局。

## 开始前必读

按顺序阅读，不能只读本计划：

1. `AGENTS.md`：仓库总规则；特别注意“先文档后代码”、公开行为同步、验证命令和禁止新建 feature branch。
2. `docs-site/AGENTS.md`：中文公开文档术语、写作规则与校验要求。
3. `docs/reports.md`：报告槽、宿主注入 Selection、`defaultReport`、`--report` 的设计契约。
4. `docs/results-lib.md`：`Results`、`Selection`、`Snapshot`、warnings 和 attempt artifact 身份。
5. `docs/view.md`：网页宿主的报告槽与证据室边界。
6. `docs-site/zh/guides/viewing-results.mdx`：用户可观察行为的公开入口。
7. `docs-site/zh/guides/custom-reports.mdx` 与 `docs-site/zh/guides/report-components.mdx`：自定义报告收到的上下文和默认报告口径。
8. 当前实现：
   - `src/show/index.ts`
   - `src/show/compose.ts`
   - `src/view/data.ts`
   - `src/results/select.ts`
   - `src/report/default-report.tsx`
9. 当前测试：
   - `src/show/show.test.ts`
   - `src/view/data.test.ts`
   - `src/view/view-report.test.ts`

动代码前搜索 `results.latest()`、`composeShowSelection`、`defaultReport` 和 `renderReportSlot` 的全部调用。不要根据本计划中的文件列表假设调用点只有这些。

## 完成定义与统一验收

功能完成不是“两个页面看起来差不多”，而是以下机器可验证契约全部成立：

- 在同一个结果根目录、同一组范围参数下，`show` 与 `view` 的报告槽收到同一个 Selection。
- Selection 相等按结构化身份验收，不比较终端字符与 HTML：
  - experiment ID 集合相同；
  - 每个 experiment 下的 eval ID 集合相同；
  - 每个 eval 下的 attempt 原始身份相同（`AttemptRef.snapshot` + `AttemptRef.attempt`）；
  - warnings 的 `kind`、experiment、覆盖分子/分母及相关时间字段相同；
  - 默认报告计算出的 Overview、ExperimentTable、失败清单事实相同。
- 局部补跑不会让裸 `view` 首页只剩局部快照；它与裸 `show` 一样，从历史快照补齐每个 experiment × eval 的最新判定。
- `--run`、eval ID 前缀、`--experiment`、`--report` 不创建第二套选择规则。
- `viewData.snapshots` 仍可携带历史快照供证据室浏览；“报告槽 Selection”与“证据室可浏览历史”是两条独立数据通道，不能为了等价而删除历史证据。
- `--history` 仍是 `show` 专属趋势视图，不被现刻水位选择器收编。
- `show` 的 text 面与 `view` 的 web 面允许排版、交互、本地化不同；只有事实、范围和计算公式必须相同。

最终统一运行：

```bash
pnpm run typecheck
pnpm test
pnpm run niceeval -- show
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

真实 CLI 冒烟需要一个临时结果 fixture 或现有测试 fixture。不要依赖开发者机器恰好已有的 `.niceeval/` 数据；不要把临时 artifact 提交进仓库。

## 长期设计决策

- **默认概念只有一个：现刻水位。** 对每个 experiment × eval，从该 experiment 的历史快照中取包含该 eval 的最新一批 attempts。局部补跑只更新被跑到的 eval，其余 eval 从更早快照补齐。
- **选择发生在宿主渲染之前。** 默认报告与用户 `--report` 都消费宿主注入的同一 Selection；报告定义不能偷偷决定另一套默认范围。
- **选择器属于中性读取/报告编排层。** 不能继续以 `composeShowSelection` 这种 show 专属名字作为两个宿主的事实来源。`view` 不应 import `src/show/` 才能获得默认口径。
- **合成 Selection 不产生新 artifact 身份。** 合成快照只用于报告计算；每个 attempt 必须保留原始 `AttemptRef`，下钻仍能打开真实 `events.json`、`trace.json` 和 `diff.json`。
- **报告与证据室分离。** 报告槽只吃现刻水位；网页证据室继续保留历史快照、深链和 `latest` 展示信息。
- **warnings 随 Selection 生成并传递。** 范围收窄后重新计算覆盖分母；`partial-coverage`、`stale-snapshot`、`unfinished-snapshot` 不允许在任一宿主中静默丢失。
- **不扩大公共 API。** 除非实现证明外部消费者确实需要，否则本次统一选择器先保持包内能力；不要顺手给 `niceeval/results` 新增未经设计的公共导出。

---

## Phase 1：把“现刻水位”变成两个宿主的唯一默认 Selection

**用户故事**：用户在同一目录运行 `niceeval show` 和 `niceeval view`，无论之前是否只补跑过部分 eval，首页报告都回答同一个“现在整体怎样”。

### TODO

- [ ] 先重写 `docs/reports.md` 和 `docs/view.md` 中受影响小节，声明两个宿主裸跑都使用“每个 experiment × eval 最新判定”的现刻水位；不要写历史差分句。
- [ ] 选择一个中性模块安放现刻水位选择器。优先放在 results 读取层附近或独立的宿主选择模块；不要让 `view` 继续依赖 `src/show/compose.ts`。
- [ ] 从 `src/show/compose.ts` 拆出 Selection 合成逻辑；show 专属的 history 计算仍留在 show 边界。
- [ ] 让 `show` 无条件调用中性选择器，并传入 eval 前缀与 experiment 范围。
- [ ] 让 `view` 无条件调用同一个中性选择器；删除“只有 narrowed 才合成，否则 `results.latest()`”的分支。
- [ ] 保持 `view` 的 `baseSelection = results.latest()` 只用于证据室快照的 `latest` 标记时，给变量和注释明确命名，避免它再次被误用为报告 Selection。
- [ ] 确认 `--report` 只替换报告定义，不改变传入 Selection。
- [ ] 更新所有声称裸 `view` 使用 `results.latest()` 的测试名、注释和断言。

### 实现思路

建议把现有 `composeShowSelection(results, options)` 演进为中性函数，例如 `selectCurrentResults(results, scope)`。名字可以调整，但必须表达“选择现刻水位”，不能带 `show` / `view` 宿主名。

输入保持简单：

```ts
interface ResultScope {
  experiment?: string;
  patterns?: string[];
}
```

算法保持确定性：

1. 按 experiment 分段前缀过滤实验。
2. 对每个实验按快照新到旧扫描。
3. 对范围内每个 eval ID，第一次遇到时收下该快照中的整个 Eval，包括它的全部 attempts。
4. 按 eval ID 稳定排序，构成报告用的合成 Snapshot。
5. attempt 句柄原样复用，不复制或重写 ref。
6. 基于合成后的覆盖范围计算 warnings。
7. 用既有 Selection 构造入口返回 Selection，保留 `Selection.filter()` 等行为。

不要把历史快照中的 attempts 平铺后按 eval 聚合；同一 eval 的全部 attempts 必须整批取自包含它的最新快照，否则会把不同运行的重试混成一次虚构运行。

合成 Snapshot 的元数据只服务报告分组和数据来源展示：experiment/agent/model/schema/producer 沿用该 experiment 当前读取模型的稳定元数据；`startedAt` 取被选 eval 来源中的最新时间。所有证据身份必须来自 attempt 自己的 ref，不能依赖合成 Snapshot 的 `dir` 猜路径。

### 代码要求

- 不复制选择算法到两个宿主。
- 不在 report 组件中读文件或重选快照。
- 不改变 Results Format，不迁移磁盘数据。
- 不修改 `viewData.snapshots` 的历史证据保留和跨快照去重逻辑，除非测试证明它因本次选择器移动而必须做最小适配。
- 错误信息继续走现有 i18n；不要新增只有英文的 CLI 用户错误。
- 注释写约束与原因，不复述代码步骤。
- 不新增 package.json 命令或独立校验脚本。

### Acceptance criteria

- [ ] 构造周一全量 `q1 + q2`、周二只补跑 `q1` 的结果：裸 `show` 与裸 `view` 的报告都包含 q1 的周二 attempts 和 q2 的周一 attempts。
- [ ] 同一 fixture 中，报告不再显示“只覆盖 1/2”这一伪残缺警告；若历史上确实从未产生 q2 结果，仍显示真实 `partial-coverage`。
- [ ] `viewData.snapshots` 仍包含可浏览的周一、周二证据，历史深链可达。
- [ ] `--report` 收到的 Selection 与默认报告相同。
- [ ] `pnpm run typecheck` 与相关 show/view 测试通过。

---

## Phase 2：建立宿主等价契约测试

**用户故事**：以后其他 agent 修改 Results、Reports、show 或 view 时，CI 会在事实口径漂移的第一刻失败。

### TODO

- [ ] 提取测试专用的 Selection 身份归一化 helper，输出稳定、可读的普通对象。
- [ ] 让 show 的测试入口能够观察“传给报告渲染器的 Selection”，不要靠正则解析终端表格反推出数据。
- [ ] 让 view 的测试入口观察同一层级的 Selection，或让两个宿主共同调用的选择入口成为直接契约测试对象。
- [ ] 再增加一层默认报告计算结果对照，保证即使 Selection 相同，宿主没有在下游换公式或漏 warning。
- [ ] 用表驱动 fixture 覆盖默认、范围过滤和历史组合。
- [ ] 保留少量最终 text/HTML 断言，证明两条真实渲染路径仍接通；不要用大段 snapshot 把排版差异误当事实契约。

### 建议的归一化形状

测试 helper 可以生成类似结构：

```ts
{
  warnings: selection.warnings.map(normalizeWarning),
  experiments: selection.snapshots.map(snapshot => ({
    experimentId: snapshot.experimentId,
    evals: snapshot.evals.map(ev => ({
      evalId: ev.id,
      attempts: ev.attempts.map(a => ({
        snapshot: a.ref.snapshot,
        attempt: a.ref.attempt,
        verdict: a.result.verdict,
      })),
    })),
  })),
}
```

数组顺序应由生产逻辑保证稳定；helper 不应过度排序到掩盖生产代码的不确定顺序。时间、成本和 verdict 应保留，绝对宿主机路径、随机临时目录前缀应归一化。

### 必测场景

1. 单 experiment、单快照、单 attempt。
2. 全量快照后局部补跑一个 eval。
3. 同一 eval 多 attempts：最新快照整批替换旧 attempts。
4. 多 experiment，更新时间不同，产生 `stale-snapshot`。
5. 未完成快照，产生 `unfinished-snapshot`。
6. 历史已知 eval 从未有可读结果，产生真实 `partial-coverage`。
7. eval ID 前缀过滤，覆盖分母同步收窄。
8. `--experiment` 分段前缀过滤。
9. `--run` 指向单个结果根。
10. `--report` 与裸默认报告接收相同 Selection。
11. resume 携带的复印件不重复计票，证据 ref 仍指向可读 artifact。

### 代码要求

- 测试走现有 Vitest。
- 优先复用现有结果 writer 或 fixture helper生成真实布局，不手写与 Results Format 可能漂移的半套 JSON。
- 等价测试比较结构化事实，不比较 ANSI、空格、HTML class 或本地化文案。
- 最终宿主冒烟仍需断言 text 和 HTML 中各有一个来自同一结果的稳定标识，防止某一宿主根本没渲染。
- 不为了测试导出大量生产内部函数；若必须增加 seam，使用最小的依赖注入或中性选择函数的直接测试。

### Acceptance criteria

- [ ] 任意一个宿主改回裸 `results.latest()` 时，局部补跑用例必然失败。
- [ ] 任意一个宿主丢掉 Selection warnings 时，契约测试必然失败。
- [ ] 任意一个实现把新旧快照 attempts 混装时，多 attempt 用例必然失败。
- [ ] text 与 web 渲染各至少经过一次真实默认报告路径。
- [ ] `pnpm test` 全部通过，无新增独立测试命令。

---

## Phase 3：恢复简单公开契约并完成真实 CLI 验收

**用户故事**：人和 coding agent 只看中文公开文档，就能理解两扇门、完成下钻，并确信两边的默认数字一致。

### TODO

- [ ] 在实现和测试通过后，重写 `docs-site/zh/guides/viewing-results.mdx` 开头与 view 小节：`show` 是默认报告的 text 面，`view` 是 web 面；两边使用同一份现刻水位 Selection。
- [ ] 删除为了描述当前阶段性差异而写的“裸 view 只取每个 experiment 最新快照”说明。
- [ ] 核对 `docs-site/zh/reference/cli.mdx` 的 `show` / `view` 命令说明、flags 和范围语义。
- [ ] 核对 quickstart、中文首页、introduction、自定义报告和报告组件页面，没有继续把 `view` 写成“最近一次运行”而与现刻水位冲突。
- [ ] 若公开 CLI/TSDoc 注释发生变化，改源码紧邻注释并运行 `pnpm docs:reference`，不要手改 GENERATED 区块。
- [ ] 用真实命令执行终端与静态网页两条路径。

### 真实验收步骤

准备一个临时结果根，至少包含：一次全量快照和一次只更新单个 eval 的后续快照。然后执行：

```bash
pnpm run niceeval -- show --run <临时结果根>
pnpm run niceeval -- show <eval-id> --run <临时结果根>
pnpm run niceeval -- show <eval-id> --trace --run <临时结果根>
pnpm run niceeval -- view --run <临时结果根> --out <临时输出目录>
```

人工或测试读取导出的 `index.html`，确认：

- show 与 view 都列出全量现刻水位，而不是最后一次局部运行的子集；
- 同一 experiment 的通过率、失败数、成本和失败 eval ID 相同；
- 单 eval 下钻仍选择预期 attempt；
- trace 缺失时给明确提示，存在时能读到对应 artifact；
- 导出页面中的证据深链指向真实复制出来的 artifact。

### 文档要求

- 只写定稿行为，不描述修复历史。
- 中文页面先定稿，不顺手改英文页面。
- 术语使用 `Selection`、结果快照、默认报告、判定、Attempt、Artifact；不要发明“选集”“默认榜单”等别名。
- AI 阅读闭环保留：`show` → 单 eval → transcript/trace/diff → 原始 artifact → 重跑验收。

### Acceptance criteria

- [ ] 公开文档可以用一句话稳定描述：两扇门共用现刻水位 Selection 与默认报告公式，`show` 输出 text，`view` 输出 web 并提供交互证据室。
- [ ] CLI reference 中 `show` 与 `view` 都有命令入口，不只列 flags。
- [ ] 真实 `show` 与 `view --out` 冒烟通过。
- [ ] `pnpm run typecheck` 通过。
- [ ] `pnpm test` 通过。
- [ ] `docs:validate` 与 `docs:links` 通过。

---

## 不在本计划内

- 不设计两次 run 的 Compare UI；继续用 `DeltaTable` 自定义报告。
- 不改变 `--history` 的时间轴算法。
- 不改变 artifact schema、目录布局或版本兼容策略。
- 不把 transcript、trace 或 diff 内联进默认报告。
- 不让 web 与 text 排版逐字符一致。
- 不重构所有 `results.latest()` 消费者；只处理官方宿主默认报告语义相关调用点。
- 不新增 feature branch；按仓库规则直接在当前 main 工作树实施，并保护用户已有改动。

## 交付清单

执行 AI 最终回复必须列出：

- 现刻水位选择器的最终代码位置与调用者；
- 被删除的宿主分叉；
- 新增的等价 fixture 场景；
- show/view 结构化验收结果；
- typecheck、完整测试、CLI 冒烟、docs validate、links 的结果；
- 尚未完成或有意排除的事项。

不要只回复“测试通过”。必须说明局部补跑 fixture 中 q1、q2 分别来自哪个快照，并证明两个宿主拿到相同的 attempt refs。
