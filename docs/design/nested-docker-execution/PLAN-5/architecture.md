# Architecture

## 边界

```text
Eval NestedDockerRequirement
  + Experiment SandboxTemplate / Provider planner
  -> capability check and capacity reservation
  -> durable SandboxAllocation intent + generation
  -> Provider instance + private root/workspace/docker-data disks
  -> guest init owns mounts and dockerd
  -> SandboxOperations -> Agent / Eval test
```

`SandboxTemplate` 仍是选择 Provider 与完整 origin 的声明。
`NestedDockerRequirement` 只是配对时必须满足的约束，不是第二个 template。

## 四个 owner

| Owner | 拥有 | 不拥有 |
|---|---|---|
| NiceEval planning | requirement、capability check、CaseKey、BuildKey、SetupPrefixKey | Provider locator 与 mount |
| NiceEval control plane | SandboxAllocation ledger、lease、generation、fencing、期望终态 | VM、host filesystem 与 Docker database |
| Provider | instance、host storage pool、virtual disk、snapshot、clone、network、inventory | Attempt 结果与 Agent replay 决策 |
| guest init/agent | guest mount、dockerd/containerd、Unix socket、quiesce receipt | host mount、allocation admission 与 artifact promotion |

host mount 的唯一 mutation owner 是 Provider daemon。guest filesystem mount 的唯一 owner 是 guest init。
NiceEval 和 doctor 都不执行 mount、umount、loop attach、fsck 或 raw filesystem copy。

## SandboxAllocation

`SandboxAllocation` 是 NiceEval control plane 的 durable resource record：

```ts
interface SandboxAllocation {
  readonly allocationId: string;
  readonly attemptId: string;
  readonly provider: string;
  readonly generation: number;
  readonly requirementDigest: string;
  readonly artifactDigest: string;
  readonly requestedDockerDataBytes: number;
  readonly providerLocator?: string;
  readonly state:
    | "reserved"
    | "creating"
    | "ready"
    | "handed-off"
    | "destroy-requested"
    | "destroyed"
    | "lost";
}
```

每次 mutation 先持久化 intent，再调用 Provider。Provider object metadata 至少携带 allocationId、
attemptId、generation、artifactDigest 与 executionDomainId。locator 只有在 exact metadata 回读成功后
才提交。generation 不同的旧 client 即使仍持有 locator，也不能执行 command、snapshot 或 destroy。

## 容量

Provider reservation 在 Attempt dispatch 前取得，不占普通 Sandbox concurrency slot。deployment 为四条
并发 allocation 预留至少 16 GiB Docker writable budget；artifact、root、workspace、metadata 与 emergency
cleanup reserve 另算。CoW 节省的 immutable block不能拿来重复承诺 writable budget。

单 allocation 的 4 GiB 由 guest `statfs`、block device identity 与 Provider volume quota receipt 共同证明。
这些事实必须指向同一 allocationId/generation。pathname、`findmnt` 文本或 storage pool 总容量不单独构成
attestation。

## Provider artifact 与 SetupPrefix

Provider artifact manifest 绑定 Sandbox template、SetupPrefixKey、guest/kernel/Docker identity、target
platform、capture protocol 与 storage format。prepare worker 没有模型 credential，不运行 Agent，不接收
Eval hidden input。它只执行 eligible deterministic actions。

capture barrier 必须证明 inner container、Compose project、BuildKit session 与 shim 数量为零；随后停止
dockerd/containerd、sync、卸载 data volume或关机，再请求 Provider snapshot。snapshot 发布后 immutable。
clone 启动时重建 machine-id、network identity、transient socket、lease agent 与 runtime log。

OCI mirror 与 BuildKit cache是独立 Cache Domain。trusted publisher 可以写 shared namespace；普通 Attempt
只读 shared namespace，并把输出写入 Invocation-private namespace。只有显式受信任 promotion workflow
能把 private result变成共享输入。

## policy 与 backing

deployment policy revision 和 Provider executionDomainId 分开。policy 更新但 storage pool 未改变时：

- 新 allocation 使用新 policy revision 与新 generation；
- 已在飞 allocation 不被新 owner 接管，只允许原 generation 正常完成或 DestroyOnly 回收；
- verified Provider artifact 仅在完整 manifest 与 executionDomainId 相等时继承；
- lease、reservation、pending intent、quarantine 与 transient health 不继承；
- Provider inventory 保持原 identity，不因 policy 文本变化重写 physical facts。

backing 或 executionDomainId 改变时，所有旧 artifact 对新 domain 都是 foreign。系统可以只读列出，
不能自动 adopt。

## 局部 quarantine

quarantine key 是 exact allocationId、artifactDigest 或 Provider object locator，不是 profile 名。
损坏对象从 capacity 扣除并进入 operator-visible inventory；其它通过 attestation 的对象继续 admission。

只有三种条件关闭整个 Provider admission：无法验证 executionDomainId、无法证明 capacity ledger，或
Provider inventory 不可用且 create acceptance 可能为 unknown。恢复需要重新取得这些全局事实，
不以 elapsed timeout 自动解封。
