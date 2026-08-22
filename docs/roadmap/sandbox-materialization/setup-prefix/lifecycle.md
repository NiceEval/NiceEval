# Lifecycle

## Planning 与前缀准备

```text
pure link
  → evaluate typed preparation inputs and scope
  → validate eligibility and capability
  → normalize sandbox scope before attempt scope
  → BuildKey ready
  → satisfy sandbox-scope prefixes
  → establish verified reset baseline
  → per Attempt reset
  → satisfy attempt-scope prefixes
  → Agent / test
  → lifecycle teardown in reverse order
```

`--dry` 完成输入求值、scope 推导、eligibility、规范化顺序、SetupPrefixKey、CaseKey 与 fingerprint 计算；它不 lookup cache、不取得 lease、不创建 staging 或 Sandbox。普通 lifecycle callback 始终真实执行，并截断后续共享捕获 lineage。

查询、等待 single-flight 与 lease acquire 不占 Attempt permit。实际 staging、quiesce、promotion、restore 和 clone 使用 Provider 的资源队列；长期操作不持 registry transaction、Domain 全局锁或 Attempt permit。一个前缀不被 promotion 时，最终实例直接重新执行它及后缀，语义不变。

## Lifecycle 与收尾

`.lifecycle({ scope, setup, teardown })` 与 preparation operation 属于同一规范化序列。setup invocation 前登记 teardown 义务；若 setup 部分失败，已到达节点仍按全局逆序 teardown。attempt-scope teardown 在该 Attempt 的 Agent/test/cleanup 后运行；sandbox-scope teardown 在最后一个 Attempt 后、Provider finalizer 前运行。teardown 使用独立 cleanup signal，永不缓存或因 prefix hit 跳过。

共享 prefix 不含 checkpoint、租约、secret 或外部会话。无密钥配置可由最后的高频 operation 写入；secret 通过私有 lifecycle overlay 注入并在 teardown 清除。Provider 还要在 promotion 前扫描框架已知的敏感值残留；扫描是纵深防御，不替代类型和 capability 边界。

## Provider capacity admission

等待 Docker profile 等 Provider 容量时，Attempt 保持 `queued`，reason 为 `provider-capacity`。等待者不持 global/experiment permit 或普通 sandbox semaphore。Provider 先给出不占资源的公平 admission ticket；轮到 ticket 时 Runner 短暂取得 permit 并执行非阻塞 `tryGrant`，失败立即释放并继续排队。只有 permit 与 reservation 同时成立后，才进入 `running`、`creating sandbox` 并产生内部 attempt start。

Human active line、顶部 queued/running 汇总和 invocation-local JSON queue transition 必须由同一 reducer 事实投影。公开 JSON 事件不进入 Record。

Runner E2E owner 通过安装后的 `niceeval exp` 与可控 profile capacity fixture 验证：

- 等待者显示 queued/provider-capacity，汇总计数正确；
- grant 后才显示 running/creating；
- 等待者不占普通 sandbox semaphore；
- 其它 Provider 的 Attempt 不发生队头阻塞。

## 失败

- scope 反向依赖、重复完整身份、secret 进入 operation 或不支持的 reuse overlay：planning fail。
- hit 的 key/manifest/artifact 不一致：隔离该 generation，并从更短 verified prefix 重新执行 recipe。
- recipe、quiesce、捕获、clone 或 ready 失败：不交付 Sandbox；资源销毁或 durable 交给 reconcile。
- 单个 waiter 取消不取消仍有消费者的共享 operation；最后一个 waiter 取消时协作终止未发布 staging。
- promotion 失败不能把部分状态当成命中；可安全重新执行 recipe 时回到最终私有实例，不能在部分修改的 staging 上重试。

运行反馈区分 `resolving`、`querying`、`hit`、`replaying`、`unsupported`、`queued`、`quiescing`、`promoting`、`restoring`、`ready` 与 `failed`。

`niceeval debug` 只显示静态 scope、eligibility、prefix identity 与 Provider capability，并固定标记 `cacheLookup: not-probed`。实际 hit、generation 与 restore source 只进入运行反馈和 provenance。
