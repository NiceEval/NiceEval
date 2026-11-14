# Eval —— 架构

Eval 拥有任务与判定，Adapter 拥有应用操作，Attempt 拥有一次执行与资源作用域。
公开形状见 [Library](library/README.md)，持久事实与封口见 [Assertions](../assertions/README.md)。

## 外部 Eval 发现与装载

[外部根](library/sharing.md) 只增加发现输入，不增加第二种 Eval、Attempt 或结果格式。
发现、源码捕获、Sandbox 与文件传输必须共用同一份 owner 边界，不能只扩展扫描目录。

```text
消费项目配置与已安装依赖
  → 定位 dependency key、精确安装身份与 root
  → preflight 展示去凭据的安装身份
  → 本地与外部 root 分别扫描、装载、展开
  → root 内相对 id 拼接消费项目挂载前缀
  → 合并检查最终 id 冲突
  → 逐 Eval 投影模块、数据、dependency 与 transfer 输入
  → 普通 Experiment 选择与执行
```

### 路径与 package 定位

| 路径 | 职责 |
| --- | --- |
| 消费项目 root | 定位 package.json、lockfile 与本地 evals/ |
| 外部 package root | 依赖查找、源码捕获与受管宿主路径的边界 |
| 配置的 root | 外部相对 Eval id 的发现起点 |
| 挂载前缀 | 最终项目内 Eval id 的前缀 |

package locator 从消费项目直接 dependency key 取得安装目录，跟随 package manager 的链接后读取 package.json。
它不执行 main，不依赖 package export，不扫描全局 cache，也不在缺包时联网。
dependency alias 与 manifest name 分别保存，不能因名称不同拒绝合法 alias。

每个根独立按普通入口规则装载并展开数组或 keyed record，相对 id 合法后才拼前缀。
合并后检查最终 id；冲突列出双方文件、package、root 与挂载点，不能按根顺序替换。
上游配置、Agent 与 Experiment 不参与发现，也不取得消费项目的生命周期。

### 单一运行时

外部根装载要求 Node >=22.15 的同步 `node:module.registerHooks()`。
CLI 在动态导入配置或 Eval 前注册查找 hook，并与 tsx 的 ESM/CJS 转译 hook 按固定顺序组成链。
不支持同步 hook 时，在执行第三方 Eval 代码前报 `eval-root.node-unsupported`。

只有 importer 的真实路径位于声明的外部 package root 内时，`niceeval` 与 `niceeval/*` 才重定向到消费 CLI 所属 package。
Node builtin、相对 import 与其它 bare package 继续从 importer 所属 package 查找。
消费项目普通模块查找不受影响；传递 dependency 在自身 package 内 import NiceEval 时不自动重定向，也不支持借此返回另一份私有品牌对象。

每个 owner 使用自己的 module type 与 TypeScript 编译上下文。
模块图由 Node 实际查找结果与语法树形成，不能用正则近似 import。
消费运行时缺少 export 时不回退到外部 NiceEval；可判定错误与动态访问边界见 [CLI 错误](cli.md#外部根错误)。

### 文件访问边界

本地 Eval 的 owner root 是消费项目 root，外部 Eval 的 owner root 是所属 package root。
内部发现事实保存 `ownerRoot`、`evalRoot`、`baseDir`、`sourcePath`、模块依赖事实与 definition origin。
`ownerRoot` 是 NiceEval 受管宿主路径的 capability 边界，不只是展示 metadata。

静态相对 import 在所属 owner 内递归捕获。
相对 import、loader 文件、Sandbox build context、bind mount 与运行期上传的宿主文件逃出 owner 时失败。
校验使用 realpath 后的跨平台祖先关系，不使用字符串前缀；不存在的目标先检查最近已存在祖先，再在创建或读取时复核。

Node builtin 与 NiceEval 运行时源码不复制进源码闭包；NiceEval runtime revision 进入身份。
静态可达 bare dependency 保存实际命中的 locator 与安装内容摘要；workspace/file/link 依赖按实际内容计算，不只信 lockfile 文本。

### 模块与数据投影

共享模块可能只被 Node 求值一次，发现器不能依赖逐 Eval 重复求值来收集 loader 事实。
模块 DAG 保存每个模块登记的 loader、criteria 与 private 输入，再把传递闭包投影到每条可达 Eval。
两条 Eval import 同一模块时，都得到该模块的数据事实；仅改变该模块时，只使可达它的 Eval 重新规划。
模块的数据事实只包含该模块顶层求值期间的读取。读取时调用栈（含 `async` 帧）上出现当前 Eval 入口，
就只归这条 Eval，不进入执行读取的共享模块；Eval 顶层调用共享函数逐题读 fixture 时，各题指纹互不包含。

路径校验和文件哈希按 package root 缓存，共享物理文件只读一次，再生成逐 Eval manifest。
缓存使用真实路径、stat 与内容哈希，不能以 package version 作为整套题的失效键。
依赖、运行时与传输输入的身份规则由 [Experiments](../experiments/architecture/cache.md#外部-eval-的身份与携带) 拥有。

### 装载验收

正式装载须以真实安装矩阵验证，不能只用模块 mock：

| 维度 | 必需组合 |
| --- | --- |
| Node | 22 与 24，外部根满足 >=22.15 |
| 外部 package | ESM 与 CJS，保留自己的 package type 与 tsconfig |
| package manager | npm、pnpm、Yarn node-modules linker |
| 运行时隔离 | 外部 package 内安装另一版 NiceEval，仍使用消费运行时解释原生定义 |
| 输入完整度 | 共享模块数据投影、可达依赖变化、owner escape 与 transfer 重验 |

loader、owner capability、dependency projection 与 transfer manifest 必须一同满足，安装矩阵通过后才能验收共享能力。

## 应用契约与实现身份

Agent 提供会话操作，用户应用提供自己的上下文对象。它们共用 Eval、Attempt、Assertion 与 Run publication。
Eval 只声明所需契约，Experiment 选择实际实现；配对在创建资源前完成。
显式共享接口由同一个品牌契约定义拥有；名称相同的独立定义不证明相容。
具体实现的额外成员不扩大共享 Eval 的可见类型。

实现名称、接口名称、行为版本、实验配置和源码依赖共同参与执行身份。
未声明行为版本的用户应用不自动 carry；已声明版本也必须满足完整的 reuse policy。
接口共享只允许执行相同任务，不授予不同实现自动携带结果的资格。

Run 的 execution、EvalResult 与 `eval:start` 事件通过 `adapter` 保存同一份中立接入身份。
身份只按以下字段投影，不展开可执行定义、连接或凭据：

```ts
interface AdapterIdentity {
  readonly name: string;
  readonly contract: string;
  readonly behaviorRevision: string | null;
}
```

品牌契约 token 不进入持久结果。`contract` 只是接口名称，不授予运行时配对、Agent 能力或沿用资格。
Agent 的接口名称为 `niceeval.agent/v1`；`behaviorRevision: null` 始终表示没有显式声明行为版本。
能力来自实际构造对象，沿用由独立 policy 校验。历史格式的已知转换由 [Run 迁移](../run/architecture/README.md#自动迁移) 拥有。
不支持的 Sandbox、Eval Group、Sandbox reuse 与完整应用费用 budget 组合在预检拒绝。
依赖 Agent 执行准备的生命周期 Plugin 同样在预检拒绝，不能宣称执行却跳过其资源 owner。

## 上下文组合

公共 EvalContext 拥有 Assertion、分组、执行控制与反馈，Adapter 提供评估对象的操作与证据。Agent、游戏和普通应用都沿同一个契约参与评估，领域能力不成为其它对象的执行前提。
组合后的 `t` 具有精确泛型类型，不使用全局扩展或开放动作字典。
它的根字段集合固定且只读，应用成员使用实时转发，不把可变值复制成过时快照。
顶层函数稳定绑定原应用上下文，解构后仍可调用；`this` 不获得公共评估能力。

类型与运行时共同拒绝核心成员冲突及危险属性。同步上下文在 Promise 吸收前检查；异步工厂只检查兑现对象。
JavaScript 自身已发生的 thenable 吸收不能撤销，这不是执行不可信代码的安全边界。
顶层动作 wrapper 每次调用检查作者生命周期，关闭后的调用失败；已经运行的函数和嵌套原对象仍由应用协作取消。

断言便捷方法由 Adapter 定义或共享契约拥有，每个实际执行的 Attempt 在 `create` 成功后组装一次。共享契约的实现不能替换 factory。
组装输入仅包含受生命周期保护的应用 facade 和同一核心 `check`；组装期间不登记 Assertion。方法调用时读取证据，同步返回该次调用登记的原始 handle。
断言方法不建立独立的评分、封口或持久结果类型。Pass 与 Score 使用各自的原生 handle 类型，关闭后的方法调用和保存的 `check` 都经过同一作者生命周期检查。
字段碰撞、getter、非普通对象或无效返回值必须明确失败，不能让普通 Boolean 冒充已登记 Assertion。

## 应用实例生命周期

每个实际执行的 Attempt 调用一次 `create(ctx)`。carry 引用原 Attempt，不创建实例。
每次执行的应用状态独立；宿主显式注入的共享 client 由宿主拥有，Attempt 只释放自己取得的租约。
普通应用不创建 SessionManager，不自动执行 Agent 消息重试。

唯一 Attempt owner 管理执行 deadline、作者桥接、Assertion 求值和封口、反馈及 publication。
Agent 的安装、会话、变更归因和 tracing 由 Agent 专属准备及观测贡献提供，不成为普通应用的执行前提。
框架不为不同应用复制第二套 timeout、Verdict、Judge 或 publication 运行器。

应用资源状态为 `forward-open` → `cleanup-open` → `closed`。
作者完成、创建失败、执行异常、超时或取消都关闭同一个作用域。
正常完成先冻结 Assertion 求值结果，再退出执行 deadline 的竞争并释放资源；资源释放期间到达的执行 deadline 不推翻求值结果。
超时或取消先同步关闭应用方法、Core 登记和 handle 修改入口，再发出取消信号。
同步 abort listener 也不能追加或修改 Assertion，不能只依赖桥接队列拒绝异步请求。
随后按中断规则冻结 Assertion；应用采集排空后才交出最终执行 outcome 与 publication，交接只执行一次。

`onCleanup` 成功登记才移交释放义务。已登记回调按逆序执行，一项失败追加 diagnostic 并继续剩余回调。
每个回调收到冻结的 `AdapterCleanupContext`；同一次 cleanup 的回调共享一个独立于 Attempt 的 signal。
Attempt 超时或取消时，`ctx.signal` 可以已经取消，但 cleanup signal 在总预算内保持活动，并在预算结束时取消以支持协作收尾。

进入 `cleanup-open` 时开始固定 30 秒总预算，应用回调与已知创建、作者交接都在该预算内；迟到登记不延长期限。
`cleanup-open` 中的迟到登记由原 Scope 接管；已登记回调耗尽且已知交接完成，或总期限到达后，状态变为 `closed`。
关闭后的登记同步抛出生命周期错误，资源仍归调用者，不能另开 runtime 或修改已发布事实。

取消只关闭 forward，不关闭 `recordUsage` 与 `attach` 的 capture 入口。Eval 的 `finally` 与 `onCleanup` 可以等待同一份幂等完成 Promise，尾部采集仍归原 Attempt。
cleanup 关闭时同步关闭两个采集入口；之后的调用拒绝，不能改变已封口的用量、附件或执行 outcome。

输入校验、容量限制与 capture 失败即使被应用捕获，也保留为执行错误。cleanup 总预算耗尽同样形成 `errored` Attempt，不能报告成功。
最终结果保留已完成 Assertions、已得分与成功附件，并通过原有 Verdict 与 Score 算法折叠；普通 cleanup callback 抛错仍只追加 warning。
先发生的执行错误保持其类型与说明；后续 cleanup 超时另写诊断，不替换已有的 Attempt timeout 归属。
因此成功通知、earlyExit 与后续 reuse 只能消费 cleanup 已确定的最终结果。

```ts
const lease = await client.acquire({ signal: ctx.signal });
try {
  ctx.onCleanup(({ signal }) => lease.release({ signal }));
} catch (error) {
  await lease.release();
  throw error;
}
```

总预算仅约束用户应用的资源释放与交接。Agent、Plugin、Sandbox 和 Provider 保持各自原有的资源 owner、释放顺序与预算。
应用预算耗尽不能跳过框架持有的进程、租约或 Provider 的释放。
应用必须将取消信号传到外部活动；框架不承诺终止任意 JavaScript Promise，也不无限等待忽略取消的迟到资源。

## 按源码顺序登记

应用动作、Agent Turn、Sandbox 命令和 Assertion 按作者代码执行。
调用 `check` 时冻结 subject、callsite、source order 与 groupPath，handle 只配置同一 entry。
`.orStop()` 停止 awaited continuation，已登记 evaluator 仍按封口规则结算；关闭后的新登记明确拒绝。
普通 JavaScript 副作用不回滚，应用拥有状态事务和外部操作幂等性。

## Agent 的作用域

Agent scoped Assertion 按接收者绑定在 Agent 的 `t`、Session 与 Turn。
根 `t` 读取已启动 Session 的 vector cut，Session 读取自己的前缀，Turn 读取不可变结果。
普通应用不会获得虚假的对话成功或零工具调用判分结果。
Sandbox 文件可见性与归因继续由 send 区间确定，规则见 [Sandbox](../sandbox/README.md)。

## 模拟用户

[模拟用户](library/simulated-user.md) 属于 Agent Session 的执行输入生成能力，不属于 Assertion 求值或 Adapter 实现。
Eval owner 创建并持有每个实例的 pi coding agent 会话；Provider owner 继续拥有模型、凭据、预算、传输与用量采集。
定义不持有运行期会话，普通应用上下文不获得隐式 Session。

每次调用捕获源 Turn 与当前待处理请求，把 Turn 的回复和完整请求作为不可信消息交给 pi。
instructions 属于可信作者输入，不把被测 Agent 的回复提升为系统规则。
工具 schema 使用互斥的 text / optionId 分支，校验严格拒绝未知字段，并验证 requestId 集合与当前请求一一对应。
第一个合法提交只锁定回答候选；关闭模型动作准入、收拢会话与校验审计后，再复核 Session 状态并调用原 `respond` / `send` 一次。

与 [Agent Judge](../judge/architecture.md#pi-coding-agent-与受管-provider) 相同，直接使用 pi coding agent 会话：NiceEval 只追加 system prompt 并提供 `reply_to_agent`，模型请求、上下文、压缩、重试、usage 与 abort 都是 pi coding agent 的。
每次 reply 最多 4 轮普通生成，每次溢出最多压缩一次再重发；摘要调用不占普通轮数，但计入同一期限、审计与物理用量。
单次 reply 的墙钟期限为定义上限与 Attempt 剩余期限的较小值，包含生成、压缩、资源收拢与下一轮发送；Provider 的单请求上限继续有效。
每次 reply 的审计保存 pi session 内容，最多 4 MiB；超出时这次 reply 失败（`simulated-user-failed`），不发送回答。审计只保留超限之前最后一份完整的 session 快照，加上超限的失败元数据（实际字节数与上限），不截断其中的对话，也不写入超限的完整 session。

Attempt 终止先关闭提交和新请求准入，再 abort 会话并解除订阅，按已有有界关闭规则等待释放。
迟到事件不能驱动 Session、补写已封存用量或改变 outcome。
同一实例的 pi 会话在 reply 间保留；Attempt 关闭后不再接受调用，不能借压缩或重建会话复活。

模拟用户审计与执行活动绑定源 Session、源 Turn 和新 Turn，内部模型历史与被测 Agent history 分别归各自 owner。
被测 Agent 只收到最终普通消息或结构化 responses；它的 history 不包含模拟用户的 instructions、内部工具调用或压缩摘要。
模拟用户的用量随执行活动事实持久化，不进入 Judge collector；费用汇总按这些活动事实聚合出 `simulated-user` 费用类别，不把模拟用户活动冒充评分 entry。

## 观测、评分与发布

应用返回的 Post、Reply、图片和其它值只有显式交给 `check` 时才形成有界 Assertion 材料，不自动持久化整个应用状态。
Match 接收实际值，持久快照是其有界观察，不替代完整应用状态或图像归档。
没有采集的对话、工具、token 和费用保持缺失；不能从没有 Turn 推导零用量。
Judge 费用只属于 Judge 证据，不代表完整应用费用。

Pass 与 Score 共用 Assertions 求值、封口和 Run publication。
判定从执行 outcome、sealed Assertions 与显式 skip 折叠；Score 从明确 contribution 与完整度形成。
Inspection 不重跑 matcher 或应用代码，View 不另行解释评分。
