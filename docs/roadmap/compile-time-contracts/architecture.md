# Architecture

本候选不建立一套独立的 schema 系统。
它重排现有公共类型的所有权，并要求 TypeScript 约束与运行时守卫描述同一条不变量。

## 四阶段定义模型

Eval 与 Experiment 依次经过四个边界：

```text
Author Input → Definition → Discovered Definition → Planned Run
```

| 阶段 | 可以拥有的事实 | 不得拥有的事实 |
|---|---|---|
| Author Input | 作者选择的行为、配置和 hooks | 路径 id、factory 判别、configHash |
| Definition | 作者事实 + factory 生成的精确判别 | 路径 id、configHash |
| Discovered Definition | Definition + id、来源路径 | configHash |
| Planned Run | 解析后的运行配置、configHash、Sandbox 选择 | 可再次修改的作者输入 |

Runner 内部函数按自己真正消费的阶段收参数。
发现器不再通过给宽 `EvalDef` 或 `ExperimentDef` 补字段来完成转换，规划器也不把 configHash 写回作者定义。
通过制与计分制定义组成以 scoring 判别的 union；Runner 先收窄分支，再以对应 context 调用 test，不用类型断言抹平两种题型。

## 静态约束与运行时镜像

每条候选约束都保留两条入口：

| 约束 | TypeScript 入口 | 运行时入口 |
|---|---|---|
| 禁止作者填写派生字段 | `never` 字段与阶段类型 | `defineEval` / `defineExperiment` 守卫 |
| page 字段依赖 | PageDefinition union | `defineReport` 规范化 |
| MCP transport 互斥 | 负字段 union | `assertMcpServers` |
| HITL answer 二选一 | AnswerValue XOR | `buildRespondInput` 与 adapter 输入校验 |
| aggregate 键冲突 | options 关系泛型 | `assertNoKeyCollision` |
| EvidenceRow 至少一个读数 | `WithMetricField` | `evidenceRow` 结构校验 |
| chart 字段角色 | 过滤键泛型 | `pointsToDataset` 跨行校验 |
| custom group keep | 输入排除 + 返回推导 | `defineSandboxCase` 规范化 |
| factory 产物身份 | 私有 unique symbol | `isThemeDefinition` / `isReportDefinition` |

运行时守卫接收 `unknown` 或宽结构时先检查形状，再进入内部精确类型。
内部函数不重复使用公共作者输入类型充当规范化结果。

## 源码改动面

采用本候选时按公共契约族修改，不做一次全仓类型改名：

| 契约族 | 主要落点 | 改法 |
|---|---|---|
| Eval / Experiment | `src/runner/types.ts`、`src/define.ts`、`src/runner/discover.ts` | 新增阶段类型；factory 返回精确 definition；发现函数构造 discovered 类型 |
| HITL | `src/context/types.ts`、`src/agents/types.ts`、`src/context/context.ts` | 提取共享 XOR；builder 补充“双字段”拒绝，不再静默优先 |
| MCP | `src/agents/types.ts`、`src/agents/mcp.ts` | union 增加负字段；保留带 server 名的 setup 守卫 |
| Report page | `src/report/definition/report.ts` | 把输入页拆成普通页与参数化页；规范化输出保持单一 ReportPage |
| Aggregate / EvidenceRow | `src/report/model/calculation.ts` | 在输入签名增加键关系与 MetricValue 存在性约束 |
| Charts | `src/report/definition/primitives/marks.tsx`、`points-dataset.ts` | 恢复泛型组件调用签名；字段 props 使用过滤键 |
| Sandbox case | `src/sandbox/case-types.ts`、`src/sandbox/case.ts`、`single-case.ts` | 从 groupKeep 推导 capability；内部只读规范化结果 |
| Theme / Report | `src/report/theme.ts`、`src/report/definition/report.ts` | 把现有运行时 symbol 加入公开接口的私有品牌属性 |
| 导出与定位 | `src/index.ts`、各子路径 index、`docs/source-map.md` | 导出新的作者输入与 definition 类型；更新契约到实现的定位 |

## 落地顺序

重构按依赖从窄到宽推进：

1. 为每条约束增加合法与禁止调用的 typecheck fixture，先固定目标诊断边界。
2. 落地 HITL、MCP、PageDefinition 这三组局部 union，不涉及 Runner 阶段迁移。
3. 拆分 Eval / Experiment 的 Author Input、Definition 与 Discovered 类型，再收窄 discover、plan 和 run 的参数。
4. 落地 aggregate、EvidenceRow 与 charts 的关系泛型，确保 JSX 与普通函数调用都能从输入推断。
5. 让 custom group keep 只声明一次，并为 Theme / Report definition 加入私有品牌。
6. 重写受影响的 Feature 契约、测试覆盖规范和 Source Map，再运行全仓类型检查与相关单元测试。

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
| Theme / Report | factory 返回值进入配置与宿主 | 普通对象伪造 kind |

Vitest 只覆盖运行时可观察行为：无类型输入仍被拒绝、错误点名实际字段、失败发生在副作用之前、合法输入规范化结果不变。
同一条类型错误不再用运行时测试重复证明，但 JavaScript 后备路径必须各保留一个代表场景。

## 完成条件

候选定稿并进入 Feature 后，以下条件共同成立：

- `docs/feature/` 不再把静态可判定的错误只描述为装载期、setup 或渲染期错误。
- 发布声明中的公共签名能让禁止组合在 TypeScript 调用点失败。
- JavaScript 与动态数据仍得到完整运行时反馈。
- `pnpm run typecheck`、相关 `pnpm test` 切片和 `pnpm test:docs` 通过。
- Source Map 能从每条受影响契约定位到类型、运行时守卫和测试。
