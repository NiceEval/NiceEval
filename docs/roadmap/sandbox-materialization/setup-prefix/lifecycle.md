# Lifecycle

## Planning 与前缀准备

```text
pure link
  → resolve immutable setup inputs
  → validate dependencies and capability
  → linearize setup DAG
  → BuildKey ready
  → longest verified SetupPrefix lookup
  → replay materialize suffix
  → optional prefix promotion
  → private clone / private reset baseline
  → activate in order
  → Attempt
  → deactivate in reverse order
```

`--dry` 完成输入求值、依赖检查、线性化、SetupPrefixKey、CaseKey 与 fingerprint 计算；它不 lookup cache、不取得 lease、不创建 staging 或 Sandbox。普通 callback 保持逐实例执行，并成为 recipe 排序的硬屏障。

查询、等待 single-flight 与 lease acquire 不占 Attempt permit。实际 staging、quiesce、promotion 和 clone 使用 Provider 的资源队列；长期操作不持 registry transaction、Domain 全局锁或 Attempt permit。一个前缀不被 promotion 时，最终实例直接重新执行它及后缀的 recipe，语义不变。

## 激活与收尾

全部 materialize 完成后才开始 activate，materialize 不得依赖 activation。activate 开始前登记对应收尾义务；若某个 activate 失败，已到达节点仍按逆序 deactivate。现有 setup/teardown callback 继续按其物理 Sandbox 生命周期成对执行。

共享 prefix 不含 checkpoint、租约、secret 或外部会话。无密钥配置可在最后的 frequent materialize 中写入；secret 在 clone 后通过私有 activation overlay 注入，并在 deactivate 清除。Provider 还要在 promotion 前扫描框架已知的敏感值残留；扫描是纵深防御，不替代类型和 capability 边界。

## Provider capacity admission

等待 Docker profile 等 Provider 容量时，Attempt 保持 `queued`，reason 为 `provider-capacity`。等待者不持 global/experiment permit 或普通 sandbox semaphore。Provider 先给出不占资源的公平 admission ticket；轮到 ticket 时 Runner 短暂取得 permit 并执行非阻塞 `tryGrant`，失败立即释放并继续排队。只有 permit 与 reservation 同时成立后，才进入 `running`、`creating sandbox` 并产生内部 attempt start。

Human active line、顶部 queued/running 汇总和 invocation-local JSON queue transition 必须由同一 reducer 事实投影。公开 JSON 事件不进入 Record。

Runner E2E owner 通过安装后的 `niceeval exp` 与可控 profile capacity fixture 验证：

- 等待者显示 queued/provider-capacity，汇总计数正确；
- grant 后才显示 running/creating；
- 等待者不占普通 sandbox semaphore；
- 其它 Provider 的 Attempt 不发生队头阻塞。

## 失败

- 缺失依赖、循环、重复完整身份、secret 进入 materialize 或不支持的 reuse overlay：planning fail。
- hit 的 key/manifest/artifact 不一致：隔离该 generation，并从更短 verified prefix 重新执行 recipe。
- recipe、quiesce、捕获、clone 或 ready 失败：不交付 Sandbox；资源销毁或 durable 交给 reconcile。
- 单个 waiter 取消不取消仍有消费者的共享 operation；最后一个 waiter 取消时协作终止未发布 staging。
- promotion 失败不能把部分状态当成命中；可安全重新执行 recipe 时回到最终私有实例，不能在部分修改的 staging 上重试。

可观测状态区分 `resolving`、`querying`、`hit`、`queued`、`materializing`、`quiescing`、`promoting`、`cloning`、`activating`、`ready` 与 `failed`。频率、prefix identity、cache source 与命中事实进入 plan/debug/provenance，但不进入 CaseKey。
