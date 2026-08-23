# Lifecycle

## Planning 与前缀准备

```text
pure link
  → evaluate typed action inputs
  → compile occurrence kind from inputs and sharing cohort
  → validate eligibility and capability
  → build dependency DAG per occurrence
  → schedule ready actions by lowest changeFrequency
  → BuildKey ready
  → satisfy physical-instance before prefixes
  → establish verified reset baseline
  → per Attempt reset
  → satisfy attempt before prefixes
  → Adapter runtime setup → Agent → Eval test → runtime teardown
  → attempt after in global reverse order
  → physical after in global reverse order
```

`--dry` 完成输入求值、occurrence 编译、依赖验证、频率排序、SetupPrefixKey、CaseKey 与 fingerprint 计算；它不 lookup cache、不取得 lease、不创建 staging 或 Sandbox。普通 callback before 始终真实执行，并截断后续共享捕获 lineage，但仍保留在 DAG 中。

查询、等待 single-flight 与 lease acquire 不占 Attempt permit。实际 staging、quiesce、promotion、restore 和 clone 使用 Provider 的资源队列；长期操作不持 registry transaction、Domain 全局锁或 Attempt permit。一个前缀不被 promotion 时，最终实例直接重新执行它及后缀，语义不变。

## Cleanup、After 与收尾

拥有可用 Sandbox 的 occurrence 进入时，Runner 按稳定 declaration key 登记全部 `.after()`。callback before 成功取得资源后，通过 `context.onCleanup()` 同步登记条件释放。standalone before 的 cache restore 产生 satisfaction fact 并释放依赖节点。

attempt cleanup 在 Adapter runtime teardown 后运行。physical cleanup 在最后一个 Attempt 后、Provider finalizer 前运行。所有收尾使用独立 cleanup signal，按实际登记栈全局逆序执行，永不按 changeFrequency 或第二张 DAG 重排。

共享 prefix 不含 checkpoint、租约、secret 或外部会话。无密钥配置可由最后的高频 before 写入；secret 通过私有 callback 注入，成功后立即登记 cleanup。Provider 还要在 promotion 前扫描框架已知的敏感值残留；扫描是纵深防御，不替代类型和 capability 边界。

## Provider capacity admission

等待 Docker profile 等 Provider 容量时，Attempt 保持 `queued`，reason 为 `provider-capacity`。等待者不持 global/experiment permit 或普通 sandbox semaphore。Provider 先给出不占资源的公平 admission ticket；轮到 ticket 时 Runner 短暂取得 permit 并执行非阻塞 `tryGrant`，失败立即释放并继续排队。只有 permit 与 reservation 同时成立后，才进入 `running`、`creating sandbox` 并产生内部 attempt start。

Human active line、顶部 queued/running 汇总和 invocation-local JSON queue transition 必须由同一 reducer 事实投影。公开 JSON 事件不进入 Record。

Runner E2E owner 通过安装后的 `niceeval exp` 与可控 profile capacity fixture 验证：

- 等待者显示 queued/provider-capacity，汇总计数正确；
- grant 后才显示 running/creating；
- 等待者不占普通 sandbox semaphore；
- 其它 Provider 的 Attempt 不发生队头阻塞。

## 失败

- occurrence 无法安全编译、重复完整身份、secret 进入 eligible action 或不支持的 reuse overlay：planning fail。
- hit 的 key/manifest/artifact 不一致：隔离该 generation，并从更短 verified prefix 重新执行 steps。
- steps、quiesce、捕获、clone 或 ready 失败：不交付 Sandbox；资源销毁或 durable 交给 reconcile。
- 单个 waiter 取消不取消仍有消费者的共享 operation；最后一个 waiter 取消时协作终止未发布 staging。
- promotion 失败不能把部分状态当成命中；可安全重新执行 steps 时回到最终私有实例，不能在部分修改的 staging 上重试。

运行反馈区分 `resolving`、`querying`、`hit`、`replaying`、`unsupported`、`queued`、`quiescing`、`promoting`、`restoring`、`ready` 与 `failed`。

`niceeval debug` 显示 occurrence、declarationOrder、changeFrequency、dependencies、topological ordinal 与 scheduling reason。它还显示 eligibility、prefix identity 与 Provider capability，并固定标记 `cacheLookup: not-probed`。实际 hit、generation 与 restore provenance 只进入运行反馈。
