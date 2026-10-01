# 发送与封存

1. Attempt 初始化创建 collector，冻结 pricing。应用与 Agent 共享同一拥有者。
2. check 登记时固定 entryIndex，把内部记账能力传入延迟 material QA 或直接受管 ScoreMatch。
3. 每个逻辑步骤完成预算、凭据、协议、材料校验，准备有界请求。此时尚未登记物理请求。

4. 每次 HTTP 重试分别创建 transmission capability。signal 已 abort 则拒绝；否则预留容量、登记 pending，紧接着调用 fetch，中间不 await。
5. transport 收到 headers 立即同步提交 httpStatus；有界 body 完成后同步解码并提交白名单回执，然后才兑现 Promise 供评分解码。

6. 同一个 capability 的 response-commit 与 abort/close 以首次同步发生者为准。已提交 token/cost 不因之后取消或 QA 错误回退。
7. HTTP 非成功、断连或内容错误不删除调用。重试等待不计调用，下一次 fetch 使用新的 transmission ordinal。

8. entry timeout 只关闭该 entry 的全部 capability，禁止该 entry 继续发送，不关闭 Attempt 或其它 entry 的调用能力。
9. Attempt 终止则关闭所有 entry admission 及打开 capability，随后触发 abort；终态前冻结账本，并在 Record 发布时绑定正式 entryId。

## 取消与回执截止

每个 transmission 的唯一回执接纳截止是 body-commit、signal abort、entry close、Attempt close 中最先发生的同步动作。
headers 先到则 httpStatus 可保留；仅 headers 不表示收到 token 或费用。abort 后 body 才返回，即使其它 entry 仍执行，也不得补写该项。

调用状态 succeeded/failed 表示收到完整 HTTP body 的 2xx/非 2xx；2xx 的 QA 内容非法仍是 succeeded 传输。
本地 abort 为 cancelled，终态仍未闭合的项为 unknown；两者都不声称远端物理完成。

Effect tryPromise 中断会忽略迟到 resume，不能据此认为底层 Promise 已结清。账本写入放在 transport 自己的 capability 回调，不依赖评分 Effect 恢复。
transport 独占 reader、abort listener 和资源释放 Promise；abort 先关闭 capability，再取消 body、释放 reader lock 并移除 listener。

body 读取与 abort 竞争，确保本地读取任务有界结束。取消后的资源释放最多 1000 ms，沿已有 Judge timeout/Attempt 剩余期限取更小值，不延长应用测量。
未结清的 cancel promise 需显式挂 catch，不能留下未处理拒绝；无法证明资源释放完成时保留诊断，不宣称服务端完成。

需要先返回的取消路径仍跟踪资源释放任务，Attempt 封存前在该有界等待期限内等待，不把 Effect fiber finalizer 当作底层 Promise 的证明。

物理次数精确定义为 NiceEval 已调用 fetch 的传输尝试；连接建立失败也算一次。网关内重试无法由本机推导。
传输取消与 Attempt cancellation reason 遵守既有 first-winner，不引入新取消协议。
