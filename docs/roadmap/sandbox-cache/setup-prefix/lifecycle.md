# Lifecycle

## Planning 与前缀准备

```text
pure link
  → evaluate typed action inputs
  → compile attempt occurrences
  → validate eligibility and capability
  → build dependency DAG per occurrence
  → schedule ready actions by lowest changeFrequency
  → join declared state and stop shared lineage at the first unsupported state
  → BuildKey ready
  → PreparedArtifact only: build Run prefix DAG by full SetupPrefixKey
  → settle all prefix nodes (shared nodes single-flight; independent branches may parallelize)
  → global pre-dispatch barrier
  → dispatch eligible Attempts and satisfy their non-shared before work
  → Adapter runtime setup → Agent → Eval test → runtime teardown
  → attempt after in global reverse order
  → Provider finalizer
```

`--dry` 完成输入求值、occurrence 编译、依赖验证、频率排序、declared/cumulative state、barrier、SetupPrefixKey、CaseKey 与 fingerprint 计算；它不 lookup cache，不创建 staging 或 Sandbox。普通 callback before 始终真实执行，并截断后续共享捕获 lineage，但仍保留在 DAG 中。

只有 `PreparedArtifact` capability 的 eligible prefix 进入 Run DAG。完整 SetupPrefixKey 相同的节点在同一 Run 内 single-flight；父 artifact 已发布且该节点 prepare Scope 已回收，才释放 child。

实际并发是 `maxSetupPrefixConcurrency`（CLI `--max-setup-prefix-concurrency` 可临时替代，默认 2）与 provider `scheduling.lane.limit` 的交集，且不占 Attempt `maxConcurrency`。`Persistent`、`InvocationLocal` 与 `Unsupported` 不进入该 DAG，仍在 Attempt 内处理。

全部 prefix 节点结算前不派发任何 Attempt。节点失败只阻断 descendants 和依赖其 terminal prefix 的 slots；独立分支继续。取消停止并回收未结算 prepare staging 与 publication，已验证发布的 immutable artifact 保留。Run prepare activity 不创建 Attempt locator；只有 barrier 后实际 dispatch 的 slot 才分配并永久保持 locator。

`sandboxCache.setup` 默认是 `"use"`。项目 Config 是持久默认，Experiment 可以替换自己的运行声明，CLI `--sandbox-setup-cache=use|bypass` 是本次 Invocation 的最终取值。`bypass` 不查询也不发布 setup prefix，但仍使用 BuildKey cache；它不进入 CaseKey、SetupPrefixKey 或结果 identity。

## Cleanup、After 与收尾

拥有可用 Sandbox 的 occurrence 进入时，Runner 按稳定 declaration key 登记全部 `.after()`。callback before 成功取得资源后，通过 `context.onCleanup()` 同步登记条件释放。standalone before 的 cache restore 产生 satisfaction fact 并释放依赖节点。

attempt cleanup 在 Adapter runtime teardown 后运行。physical cleanup 在最后一个 Attempt 后、Provider finalizer 前运行。所有收尾使用独立 cleanup signal，按实际登记栈全局逆序执行，永不按 changeFrequency 或第二张 DAG 重排。

共享 prefix 不含 checkpoint、租约、secret 或外部会话。无密钥配置可由最后的高频 before 写入；secret 通过私有 callback 注入，成功后立即登记 cleanup。Provider 还要在 artifact 发布前扫描框架已知的敏感值残留；扫描是纵深防御，不替代类型和 capability 边界。

## Provider capacity admission

等待 Docker profile 等 Provider 容量时，Attempt 保持 `queued`，reason 为 `provider-capacity`。等待者不持 global/experiment permit 或普通 sandbox semaphore。Provider 先给出不占资源的公平 admission ticket；轮到 ticket 时 Runner 短暂取得 permit 并执行非阻塞 `tryGrant`，失败立即释放并继续排队。只有 permit 与 reservation 同时成立后，才进入 `running`、`creating sandbox` 并产生内部 attempt start。

Human active line、顶部 queued/running 汇总和 invocation-local JSON queue transition 必须由同一 reducer 事实投影。公开 JSON 事件不进入 Record。

Runner E2E owner 通过安装后的 `niceeval exp` 与可控 profile capacity fixture 验证：

- 等待者显示 queued/provider-capacity，汇总计数正确；
- grant 后才显示 running/creating；
- 等待者不占普通 sandbox semaphore；
- 其它 Provider 的 Attempt 不发生队头阻塞。

## 失败与安全降级

- occurrence 无法安全编译、重复完整身份、未知或重复 state、secret 进入 eligible action，或不支持的 reuse overlay：planning fail。
- hit 的 key/manifest/image 不一致：忽略该候选，销毁部分恢复的实例，并从更短 verified prefix 或 Base 全新建立。
- action 执行前的 lookup/restore 失败：最多一次从干净起点重建，产生 `cache-degraded`；不能建立干净 Sandbox 时让 Attempt 失败。
- action 已成功执行后的 capture/publish 失败：未破坏当前实例时继续 uncached；无法证明完整时让 Attempt 失败，不能再次执行已经成功的 action。
- steps 或最终 ready 失败：不交付 Sandbox，并销毁当前资源。
- 取消会停止并回收尚未结算的 Run prepare staging 与 publication，不影响已发布 artifact；未派发 slot 不创建 Attempt。
- 部分 capture 不能当成命中，也不能在完整性不明的 staging 上继续。

运行反馈区分 `resolving`、`querying`、`hit`、`replaying`、`unsupported`、`cache-degraded`、`queued`、`quiescing`、`promoting`、`restoring`、`ready` 与 `failed`。state barrier 的 suffix 使用 `unsupported-state-ancestor`，不能显示成 cache miss。

## Debug、Activity 与 timing

`niceeval debug` 显示 occurrence、declarationOrder、changeFrequency、dependencies、topological ordinal 与 scheduling reason。每个 action 还显示 declared state、cumulative state、Provider coverage、barrier action 与 suffix reason。它同时显示 eligibility、prefix identity 与 Provider capability，并固定标记 `cacheLookup: not-probed`。实际 hit、generation 与 restore provenance 只进入运行反馈。

每个 Attempt 保存自己的 queue/satisfaction、restore、action replay、Agent 与 test 时间区间。请求 timing 的 `query` operation 不把 cache 事实投影成跨 Attempt 共享 Activity。Record 不保存本地 image/container locator 或 secret。

Dogfood 使用公开 CLI 比较旧版本对照、冷运行、输入不变的暖运行与只改 Eval/test 的运行。暖运行必须证明 BuildKey 与 Provider 可完整保存的 setup prefix 命中。只改 Eval/test 时 prefix identity 不变，但 Agent/test 仍真实执行。

Profile 场景还要证明 Docker-data marker 不变、outer workspace/home Action 重新执行，以及每个 Attempt 使用不同 writable slot。只改无密钥公开 `.env` 时，固定 runtime 前缀仍命中，barrier 与后缀按新输入执行。真实 token 继续由每 Attempt 的 runtime overlay 注入，并由 cleanup callback 撤销。
