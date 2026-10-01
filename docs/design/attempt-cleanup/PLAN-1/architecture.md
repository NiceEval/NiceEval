# Architecture

Attempt owner 生成领域取消原因，Adapter 只消费事实。现有 deadline controller 与 parent controller 共用首次赢家。
在取消信号通知前先关闭 authoring。deadline 已赢则外部取消不替换原因；外部取消已赢则后续 timer 不改判 timeout。
不靠 Error.name、message 或上游任意 reason 猜取消原因，不复制 deadline timer。

AdapterImplementation 在定义时归一化并冻结 cleanupTimeoutMs。它属于实现行为，并纳入 Adapter 运行身份或配置指纹。
预算变化不能悄悄复用先前采用不同 cleanup 条件的 Attempt。
公开 AdapterIdentity 增加可选 cleanupTimeoutMs，自定义 Adapter 总是写入归一化数值，Agent 不适用则省略。
Schema、配置哈希与字段差异、Inspection 聚合共用此字段；不改 behaviorRevision 来隐式编码预算。

Attempt 进入 cleanup 时一次读取时钟，创建 timeoutMs/deadlineAt 元信息。
Effect cleanup owner 对整个 LIFO 回调队列、晚到注册、已登记 handoff 和归档共用同一剩余预算。
回调收到同一个冻结 context 和独立 signal。后续回调不会重新起计时器。

300000 ms 是框架明确的有界收尾上限，容纳当前 70000 ms drain 加归档，同时拒绝无限等待。
上限不等于预留运行时长；资源提前结束即提前退出。不能把所有 Adapter 默认放大到五分钟。
只扩大时段不授予新的采集权限。时段关闭先于 abort listener 的迟到采集，拒绝仍使用正式错误。
取消后的评分状态保持已封存结果。普通 cleanup 回调抛错维持既有 warning 语义，继续释放其余资源。
cleanup 总时段耗尽追加 adapter-cleanup-timeout 执行错误与诊断。两者都不构造请求成功回执。
应用若必须把正常排空失败视为任务失败，应在 test 中等待 finalize，由该执行失败决定 outcome。

Agent 执行也由同一 Attempt 裁定 deadline，但其组合 send signal 不承诺携带此窄 reason 类型。
本次新增的强类型面限定于 AdapterCreateContext 的 Attempt signal，不将内部 Effect 中断假扮公开取消类型。

## 独立审查后的时序约束

P1-1：关闭资源释放时段必须先关闭 usage 与 trace 接纳，再关闭附件入口并中止附件 producer。
附件 stream 的同步 abort listener 与 cleanup signal listener 都不能越过采集关闭。

P1-2：cleanup 等待未结清 handoff 时，晚到 onCleanup 注册必须唤醒 drain。
队列变化是独立唤醒条件；每次重新检查 LIFO 队列，不等待 handoff 自己结清才运行释放。

P1-3：整个 Attempt body 的真实 Effect interruption 也归一化为 cancelled。
回调位于 execution race 外、资源 Scope 内，先关闭 authoring，再通知同一个首次赢家 controller。
内部 race loser 的中断不触发该回调；不替换已裁定 timeout，不吞原 Cause。

执行与 cleanup 各在 Effect 实际开始执行时固定计时起点。
同一起点投影 Unix deadlineAt，并保存单调耗时；timer 实际安装时只使用原时段剩余量。
正常 Assertion seal 退役执行 timer。cleanup deadline 不因晚到回调或 handoff 延期。

## Host 中断验收的公开组合边界

`niceeval/experiment/host` 是具名 Node composition edge，与 `niceeval/run/host` 一样负责提供数据库与协调能力。
公开 `experimentHost` 的 operation 返回惰性 Effect，requirement 为 `never`；调用者可直接使用
`Effect.runPromise` 或 `Effect.runFork`，不导入私有 Record Service。模块导入和函数调用不获取资源。

每次执行使用本地 `NodeRecordLive` Layer；同次 operation 内共享数据库与协调能力，退出时关闭其 Scope。
Layer 不跨独立执行共享，不启动嵌套 runtime，不捕获或转换调用者的 interruption Cause。

内部 runtime 保留四项真实 requirement：RecordFileSystem、RecordEntropy、RecordCoordination、ProjectStateDatabase。
CLI contribution 使用内部冻结操作对象，由既有 bootstrap 提供能力，避免经过公开包装再次提供资源。
debug 的纯计划语义与既有错误保持不变；公开包装不授予 Record、Runner 或任意数据库写入能力。
内部 Service requirement 类型不作为用户需要构造的公共接口；公开请求、返回值、错误与 operation 名称不变。

另一候选是导出 NodeRecordLive 让调用者自行 provide。它要求深度集成理解未公开的四项能力组合，
并把简单调用拆为两条接线，因此选择具名 Node edge。此决定仅适用于该入口，不改变平台中立 Host 的规则。

公开安装候选先验收不提供任何 Layer 的 plan/run 类型与运行，以及正常收尾后无遗留连接。
取消验收包括：
无 parent AbortSignal 时直接中断 invocation fiber，Adapter 观察到 cancelled，先停止 authoring 再执行
独立有界 cleanup；原 Cause 保留；CLI 仍走原 bootstrap。中断发生在资源获取期间也必须释放已获取资源。

独立 Astra 审查确认：只包装 Layer 不能解决初始化中的 worker。ProjectStateDatabase 的 opening 状态必须持有
自己创建的初始化 AbortController；关闭先冻结 closed 状态并中止初始化，再等待线程终止，不能先等 ready。
私有 worker 构造函数在发送 initialize 前接入该信号，拒绝 pending request 并持有同一个 termination Promise。
信号仅用于初始化，成功后移除监听；已经就绪的 worker 继续使用正常 close 协议。

初始化失败也等待终止，晚到 ready 不得把 closed 状态重新提升为 open。重复 close 等待同一个关闭 Promise。
外层 Effect 中断保持原 Cause；finalizer 的释放不依赖调用者 signal 再次触发，也不增加新的公开取消类型。
