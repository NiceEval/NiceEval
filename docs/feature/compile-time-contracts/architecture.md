# Architecture

公共类型的所有权按阶段划分，不建立一套独立的 schema 系统。
TypeScript 约束与运行时守卫描述同一条不变量。

## 五阶段定义模型

Eval 与 Experiment 依次经过四个边界：

```text
Author Input → Definition → Discovered Definition → Linked Configuration → Planned Run
```

| 阶段 | 可以拥有的事实 | 不得拥有的事实 |
|---|---|---|
| Author Input | 作者选择的行为、配置和 hooks | 路径 id、factory 判别、configHash |
| Definition | 作者事实 + factory 生成的精确判别 | 路径 id、configHash |
| Discovered Definition | Definition + id、来源路径 | configHash |
| Linked Configuration | selector 形成的实际配对、唯一 Sandbox template owner、owner order | Provider 网络结果、BuildKey、CaseKey |
| Planned Run | Provider 只读规划后的运行配置、configHash、BuildKey、CaseKey | 可再次修改的作者输入 |

Runner 内部函数按自己真正消费的阶段收参数。
发现器构造 `DiscoveredEval` 与 `DiscoveredExperiment`，规划器把 configHash 写进 Planned Run，两者都不回写作者定义。
通过制与计分制定义组成以 scoring 判别的 union；Runner 先收窄分支，再以对应 context 调用 test，不用类型断言抹平两种题型。

Linked Configuration 是跨文件硬约束的边界。
单个 `EvalDefinition` 与 `ExperimentDefinition` 都可以合法携带 template-bearing 或 command-only SandboxLayer；只有 discovery 与 selector 完成后，Runner 才知道实际配对。
linker 必须先聚合全部 template conflict 与 missing，再允许任何 Provider I/O 或资源动作。
`niceeval check` 在这里停止，正常运行不能绕过同一份 linked matrix。

## 静态约束与运行时镜像

每条约束都保留两条入口：

| 约束 | TypeScript 入口 | 运行时入口 |
|---|---|---|
| 禁止作者填写派生字段 | 阶段类型 + 模块私有诊断类型字段 | `defineEval` / `defineExperiment` 守卫 |
| page 字段依赖 | PageDefinition union | `defineReport` 规范化 |
| MCP transport 互斥 | 负字段 union | `assertMcpServers` |
| HITL answer 二选一 | AnswerValue XOR | `buildRespondInput` 与 adapter 输入校验 |
| aggregate 键冲突 | options 关系泛型 | `assertNoKeyCollision` |
| EvidenceRow 至少一个读数 | `WithMetricField` 交叉诊断类型 | `evidenceRow` 与 `parseEvidenceRow` 结构校验 |
| chart 字段角色 | 过滤键泛型 | `pointsToDataset` 跨行校验 |
| custom group keep | 输入排除 + 返回推导 | `defineSandboxCase` 规范化 |
| factory 产物身份 | 私有 unique symbol | `isThemeDefinition` / `isReportDefinition` |
| Sandbox template 恰好一份 | layer kind 私有品牌与 factory option 类型 | discovery 后的全矩阵 linker，早于 Provider 网络与资源 |

`never` 与诊断类型的取舍规则、以及每条约束的实测诊断文本，见 [Library](library.md#三级反馈)。

运行时守卫接收 `unknown` 或宽结构时先检查形状，再进入内部精确类型。
内部函数不重复使用公共作者输入类型充当规范化结果。

## 源码改动面

按公共契约族推进，不做一次全仓类型改名：

| 契约族 | 主要落点 | 改法 |
|---|---|---|
| Eval / Experiment | `src/runner/types.ts`、`src/define.ts`、`src/runner/discover.ts` | 新增阶段类型；factory 返回精确 definition；发现函数构造 discovered 类型 |
| HITL | `src/context/types.ts`、`src/agents/types.ts`、`src/context/context.ts` | 提取共享 XOR；builder 补充“双字段”拒绝，不再静默优先 |
| MCP | `src/agents/types.ts`、`src/agents/mcp.ts` | union 增加负字段；保留带 server 名的 setup 守卫 |
| Report page | `src/report/definition/report.ts` | 把输入页拆成普通页与参数化页；规范化输出保持单一 ReportPage |
| 诊断类型 | 一个不从包入口导出的内部模块 | 声明共用的 `CONTRACT_DIAGNOSTIC` symbol 与各条诊断类型 |
| Aggregate / EvidenceRow | `src/report/model/calculation.ts` | 在输入签名增加键关系与 MetricValue 存在性约束；新增 `parseEvidenceRow` / `parseEvidenceRows` |
| Charts | `src/report/definition/primitives/marks.tsx`、`points-dataset.ts` | 恢复泛型组件调用签名；字段 props 使用过滤键 |
| Sandbox case | `src/sandbox/case-types.ts`、`src/sandbox/case.ts`、`single-case.ts` | 从 groupKeep 推导 capability；内部只读规范化结果 |
| Sandbox layer link | `src/sandbox/`、`src/runner/discover.ts`、Runner plan 与 CLI check 入口 | 保留 command/template kind 品牌；对实际 Eval × Experiment 配对统一做 XOR link |
| Theme / Report | `src/report/theme.ts`、`src/report/definition/report.ts` | 把现有运行时 symbol 加入公开接口的私有品牌属性 |
| 导出与定位 | `src/index.ts`、各子路径 index、`docs/source-map.md` | 导出新的作者输入与 definition 类型；更新契约到实现的定位 |

## 落地顺序

重构按依赖从窄到宽推进：

1. 为每条约束增加合法与禁止调用的 typecheck fixture，先固定目标诊断边界。
2. 落地 HITL、MCP、PageDefinition 这三组局部 union，不涉及 Runner 阶段迁移。
3. 拆分 Eval / Experiment 的 Author Input、Definition 与 Discovered 类型，再收窄 discover、plan 和 run 的参数。
4. 落地 aggregate、EvidenceRow 与 charts 的关系泛型，确保 JSX 与普通函数调用都能从输入推断。
5. 让 custom group keep 只声明一次，并为 Theme / Report definition 加入私有品牌。
6. 重写受影响的功能契约、测试覆盖规范和 Source Map，再运行全仓类型检查与相关单元测试。

每一步都保持 JavaScript 运行时错误可用。
禁止用新增类型断言消除迁移错误；断言只允许出现在解析 `unknown` 后已经完成运行时证明的边界。

## 验收矩阵

类型测试由 `pnpm run typecheck` 承担。
每个禁止组合使用一条 `@ts-expect-error`，每个相邻合法组合保留正常推断，避免只证明“全部都不能用”。

| 契约族 | 必须编译 | 必须拒绝 |
|---|---|---|
| Eval / Experiment | 不带派生字段的 factory 调用；scoring 保持字面量 | 手写 id、scoring、configHash |
| Page | 普通页可无 load；参数化页带完整三件套 | params 缺 load；params 配可导航状态 |
| MCP | 纯 stdio；纯 HTTP | 同时 command 与 url；分支携带对方专属字段 |
| HITL | optionId 回答；text 回答 | 两者都缺；两者同时出现 |
| Aggregate | 两侧键不相交 | 重名键；任一侧使用 refs |
| EvidenceRow | 至少一个必填 MetricValue | 只有维度；只有可选 MetricValue |
| Charts | points 推断出的可绘制键 | 不存在字段；refs；函数或对象字段 |
| Sandbox | services；groupKeep；两者组合 | capabilities 手写 group-keep |
| Sandbox layer | 具体 factory 产生的 template-bearing layer；`sandboxLayer()` 产生的 command-only layer | 对象字面量伪造 layer；factory 缺必填起点选项 |
| Theme / Report | factory 返回值进入配置与宿主 | 普通对象伪造 kind |

配对上恰好一份 template 不进这张表：它取决于 discovery 与 selector 的实际配对，`tsc` 看不到。
它由 linker 的单元测试覆盖，断言 1×1 得到 `sandbox.template-conflict`、0×0 得到 `sandbox.template-missing`，且失败时零 Provider I/O。

Vitest 只覆盖运行时可观察行为：无类型输入仍被拒绝、错误点名实际字段、失败发生在副作用之前、合法输入规范化结果不变。
同一条类型错误只证明一次，但 JavaScript 后备路径必须各保留一个代表场景。

## 完成条件

这条契约满足时，以下条件共同成立：

- `docs/feature/` 把静态可判定的错误描述在调用点，而不只描述成装载期、setup 或渲染期错误。
- 发布声明中的公共签名能让禁止组合在 TypeScript 调用点失败。
- JavaScript 与动态数据仍得到完整运行时反馈。
- `pnpm run typecheck`、相关 `pnpm test` 切片和 `pnpm test:docs` 通过。
- Source Map 能从每条受影响契约定位到类型、运行时守卫和测试。
