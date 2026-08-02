# Architecture

公共类型的所有权按阶段划分，不建立一套独立的 schema 系统。
TypeScript 约束与运行时守卫描述同一条不变量。

## 五阶段定义模型

Eval 与 Experiment 依次经过五个阶段：

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
通过制与计分制定义组成以 `evaluationKind` 判别的 union；Runner 先收窄分支，再以对应 context 调用 test，不用类型断言抹平两种题型。

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
| Agent evidence coverage 穷尽性 | 必填对象 + 降级判别 union | `defineDirectAgent` / `defineSandboxAgent` 构造守卫 |
| custom Sandbox 产物边界 | 固定返回形状 + `retention?: never` | `defineSandboxCase` 输入与 materialize 结果校验 |
| factory 产物身份 | 私有 unique symbol | `isThemeDefinition` / `isReportDefinition` |
| Sandbox template 恰好一份 | layer kind 私有品牌与 factory option 类型 | discovery 后的全矩阵 linker，早于 Provider 网络与资源 |

`never` 与诊断类型的取舍规则、以及每条约束的实测诊断文本，见 [Library](library.md#三级反馈)。

运行时守卫接收 `unknown` 或宽结构时先检查形状，再进入内部精确类型。
内部函数不重复使用公共作者输入类型充当规范化结果。

## 行为矩阵

每个约束族都必须同时定义相邻的合法与禁止形状；这张表描述公共可观察边界，不指定测试工具、fixture 注释或实现顺序。

| 契约族 | 必须编译 | 必须拒绝 |
|---|---|---|
| Eval / Experiment | 不带派生字段的 factory 调用；`evaluationKind` 保持字面量 | 手写 id、evaluationKind、configHash |
| Page | 普通页可无 load；参数化页带完整三件套 | params 缺 load；params 配可导航状态 |
| MCP | 纯 stdio；纯 HTTP | 同时 command 与 url；分支携带对方专属字段 |
| HITL | optionId 回答；text 回答 | 两者都缺；两者同时出现 |
| Aggregate | 两侧键不相交 | 重名键；任一侧使用 refs |
| EvidenceRow | 至少一个必填 MetricValue | 只有维度；只有可选 MetricValue |
| Charts | points 推断出的可绘制键 | 不存在字段；refs；函数或对象字段 |
| Agent evidence coverage | 六通道 complete；带原因的 partial / unavailable | 漏通道；降级缺 reason；complete 携带 reason |
| Sandbox | 主 Sandbox + 资源组；可选 services | 缺基线句柄；callback 拼接 retention 或未知 capability |
| Sandbox layer | 具体 factory 产生的 template-bearing layer；`sandboxLayer()` 产生的 command-only layer | 对象字面量伪造 layer；factory 缺必填起点选项 |
| Theme / Report | factory 返回值进入配置与宿主 | 普通对象伪造 kind |

配对上恰好一份 template 不进 TypeScript 那一列：它取决于 discovery 与 selector 的实际配对，单文件类型系统看不到。link 行为必须穷举 1×1 得到 `sandbox.template-conflict`、0×0 得到 `sandbox.template-missing`，且两者都发生在任何 Provider I/O 之前。

JavaScript、动态导入与显式类型断言绕过静态入口后，运行时镜像仍必须给出同一结论、点名实际字段并在副作用前失败。合法输入的规范化结果不得因诊断增强而改变。
