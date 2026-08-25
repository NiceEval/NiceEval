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
| NiceEval planning | requirement、capability check、CaseKey、BuildKey、SetupPrefixKey | Provider locator 与 mount |
| NiceEval control plane | SandboxAllocation ledger、lease、generation、fencing、期望终态 | VM、host filesystem 与 Docker database |
| Provider | instance、host storage pool、virtual disk、snapshot、clone、network、inventory | Attempt 结果与 Agent replay 决策 |
| guest init / agent | guest mount、dockerd、Unix socket、quiesce receipt | host mount、allocation admission 与 artifact promotion |

host mount 的唯一 mutation owner 是 Provider daemon。
guest filesystem mount 的唯一 owner 是 guest init。
NiceEval 与 doctor 都不执行 mount、umount、loop attach、fsck、nft、sudo、build、import 或 pull image。

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

本机唯一允许的非 reference 例外使用 project `niceeval-eval-dev` 与 storagePool `niceeval-sandbox-dev`。
宿主目录是 `/data/niceeval-sandbox-dev`。
它要求 Experiment 显式 `acceptDevelopmentDomain: true`。
development domain 的 receipt 是 `Unattested`：explicit opt-in 只允许计划继续，不 attest 容量，结果与 reference 不可比。
未写该字段时，development path 对这条 Experiment 不可见。

改变 execution domain 后，旧 artifact 是 foreign。
系统可以只读列出，不能自动 adopt。

## 镜像信任

`incusSandbox({ image })` 指名一份 digest-pinned、已经受信任的 Provider origin。
可变 alias 不是合法示例，也不能代替 digest。
NiceEval 不 build、不 import、不 pull 该 image。

Provider artifact 可以捕获 exact SetupPrefix，但只有受信任 prepare worker 能发布。
prepare worker 没有模型 credential，不运行 Agent，不接收 Eval hidden input。

普通 Attempt 永不把自己的 Docker data、workspace 或 secret promotion 成共享 artifact。
目标架构不把 `sandboxState.dockerData` 暴露成特殊 public state surface。
Provider 只对完整、可验证的 prepared Sandbox artifact 报告 coverage。
每个 consumer 从 artifact clone 私有 writable disk。

共享加速只有三层：digest-pinned OCI catalog 或 mirror、trusted BuildKit external cache、
Provider-native immutable artifact。
它们都不能伪装成共享 container 或可写 volume。

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
