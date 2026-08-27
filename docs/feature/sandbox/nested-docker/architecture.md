# Nested Docker —— Architecture

## 边界

```text
Eval DockerExecutionRequirement
  + Experiment incusSandbox template
  -> capability check and capacity reservation
  -> durable SandboxAllocation intent + generation
  -> Incus VM + private root / workspace / docker-data disks
  -> guest init owns mounts and dockerd
  -> SandboxOperations -> Agent / Eval test
```

`incusSandbox()` 仍是选择 Provider 与完整 origin 的 template。
`sandboxRequirements()` 只是配对时必须满足的约束，不是第二个 template。

## 四个 owner

| Owner | 拥有 | 不拥有 |
|---|---|---|
| NiceEval planning | requirement、capability check、CaseKey、BuildKey、SetupPrefixKey、Run 级 prepare 协调 | Provider locator 与 mount |
| NiceEval control plane | SandboxAllocation ledger、ArtifactIntent、lease、generation、fencing、期望终态 | VM、host filesystem 与 Docker database |
| Provider | instance、host storage pool、virtual disk、snapshot、clone、network、artifact project inventory | Attempt 结果与 Agent replay 决策 |
| guest init / agent | guest mount、dockerd、Unix socket、quiesce receipt | host mount、allocation admission 与 artifact promotion |

host mount 的唯一 mutation owner 是 Provider daemon。
guest filesystem mount 的唯一 owner 是 guest init。
NiceEval 与 doctor 都不执行 mount、umount、loop attach、fsck、nft、sudo、build、import 或 pull a base image。

## Host trust 与 business cache

NixOS 部署只拥有 host trust：Incus runtime project、artifact project、pool、network、quotas，以及
`trustedBaseImages`。它不逐项登记、预建或拥有业务 cache。

NiceEval control plane 才拥有 business cache 的意图、key、生命周期和消费决定；Provider 只拥有其原生
对象与原子操作。这样 host 配置可以信任 exact base，而不需要了解某个 Eval、action 或 prefix 的业务语义。

## requirement 与 capability

Eval 的 `DockerExecutionRequirement` 是 provider-neutral 比较键。
它不编码 Incus、ZFS 或某个 pathname。

Incus planner 返回 `DockerExecutionCapability`。
`capacity` 是 tagged union：`Attested { bytes }` 或 `Unattested { acceptedByExperiment, reason }`。

比较在 create、Record append、模型调用和 Attempt dispatch 之前完成。

- `Attested` 用 `bytes` 对照 `minimumDataBytes`。
- `Unattested` 只有 `acceptedByExperiment === true` 时允许计划继续。
  它绝不声称容量 attested，也不可与 reference 比较。

弱隔离、不足容量或缺 Compose 都是同一类 `sandbox-capability-unsatisfied`。

宿主 Docker socket、raw privileged DinD 与 managed rootless DinD 不能生成
`isolation: "dedicated-kernel/v1"` 且 `daemon: "sandbox-private"` 的 receipt。
planning 不得把它们改写成 nested Docker fallback。

## Reference 与 development domain

execution domain 是 Provider 存储与 attestation 的身份，不是 Eval 字段。

reference domain 只接受 dedicated block-backed、可 attestation 的容量。
loop-backed pool、稀疏文件或目录配额不能伪装成 reference。
attestation 必须同时指向 allocationId、generation、block device identity 与 guest `statfs`。
pathname 或 pool 总容量单独不构成证明。

reference artifact 必须使用 dedicated block-backed CoW 与上述 attestation；不能以 development 的目录复制性能
冒充它。

本机唯一允许的非 reference 例外使用 project `niceeval-eval-dev` 与 storagePool `niceeval-sandbox-dev`。
宿主目录是 `/data/niceeval-sandbox-dev`。
它要求 Experiment 显式 `acceptDevelopmentDomain: true`。

development domain 的 receipt 是 `Unattested`。
explicit opt-in 只允许计划继续，不 attest 容量，结果与 reference 不可比。
未写该字段时，development path 对这条 Experiment 不可见。
development directory 只用于明确 opt-in 的 Unattested 功能 dogfood，不是 CoW 性能面，也不能生产 reference artifact。

改变 execution domain 后，旧 artifact 是 foreign。
系统可以只读列出，不能自动 adopt。

## 镜像信任

`incusSandbox({ image })` 指名一份 digest-pinned、已经受信任的 Provider origin。
可变 alias 不是合法示例，也不能代替 digest。
NiceEval 不 build、不 import、不 pull 该 base image。它可从该 base 和完整 eligible SetupPrefix 创建
Provider-native 派生 artifact；这不改变 base trust，也不把 artifact 伪装为 Incus image。

Provider artifact 可以捕获 exact SetupPrefix，但只有受信任 prepare worker 能发布。
prepare worker 没有模型 credential，不运行 Agent，不接收 Eval hidden input。

普通 Attempt 永不把自己的 Docker data、workspace 或 secret promotion 成共享 artifact。
目标架构不把 `sandboxState.dockerData` 暴露成特殊 public state surface。
Provider 只对完整、可验证的 prepared Sandbox artifact 报告 coverage。
每个 consumer 从 artifact clone 私有 writable disk。

共享加速只有三层：digest-pinned OCI catalog 或 mirror、trusted BuildKit external cache、
Provider-native immutable artifact。
它们都不能伪装成共享 container 或可写 volume。

## Incus preparation artifact

完整 Incus artifact 是 artifact project 中 content-addressed、stopped、immutable 的 template instance，
加上它依赖的 custom block Docker data volume；它不是 Incus image。artifact 的 root 与 volume metadata
相互指向同一 artifact digest、SetupPrefixKey 与 ArtifactIntent，任一方向缺失或不一致都不能消费。

consumer 从 artifact project 跨 project copy template root；Docker data 必须生成新的 consumer source volume，
随后才附着到自己的 allocation。任何 consumer 都不共享 artifact 的可写 root 或 data volume。

`ArtifactIntent` 是 publication 的 committed record，也是消费线性化点。只有 root、volume 与 intent 的
双向 metadata 验证完成后，intent 才提交并让 lookup 命中。创建或提交的 acceptance unknown 时，reconciler
按 intent 和 metadata 查询，不能盲目重发。无 committed intent 的对象是 orphan；已提交但不再能验证的对象
进入 quarantine，均不得被 warm lookup 采用。

Incus repository 在用户级 UserDatabase 中独立持久化 replacement head、consumer lease
与 destroy receipt。replacement scope 来自 provider-neutral SetupPrefix manifest；head 只
指向已 committed generation。consumer handoff 在 clone 前重新核对 generation 并取得
lease，clone settlement 释放 lease。旧 head 只有在 lease 归零后才能进入 destroy；VM 与
dependent custom block volume 的 absent 证据分别落库，二者齐全才提交 `released`。这与
Docker/E2B 的 replacement 生命周期同义，但 Incus 的删除单位是 VM+volume tuple。

clean publication failure 可以回到最深的已提交 ancestor 或 exact base，重新执行后续 prefix。
unknown acceptance、identity 漂移、metadata 不一致或无法删除 orphan 时一律 fail closed。

公开 GC 与 inventory API 另行定义；当前只要求 reconcile exact intent/object。quota 满时返回结构化 fallback 或
失败，而不删除未知对象或把 cache 当成 base。

## 安全边界

不可信面是上传进 Sandbox 的起始 repo、它的依赖、Agent 与 Agent 启动的 inner workload。
它们拿不到宿主 Docker socket、Provider control endpoint、allocation locator 或其它 Attempt 的 daemon。

可信评测代码仍以当前宿主 UID 执行。
本功能不承诺隔离来自 npm / project module 的恶意宿主代码。

guest 内普通 dockerd 对 Agent 是 sandbox-private 的 root 等价能力。
这是 `docker/v1` 的预期，不是逃逸到宿主。
专用 kernel 拒绝把该能力映射成宿主 root。

## SandboxAllocation

`SandboxAllocation` 是 control plane 的 durable resource record。
每次 mutation 先持久化 intent，再调用 Provider。
locator 只有在 exact metadata 回读成功后才提交。
generation 不同的旧 client 即使仍持有 locator，也不能执行 command、snapshot 或 destroy。

V1 没有 `SandboxRetention`。
allocation 的期望终态只有 DestroyOnly：destroyed 或 lost 后的 detached destroy。

## 局部 quarantine

quarantine key 是 exact allocationId、artifactDigest 或 Provider object locator，不是 profile 名。
一个 disk 满或一份 artifact 损坏，不会永久关闭整个 Provider。

只有三种条件关闭整个 Provider admission：无法验证 execution domain、无法证明 capacity ledger，
或 Provider inventory 不可用且 create acceptance 可能为 unknown。
恢复需要重新取得这些全局事实，不以 elapsed timeout 自动解封。
