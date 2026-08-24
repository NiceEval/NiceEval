# Architecture

## 前缀身份

Base 之后每个 eligible before action 产生一个链式身份：

```text
SetupPrefixKey[i] = hash(
  provider and exact Base image identity,
  SetupPrefixKey[i - 1],
  occurrence kind = attempt,
  owner kind + stable id + declaration order,
  linked topological order and changeFrequency,
  explicit dependency and typed capability edges,
  action id,
  automatic fingerprint + optional supplemental fingerprint,
  canonical steps digest,
  immutable input identities after lookup,
  target platform and execution user,
  interpreter and Docker cache format revisions
)
```

parent key 使相同 action 不能从不同 verified baseline 错误复用。action 类型、命令或目标、规范化参数、已求值 typed inputs 和 steps 引用的完整内容身份形成自动指纹。`cache.fingerprint` 只补充 NiceEval 无法观察的协议或实现世代，不能关闭或替换自动指纹。

occurrence 固定是 attempt，不因 owner、内容稳定性或 Sandbox reuse 提升为 physical-instance。Eval test 源码变化只产生新结果需求，不进入未改 before action 的 SetupPrefixKey。

`changeFrequency` 通过 linked topological order 与祖先链进入身份。cache 冷热、本地 image/container locator、credential value、Attempt UUID、bypass 选择和调度额度不进入 key。

## 依赖与稳定总序

普通 inputs 不产生 action 间的依赖边。显式 `dependsOn` 与具名 `provides` / `requires` capability 形成 DAG；每个 attempt occurrence 独立拓扑排序。跨 occurrence、跨 lane、跨 Attempt 或跨物理实例的边在 planning 阶段失败。

调度只从 ready set 取节点，依次比较：

1. 有限非负 `changeFrequency`；`-0` 规范成 `0`，小数保留，负数、NaN 与 Infinity 拒绝；
2. owner kind `experiment → eval-group → eval → agent`；
3. 稳定 owner id；
4. owner 内 ordinal。

action id 在同一 occurrence 内必须唯一。after 与动态 cleanup 只按实际登记栈 LIFO，不读取频率，也不建立第二张 DAG。

## 命中与发布

`verified` 只证明声明 identity、Docker image 完整性与恢复隔离，不证明任意 shell、网络或时间读取的外部语义。`defineSandboxAction()` 是作者对“只依赖声明输入、可重复、只改变被捕获 Sandbox”的确定性承诺。普通 JSON/text 由作者声明为非敏感输入；NiceEval 拒绝显式 secret handle、credential binding 与框架已知敏感值，但不做通用污点分析。

只有 key、manifest 与 Provider 输出双向验证成功的前缀可以命中。每个 eligible before occurrence 都产生 satisfaction：hit 恢复 verified private state，miss 从最长 verified prefix replay，unsupported 真实执行。

普通 Docker 对 opaque barrier 前的每个成功 action 同步 commit exact image，inspect image ID、labels 与 manifest，再从该 image 建立下一段 staging。Agent/test 只在最终前缀的私有 writable 容器中运行。这样后缀变化时只重新执行发生变化的节点及其后缀。

## Provider capability

Provider binding 对 core 暴露 lookup、创建 staging、capture、verify 与 instantiate 的 typed capability。`Unsupported` 与 operational failure 分离；不支持 prefix cache 时明确重新执行 steps，但不能伪造命中。

本地普通 Docker 单容器按下文 rootfs 边界报告 `Persistent`。Docker Compose、E2B、Vercel、custom Provider 与 profile-bound DinD 报告 `Unsupported`。这个缓存不进入公开 Provider Cache Domain，也不提供 inventory、精确失效或 GC 命令。普通 Docker 实现可以维护私有的 key index、single-writer lease 与 consumer ownership；这些只保护自动 lookup/capture/clone，不能成为用户管理面。

## Docker rootfs 边界

本地 Docker 只支持单容器且全部可变状态都在 outer writable rootfs 的 case。capture 前停止容器并等待进程退出，sync 后从停止的容器 commit 带 SetupPrefixKey 和 manifest labels 的 immutable image。restore 必须从 exact image ID 创建新容器，验证 labels/manifest，并为每个消费者提供独立 writable upperdir。

bind mount、tmpfs、Compose sidecar、host socket、profile-backed `/var/lib/docker` 和其它未进入 outer writable rootfs 的 mount 都不满足该契约。raw DinD 只在 `/var/lib/docker` 本身位于 outer writable layer 时可以捕获。

Provider 要先停止 inner dockerd/containerd 与 inner container，再停止 outer container。复制正在运行的 data-root、只 commit 实际使用外部 data volume 的 outer container，或共享 writable upperdir 都必须报告 Unsupported。

capture staging 的 create spec 不含 credential env、secret handle 或 Adapter runtime overlay。需要凭据才能创建 staging 或执行 action 的 case 报告 Unsupported。只在最终私有容器中注入 secret，并立即登记 cleanup。发布前检查 image config/history 与框架已知敏感值；该检查是纵深防御，不替代作者的非敏感声明。

## Docker Profile 不支持 Setup Prefix cache

raw privileged 与 managed rootless Profile 的 private Docker data-root 位于 project-quota slot，不在 outer writable rootfs。只 commit outer image 会丢失 inner image 和 BuildKit 状态。

这个方向不定义 `ArtifactSet V2`。把 seed 或 copy 放在 quota slot 之外会绕过 project quota，sparse backing 的逻辑容量也不能证明物理容量。因此 profile-bound DinD 固定报告 `Unsupported`，不创建 host artifact lease/index，不使用 outer image 伪造 hit，也不回退到普通 Docker endpoint。

普通 callback before 截断整条共享捕获 lineage；后续 action 标记 `ineligible: opaque-ancestor`。callback、secret 与 external-I/O action 仍参与 DAG 调度。每个物理 Sandbox 可以另有私有 reset baseline，但 opaque state 不能登记为共享 prefix。sandbox reuse 下，secret overlay 由始终真实执行的 callback 注入，成功后通过 `context.onCleanup()` 登记移除；无法证明隔离时该组合在 planning 失败。

## SandboxStep 解释边界

core 统一解释封闭的 `SandboxStep` protocol，并通过私有窄目标调用标准 Sandbox operations。Action 定义者与 step 都不能取得 Sandbox；Provider 也不解释 family 或 steps，不得按 family id 分支。

Provider 只声明标准 operation 与 capture capability。core 从规范化 step 自动推导 operation requirements；全部 step 成功后，Provider 才负责 quiesce、capture 与 restore。Action 中途失败不发布内部半成品前缀。

step protocol 的解释语义由 `interpreterRevision` 标识，并进入 linked prefix 与 fingerprint。family 自身无法从 canonical input、steps 与身份查找结果看出的语义变化，统一写入补充的 `cache.fingerprint`。steps 已变化时自动指纹随之变化，不要求作者重复维护 revision。

## 损坏与精确失效

Setup prefix cache 是优化，不是 Attempt 正确性的必要条件。lookup 或 restore 在任何 action 执行前失败时，Runner 忽略不可验证的 image，最多一次从可信的更短前缀或 Base 重建。只有 exact image ID、labels、manifest 和私有容器全部验证完成后才报告 hit。

action 已成功执行后，capture 失败不得再次执行该 action。当前容器仍完整时，Runner 在原实例继续 uncached；无法证明完整时让 Attempt 失败。取消只能阻止未完成的 image publication；cleanup 使用独立 signal，不继承 caller abort。

这个方向不公开 setup-prefix inventory、精确失效或 GC。普通 Docker 的私有 index/lease 只保证并发发布与独立 consumer 安全；Profile 不得复用它来声称 inner data-root 已被捕获。作者只通过 `use | bypass` 选择是否访问准备缓存。
