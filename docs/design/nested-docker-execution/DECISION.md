# Decision

## 裁决

采用 [PLAN-5](PLAN-5/README.md)：NiceEval 把 nested Docker 定义为 Provider-neutral Sandbox
capability，Eval 只声明 `docker/v1 + dedicated-kernel/v1`、Compose 与最低 data capacity。
Experiment 选择满足要求的 Sandbox Provider。

NixOS 自托管 reference Provider 使用 Incus VM。首个 storage policy 使用专用 ZFS pool，挂载到
`/data/niceeval-sandbox`；没有专用 block device/partition 时 preflight 失败，不用 loop-backed pool
伪装生产存储。每条 Attempt 从 trusted Provider artifact clone 一台 VM，并取得独立 4 GiB Docker data
virtual disk。Runloop 作为首个托管 Provider PoC，只有通过同一 capability 与 recovery suite 才开放。

最终产品不再使用 raw/managed DinD outer container，也不把宿主 Docker socket作为 nested execution
fallback。Sandbox 内运行的是 guest OS 的普通 Docker daemon；“nested”只描述用户视角的 Docker 在
评估 Sandbox 里面，不要求实现层继续 Docker-inside-Docker。

## 根因裁决

已观察故障是 owner 模型错误，不是一次 systemd allowlist 漏项。activation 和 watchdog 在不同 mount
namespace 中改变同一 host storage lifecycle，导致 registry identity、pathname 与实际 filesystem
identity分离。watchdog 随后同时承担 quota observer、mount mutator、Docker quiesce、raw copier、recovery
owner 与 global admission gate，任何一项不确定都会放大成 profile-wide failure。

终态通过删除这条共享职责链解决。Provider daemon 独占 host instance、storage 与 mount mutation；
guest init 独占 guest mount 与 dockerd。NiceEval 只拥有 allocation ledger、lease、fencing、
capability binding 与结果。watchdog 不再需要 mount/umount 权限，也不再作为独立产品组件存在。

## 对比

| 候选 | 正确性 | 隔离 | warm 性能 | 实现成本 | 运维复杂度 | 裁决 |
|---|---|---|---|---|---|---|
| PLAN-1 dual-owner fixed-image DinD | 低；namespace 与 journal 仍耦合 | 中；共享宿主 kernel | 中；raw copy 与 fsck 有固定成本 | 中；保留代码最多 | 很高 | 否决 |
| PLAN-2 static-slot DinD | 中低；reset 必须穷尽 Docker 私有状态 | 中；共享宿主 kernel | 高；registry/BuildKit 与长期 daemon | 中 | 高 | 否决 |
| PLAN-3 直接 Incus VM | 高；成熟 inventory/storage owner | 高；专用 guest kernel | 高；CoW clone + OCI/BuildKit | 中高 | 中 | 作为 reference adapter，不作为产品抽象 |
| PLAN-4 直接托管 Provider | 待 PoC；API inventory决定上限 | 高，前提是 dedicated kernel receipt | 高；Blueprint/snapshot | 中 | 本机低、供应商依赖中高 | 作为 hosted adapter，不作为唯一抽象 |
| PLAN-5 capability + 多 Provider | 高；owner 与错误面稳定 | 高；能力门拒绝弱隔离 | 高；Provider artifact + 内容缓存 | 首个 Provider 高，后续中 | 中 | 采用 |

PLAN-5 比 PLAN-3 多一层 capability contract，但这层不是虚假通用化。`docker/v1`、Compose V2、
dedicated kernel、private daemon 与 minimum data bytes 都能在 create 前穷尽比较，也能由 readiness receipt
验证。第二个 Provider 必须跑同一 suite，防止接口退化成改名后的 Incus wrapper。

## storage policy

| 后端 | 优点 | 风险 | 裁决 |
|---|---|---|---|
| ZFS | Incus 原生 snapshot/clone/quota/reservation；checksum；官方推荐且可靠性评价最高 | 内存与运维成本较高，需要专用 pool | 自托管 reference |
| LVM-thin | block-native VM volume、instant clone、snapshot；不暴露 host child mount | thin pool 容易 overcommit，必须另做 data/metadata 剩余容量阈值与 reservation | 合格的第二自托管 policy |
| Btrfs | 原生 CoW、snapshot、quota，Incus 官方推荐 | 需要 `/data` 采用相应 filesystem，运维经验要求不同 | 合格但非 reference |
| loop-ext4 image | 容易放进现有目录 | Incus 明确不建议生产 loop pool；重回 loop/attach/fsck 状态空间 | 禁止 |

storage driver 只影响 Provider artifact format、capacity receipt 与 deployment identity，不进入 Eval 的
`DockerExecutionRequirement`。改变 executionDomainId 后，旧 artifact 是 foreign，不自动 adoption。

## 缓存裁决

不把“复制上一条 Attempt 的 `/var/lib/docker`”作为共享缓存策略。共享加速由三层组成：

1. digest-pinned OCI catalog 或 registry mirror，减少重复 pull；
2. trusted BuildKit external cache，普通 Attempt 只读共享 namespace；
3. exact SetupPrefix 的 immutable Provider artifact，由无 Agent/secret 的 prepare worker 在完整 quiesce 后发布。

Provider artifact 可以物理包含一个 prepared Docker data volume，但语义上保存的是受信任的完整 Sandbox
起点，不是任意 Attempt 的 Docker database。每个 consumer 从 artifact 建立私有 writable clone。
`sandboxState.dockerData` 这一 Provider 特例退出最终 public contract。

## 恢复裁决

V1 是 DestroyOnly。CLI `SIGKILL`、VM 丢失、Provider client 中断或宿主重启后，NiceEval 恢复 control
ledger并 fence 旧 generation。在飞 Attempt 记为 `environment incomplete`，随后 detached destroy
instance、disk、network 与 lease。新的 Invocation 可以从相同 Provider artifact 开始，
但不会自动重新发送模型请求或再次执行工具调用。

quarantine 只绑定 exact allocation、artifact 或 Provider object。只有 execution domain、capacity ledger 或
Provider inventory整体不可验证时才停止该 Provider admission。一个 4 GiB disk 满或一份 artifact 损坏
不会永久关闭整个 profile。

## 终态替换边界

这是一次产品替换，不维护 DinD 与 VM 双轨，也没有兼容 fallback。进入新产品面的条件是 Incus reference
Provider 已通过 C1–C11；达到条件时，同一发布把 NiceEval-Eval 的 Docker/Compose requirement 切到新
API，并移除旧 Docker access/profile 面。未达到条件时仍视为新方向未完成，不把 PLAN-1/PLAN-2 包装成
过渡产品。

最终代码归属如下：

| 处置 | 现有能力 |
|---|---|
| 保留 | Sandbox Operations、SandboxCase 主空间、Provider planner、BuildKey/CaseKey、SetupPrefix DAG 与 identity、activity/timing、Record 公开结果、detached inspect/destroy 思路 |
| 重写 | Provider cache coverage 改为 VM/Devbox Provider artifact；资源 registry 改为 SandboxAllocation ledger + generation/fencing；doctor 改为只读或自有探测 allocation |
| 删除 | `dockerAccess.mode: "socket" | "dind"` 的 nested-execution 路径、raw privileged/managed rootless bootstrap、Docker storage profile、fixed slot/seed、activation/watchdog、loop attach、raw copy、UUID rewrite 与 Docker-data snapshot capability |
| 保留为历史证据 | `0fc97d5cc` 与 `6f28a823` 只说明旧 profile 的 incident guard；终态没有对应 runtime 路径 |

若未来另有“可信本地工具使用宿主 socket”的产品需求，必须作为不同 capability 和 trust boundary 重新
设计；它不能满足 `docker/v1`，也不能被 nested Docker requirement选中。

## 旧数据

`/data/niceeval-dind-pool.img` 不进入 Incus storage pool或 SandboxAllocation ledger。安装、activation、
doctor、reconciler 与 GC 都不得自动打开、挂载、fsck、adopt、rename 或 delete。操作者若要处理它，使用
NiceEval 之外的显式运维流程。

## 公开验收

唯一 dogfood 流程见 [PLAN-5 · NiceEval-Eval](PLAN-5/use-case/README.md)。通过必须同时包含：

- 安装后 `niceeval exp` 的两条真实并发 Run 与 score；
- `niceeval show --run` 的 cold replay、warm hit 与 elapsed 对比；
- public doctor 与探测 allocation 的四路 capacity、4 GiB quota 与 destroy receipt；
- `SIGKILL`、宿主重启和局部 artifact 损坏后的回收与继续 admission；
- 旧 pool 未变化，且全程没有宿主 socket或 DinD fallback。

## 风险

- Incus + ZFS 在目标 NixOS host 上的包、KVM、network 与 dedicated pool 仍需真机 PoC。
- guest boot 与 dockerd ready 是否优于现有 setup 时间必须实测；不能用理论 clone 速度代替。
- Runloop 是否能证明 dedicated kernel、4 GiB hard limit、metadata inventory 与 detached destroy 尚待 PoC。
- Provider artifact capture 的 guest quiesce protocol需要故障注入，尤其是 BuildKit session 与 daemon stop。
- capability API 与现有 environment-model 的一次 template owner 规则需要在实现前同步到 Feature 契约；
  `sandboxRequirements()` 保持 command-only，不创建第二个 origin。
