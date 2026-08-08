# Eve 断言 DX 与回归题需求

本研究比较 Eve 与 NiceEval 的断言作者面，并用一条真实回归题检查每项能力是否解决了实际问题。
它只提供设计输入，不构成 NiceEval 的目标契约。

## 观察版本

观察日期是 2026-08-08。

| 对象 | Revision | 主要证据 |
|---|---|---|
| Eve | `bd93f55481b3048d0273dd041b423e73fb9248cf` | `packages/eve/src/evals/` 与 `docs/evals/` |
| NiceEval-Eval | `2794a6cf315c247605f14a9ffed55f0a4564ac78` | `evals/harness/add-regression/eval.ts` 与同仓库 harness 说明 |
| NiceEval | 本研究所在工作树 | [现有 Assertion 契约](../feature/assertions/README.md)、[Sandbox 变更归因](../feature/sandbox/architecture.md)与源码 |

Eve 与 NiceEval-Eval 都来自本机 checkout。
本研究读取源码、文档与 Git revision，没有把运行中服务或发布包的行为混入研究判断。

## 研究判断

NiceEval 不需要换掉整个 Assertion 模型。
现有 scope、三态 `outcome`、证据完整性、`.optional()` 与计分制比 Eve 更适合真实 eval。
真正需要重做的是五个接缝：有数据的有序行为、Judge 材料、人读标题、自定义诊断，以及依赖断言结果的后续代码。

`add-regression` 里的重复检查大多值得保留。
它们分别证明命令出现、动作有序、输出可信、回复准确、文件真实和独立命令验证通过。
合并这些检查会把可定位的部分分重新压成一个不透明的 Judge 判分结果。

当前内置词汇也不是每项都值得原样保留。
与 NiceEval 私有证据有关的断言应继续内置；通用且高频的值 matcher 应保留；只检查某种回答版式的用户函数应退出核心词汇。

## Eve 提供的作者体验

### 三个入口

Eve 与 NiceEval 都把断言分成三个入口。

| 入口 | Eve 调用形状 | 作者得到什么 |
|---|---|---|
| 作用域断言 | `turn.calledTool(...)` | 接收者直接表达取证范围 |
| 值断言 | `t.check(value, matcher)` | 普通 TypeScript 值统一写入 AssertionResult |
| Judge | `turn.judge.autoevals.*` | 开放式标准交给模型评分 |

这套分工值得保留。
它避免把任意值、协议事实和模型判断并入同一个万能函数。

### 值得吸收的 DX

| Eve 能力 | 价值 | 对 NiceEval 的启发 |
|---|---|---|
| 每个句柄都有 `.label(name)` | 同族断言重复出现时，报告仍有作者给出的标题 | 标签应属于共享句柄，不应散落在个别 builder 参数里；它不是跨运行身份 |
| `turn.requireToolCall(...)` | 同时写入 gate 结果、要求恰好一项并返回该项 | 它展示了 dependent-data DX；NiceEval 仍应等真实题目反复需要后再扩张 receiver API |
| `await t.require(value, matcher)` | 前置失败仍是一条断言失败，不伪装成执行异常 | NiceEval 应保留，并让 refinement matcher 收窄返回类型 |
| `JudgeOpts.on?: unknown` | 结构化材料可以直接传给 Judge | 作者不应在调用点手工 `JSON.stringify` |
| `AssertionEvaluation` | 自定义 matcher 可给 message 与结构化 metadata | NiceEval 自定义 matcher 应能填已有的 expected、received 与 evidence |
| 类型化事件 matcher | `type` 决定 `data` 的合法形状 | 顺序断言不应退回无类型谓词 |
| 小型 matcher 词汇 | Eve 只内置五个通用值 builder | 核心词汇应按稳定语义选入，不按单个题目的便利性增长 |

Eve 的 `expectOk()` 也把“后续步骤依赖本轮健康”写得很直接。
不过它以抛错结束依赖路径，不能直接替代 NiceEval 已有的断言失败与执行错误分离。

### 不应照抄的边界

| Eve 行为 | 为什么不适合作为 NiceEval 目标 |
|---|---|
| `AssertionResult` 只有 `passed: boolean` | 无法区分 agent 失败与证据根本不可评 |
| 没有 evidence coverage 与 `.optional()` | 负断言可能在不完整事件流上误判 |
| 没有题内 `.points(n)` | 无法表达长链任务的独立检查点与部分分 |
| `calledTool` 省略状态时默认 `completed` | 回归题第一轮的完整实验应以 eval failed 退出；它仍须被认作真实执行过 |
| `eventOrder` 匹配原始协议事件 | 它没有把工具 start 与 finish 按 operation id 合成一次逻辑动作 |
| `eventOrder` 把每个 matcher 的全部命中当成一组 | 同类事件交错时会失败，不是“从前往后找一条子序”的直觉 |
| 自定义 metadata 无领域边界 | 任意结构会膨胀 Record；NiceEval 已有有界诊断字段更适合作为出口 |

Eve 文档把 `eventOrder` 称为 event group，但源码中的 group 是“同一 matcher 的全部命中”。
它不是工具、子 Agent 或消息等逻辑动作。
NiceEval 可以吸收对象 matcher 的调用形状，不能继承这层数据模型。

## `add-regression` 真正要求什么

目标文件是 NiceEval-Eval 的 `evals/harness/add-regression/eval.ts`。
它让 agent 先新增一条会失败的回归 eval，再修业务实现并完整复验。

| 需求 | 当前写法 | 现有缺口 | 研究方向 |
|---|---|---|---|
| 确认第一轮真的运行完整 experiment | `calledTool("shell", { input })` | 无缺口；省略 status 正是所需语义 | 保留任意生命周期默认值 |
| 确认随后用 `show` 下钻 | `calledTool` 加 `status: "completed"` | 无缺口 | 保留同一笔调用上的 input、output、status 匹配 |
| 确认 exp、show、回复依次发生 | 目标形状已经写成对象数组 | `eventOrder` 只收原始事件类型字符串 | 用逻辑行为 matcher 重做 `eventOrder` |
| 评价命令是否分开、非 dry-run 且符合版本规则 | Judge 读取 `JSON.stringify(turn.toolCalls)` | 手工序列化丢类型，也把材料整形泄漏到题目里 | Judge 接受可序列化结构值 |
| 评价真实运行数量与失败详情 | 独立 Judge 读取 tool calls | 与顺序 Judge 看似重复，实际标准不同 | 保留独立给分项 |
| 评价助手是否准确复述结果 | Judge 读取 `turn.message` | 无缺口 | 保留 turn 默认材料与显式材料 |
| 确认 turn 没有协议失败 | `turn.succeeded()` | 无缺口 | 保留证据完整性语义 |
| 找到且只找到一个新增 eval | 布尔表达式配 `isTrue(label)` | 断言通过后仍用 `newEvalFiles[0]!` | type predicate matcher 配 typed require 返回 tuple |
| 评价新增 eval 不是弱断言或恒真作弊 | Judge 读取源文件 | 无缺口；这是开放式语义标准 | 保留 Judge，不造业务专用 matcher |
| 证明文件由 agent 改动 | `t.sandbox.fileChanged(path)` | aggregate 无法直接指明是哪一轮；单个 send 区间内改后复原也不可观察 | 增加 turn 对应的边界 delta 断言 |
| 证明修复轮没有削弱回归 eval | 再读文件并做严格布尔相等 | eager 读取会让候选删文件先变成 I/O error | 用 delayed `sandbox.file` 配 `equals(source)` 与 label |
| 独立命令验证取消边界 | `runCommand` 配 `commandSucceeded()` | 无缺口 | 保留命令结果专用诊断 |
| 每个标准独立给分且关键项硬失败 | `.points(n).gate()` | 无缺口 | 保留 points、severity 与控制流三轴 |

这道题的第一轮 `local` 预期返回失败状态，因为新增回归正在复现 bug。
因此“调用 shell”与“shell 成功”必须是两个不同事实，`status` 省略时不能悄悄改成只认成功。

## 现有值 matcher 逐项审视

下表是研究建议，不是目标 API。

| Matcher | 裁决建议 | 理由 |
|---|---|---|
| `includes` | 保留 | 高频通用值匹配；失败能展示 needle 与 received |
| `excludes` | 保留 | 负向文本检查高频，且 `stripComments` 消除代码注释假阳性 |
| `equals` | 保留 | 精确结构值与源码保真都需要它 |
| `matches` | 保留 | Standard Schema 是结构化输出的稳定边界 |
| `similarity` | 重塑默认线 | 算法有用，但 `0.6` 没有跨任务通用意义；默认应只记连续分，作者显式加线 |
| `includesUrl` | 退出核心词汇 | 只是某类回答版式，不是 NiceEval 私有事实；可由共享用户断言构造器组合 |
| `hasSections` | 退出核心词汇 | Markdown 标题数是任务标准，不应扩张通用断言表面 |
| `satisfies` | 保留并收紧 | 仍是必要 escape hatch；matcher 自身先取得非空 label，type predicate 再收窄 `t.require` 返回值 |
| `isDefined` | 保留并增强 | 前置代码常需非空值；应把返回值收窄为 `NonNullable<T>` |
| `isTrue` | 保留轻量 sugar | 布尔条件很常见；标签统一移到共享句柄，避免 builder 独有参数 |
| `isFalse` | 保留轻量 sugar | 与 `isTrue` 对称，并明确报告的 expected 值 |
| `commandSucceeded` | 保留 | 它理解 NiceEval `CommandResult`，能给出命令与失败输出，而非只看布尔值 |
| `makeAssertion` | 改为 `defineAssertion` | 它声明可组合 matcher，不创建运行时资源；同时应支持有界丰富诊断与 unavailable |

一个 matcher 是否进入核心，不能只看“能否少写几行”。
它至少应满足一项：理解 NiceEval 私有证据、消除静默误判、提供通用类型收窄，或稳定改善高频失败诊断。

## 现有作用域断言逐项审视

| Assertion | 裁决建议 | 理由 |
|---|---|---|
| `succeeded` | 保留 | 它理解协议失败、HITL park 与 evidence coverage |
| `parked` | 保留 | HITL 等待是 NiceEval 才掌握的运行事实 |
| `messageIncludes` | 保留 | 它按 scope 聚合消息，并正确处理不完整消息证据 |
| `calledTool` | 保留 | input、output、status 与 count 必须绑定同一笔逻辑调用 |
| `notCalledTool` | 保留 | 负断言依赖完整 action 证据，不能降成数组搜索 |
| `toolOrder` | 保留 convenience | 只关心工具发起顺序时比通用事件对象更清楚；它使用 started 子序，不冒充完成先后 |
| `usedNoTools` | 保留 | 高频负断言，并承担 action completeness 判定 |
| `maxToolCalls` | 保留 | 上限在 partial evidence 下有单调可判与不可判边界 |
| `loadedSkill` | 保留 | skill 是标准事件事实，不应要求作者猜底层工具名 |
| `calledSubagent` | 保留 | 委派身份、远端、输出与生命周期属于标准派生事实 |
| `noFailedActions` | 保留 | 一次检查工具、skill 与子 Agent 的标准失败面 |
| `event` | 重塑输入 | 从原始 `type` 字符串提升为类型化逻辑行为 matcher |
| `notEvent` | 重塑输入 | 与 `event` 共用逻辑 matcher，并保留负证据 completeness |
| `eventOrder` | 重点重做 | 接受 tool、message、subagent 等 matcher，按 operation id 关联生命周期，再做真正子序匹配 |
| `eventsSatisfy` | 保留 raw escape hatch | 极少数协议不变量仍需整段原始事件；label 继续必填 |
| `maxTokens` | 保留 | usage 完整性与实测超限的单调判定属于框架事实 |
| `maxCost` | 保留 | 成本估算与缺失语义属于框架事实 |
| `outputEquals` | 保留 | turn output 的 evidence coverage 不能由 `t.check(turn.data, ...)` 还原 |
| `outputMatches` | 保留 | 同上，并为 structured output 提供 schema 诊断 |

`eventOrder` 的目标不应是把所有 specialized assertion 合成一项。
`calledTool` 适合证明存在与次数，`toolOrder` 适合只看发起顺序，`eventOrder` 才承担跨行为类型的非重叠时序。

## Sandbox 断言逐项审视

| API | 裁决建议 | 理由 |
|---|---|---|
| `fileChanged` | 保留 aggregate，并增加 turn 区间形态 | aggregate 汇总与逐 turn 边界 delta 都由变更分类账掌握 |
| `fileDeleted` | 保留 aggregate，并增加 turn 区间形态 | 删除归因不能用最终文件不存在替代 |
| `notInDiff` | 保留 aggregate，并增加 turn 区间形态 | 内容省略时必须 unavailable，普通正则搜索做不到 |
| `noFailedShellCommands` | 退出专属词汇 | 与 `notCalledTool("shell", { status: "failed" })` 重复，也容易被误读成 eval 验证命令 |
| `diff.get` | 保留材料视图 | 精确内容比较仍应交给值 matcher |
| `diff.matches` | 保留材料视图 | 它能在内容省略时拒绝静默给出 false |
| `diff.isEmpty` | 增加 Assertion 对应物 | “没有改动”是负证据；直接布尔值不应成为唯一作者路径 |
| `file(path)` | 保留延迟材料 | finalize 时文件内容配任意值 matcher，职责清楚 |

分类账已经保存逐个 send 区间，只是 Library 断言只暴露 aggregate。
为 turn 增加只读 `changes` 视图不会扩大采集范围，也不需要让 turn 拥有 Sandbox 操作。

## 句柄、控制流与 Judge

| 能力 | 裁决建议 | 理由 |
|---|---|---|
| `.label(name)` | 新增到值 matcher 与没有必填标题的已登记句柄 | 它只决定人读标题；Judge 继续以 required `name` 为唯一标题，跨 eval 对比仍使用 `groupPath` |
| `.gate()` | 保留 | 只表达硬判定，不隐式改变控制流 |
| `.atLeast(x)` | 保留 | soft 分数线与 hard gate 必须可区分 |
| `.soft()` | 保留 | 连续质量分与纯观测仍有独立价值 |
| `.optional()` | 保留 | 证据可缺席与 severity 是不同问题 |
| `.points(n)` | 保留 | 回归题需要每项独立部分分 |
| `.stopOnFailure()` | 保留为必须 `await` 的控制流边界 | 任意断言都可能成为前置，但语言层面无法让浮空 Promise 阻止后续同步副作用 |
| `t.group` | 保留 | 组织报告与得分点，不改变断言本身 |
| `t.score` | 保留 | 复杂业务分档不应反向膨胀内置 matcher |
| Judge `{ on }` | 接受可序列化结构值 | 结构化工具调用不应由作者手工序列化 |
| 自定义 Assertion evaluation | 使用有界字段 | 允许 score、expected、received、evidence 与 unavailable，不开放任意 Record metadata |

`.stopOnFailure()` 的能力本身成立，但它不是返回领域数据的 API，也不支持浮空调用。
当后续代码需要收窄后的值时，typed `require` 应同时写入断言结果并返回收窄值；输入请求继续使用已有的 assertion-backed require。
本次下游样本没有消费 exact-one ToolCall，因此不只为对称加入 `requireToolCall`、`requireSubagentCall` 或 `requireEvent`。

## 设计输入

后续设计应同时满足这些约束：

1. 保留 `passed | failed | unavailable`，不把缺证据折成 0 分。
2. 保留 aggregate、session 与 immutable turn 的 scope 规则。
3. 有序行为以逻辑动作建模，工具与子 Agent 的 start、finish 只在同一 session 内由 operation id 关联。
4. `toolOrder` 使用发起子序；`eventOrder` 要求前一项结束后下一项才开始，两者都允许无关动作与同类重复动作。
5. Judge 结构化材料在边界统一规范化；不可序列化值应在发请求前给出作者错误。
6. 自定义 matcher 的异步失败在 Assertion 求值边界归一，不把嵌套运行时或任意异常结构泄漏进 Record。
7. turn 变更读取现有 send 区间的 before/after delta，不承诺观察区间内改后复原的历史，也不另做一次文件系统 diff。
8. 业务 rubric 留在 eval 代码与 Judge，不因一条回归题新增专用核心断言。

这些输入已经完成独立设计挑战；定稿后的 API 与边界见 [Assertion 作者面 Roadmap](../roadmap/assertion-authoring/README.md)。
