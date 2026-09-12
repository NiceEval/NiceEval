# Eval —— 架构

Eval 拥有任务与判定，Application 拥有应用操作，Attempt 拥有一次执行与资源作用域。
公开形状见 [Library](library.md)，持久事实与封口见 [Assertions](../assertions/README.md)。

## 应用契约与实现身份

Agent 提供会话操作，用户应用提供自己的上下文对象。它们共用 Eval、Attempt、Assertion 与 Run publication。
Eval 只声明所需契约，Experiment 选择实际实现；配对在创建资源前完成。
显式共享接口由同一个品牌契约定义拥有；名称相同的独立定义不证明相容。
具体实现的额外成员不扩大共享 Eval 的可见类型。

实现名称、接口名称、行为版本、实验配置和源码依赖共同参与执行身份。
未声明行为版本的用户应用不自动 carry；已声明版本也必须满足完整的 reuse policy。
接口共享只允许执行相同任务，不授予不同实现自动携带结果的资格。

Run 的 execution 保存中立 Application identity，不要求用户应用填写 `agentId`：

```ts
type ApplicationIdentity =
  | { readonly kind: "agent"; readonly name: string }
  | {
      readonly kind: "application";
      readonly name: string;
      readonly contract: string;
      readonly behaviorRevision: string | null;
    };
```

品牌契约 token 不进入持久结果。历史事实按精确 Record 格式解释，不根据当前代码补造身份或迁移旧库。
不支持的 Sandbox、Eval Group、Sandbox reuse 与完整应用费用 budget 组合在预检拒绝。
依赖 Agent 执行准备的生命周期 Plugin 同样在预检拒绝，不能宣称执行却跳过其资源 owner。

## 上下文组合

公共 EvalContext 拥有 Assertion、分组、执行控制与反馈，Application 提供应用上下文。
组合后的 `t` 具有精确泛型类型，不使用全局扩展或开放动作字典。
它的根字段集合固定且只读，应用成员使用实时转发，不把可变值复制成过时快照。
顶层函数稳定绑定原应用上下文，解构后仍可调用；`this` 不获得公共评估能力。

类型与运行时共同拒绝核心成员冲突及危险属性。同步上下文在 Promise 吸收前检查；异步工厂只检查兑现对象。
JavaScript 自身已发生的 thenable 吸收不能撤销，这不是执行不可信代码的安全边界。
顶层动作 wrapper 每次调用检查作者生命周期，关闭后的调用失败；已经运行的函数和嵌套原对象仍由应用协作取消。

## 应用实例生命周期

每个实际执行的 Attempt 调用一次 `create(ctx)`。carry 引用原 Attempt，不创建实例。
每次执行的应用状态独立；宿主显式注入的共享 client 由宿主拥有，Attempt 只释放自己取得的租约。
普通应用不创建 SessionManager，不自动执行 Agent 消息重试。

唯一 Attempt owner 管理执行 deadline、作者桥接、Assertion 求值和封口、反馈及 publication。
Agent 的安装、会话、变更归因和 tracing 由 Agent 专属准备及观测贡献提供，不成为普通应用的执行前提。
框架不为不同应用复制第二套 timeout、Verdict、Judge 或 publication 运行器。

应用资源状态为 `forward-open` → `cleanup-open` → `closed`。
作者完成、创建失败、执行异常、超时或取消都关闭同一个作用域。
正常完成先冻结判定，再退出执行 deadline 的竞争并释放资源；资源释放期间到达的执行 deadline 不推翻判定。
超时或取消先同步关闭应用方法、Core 登记和 handle 修改入口，再发出取消信号。
同步 abort listener 也不能追加或修改 Assertion，不能只依赖桥接队列拒绝异步请求。
随后按中断规则封口，终态冻结、封口与 publication 交接各只执行一次。

`onCleanup` 成功登记才移交释放义务。已登记回调按逆序执行，一项失败追加 diagnostic 并继续剩余回调。
进入 `cleanup-open` 时开始固定 30 秒总预算，应用回调与已知创建、作者交接都在该预算内；迟到登记不延长期限。
`cleanup-open` 中的迟到登记由原 Scope 接管；已登记回调耗尽且已知交接完成，或总期限到达后，状态变为 `closed`。
关闭后的登记同步抛出生命周期错误，资源仍归调用者，不能另开 runtime 或修改已发布事实。

```ts
const lease = await client.acquire({ signal: ctx.signal });
try {
  ctx.onCleanup(() => lease.release());
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

## 观测、评分与发布

应用返回的 Post、Reply、图片和其它值只有显式交给 `check` 时才形成有界 Assertion 材料，不自动持久化整个应用状态。
Match 接收实际值，持久快照是其有界观察，不替代完整应用状态或图像归档。
没有采集的对话、工具、token 和费用保持缺失；不能从没有 Turn 推导零用量。
Judge 费用只属于 Judge 证据，不代表完整应用费用。

Pass 与 Score 共用 Assertions 求值、封口和 Run publication。
判定从执行 outcome、sealed Assertions 与显式 skip 折叠；Score 从明确 contribution 与完整度形成。
Inspection 不重跑 matcher 或应用代码，View 不另行解释评分。
