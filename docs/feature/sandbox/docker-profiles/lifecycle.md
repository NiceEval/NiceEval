# Docker 执行配置 —— Lifecycle

## 宿主部署

NixOS module或通用 systemd host package完成本机 Linux事务：

```text
validate Linux/systemd/cgroup v2/admin authority
  -> record deployment intent
  -> provision dedicated UID/GID + subuid/subgid
  -> provision or attest bounded filesystem
  -> 按 backing 预建 project-quota allocations，或 fixed-image slots 与 seeds
  -> install aggregate cgroup + daemon + watchdog units
  -> create root-owned descriptor and socket ACL
  -> start watchdog and rootless daemon
  -> write runtime attestation
  -> run host smoke doctor
  -> commit deployment
```

失败按 host deployment journal逆序回滚本轮未发布临时资源。已经发布的 fixed store、slot、seed 与
registry 默认保留；rollback/uninstall 不删除数据。已有 user、unit、mount、filesystem或 profile
只在稳定 identity和 intent完全匹配时收养；同名异主资源拒绝替换。

raw profile 可选择 `storage.backing = "fixed-image-ext4"`，并用 `setupPrefix.enable` 与
`setupPrefix.seedCount` 声明策略。slot 数量和大小来自 `capacity.dockerDataAllocationCount` 与
`capacity.ephemeralDiskBytes`；协议常量、registry、identity 和 limits 全部由 provisioner 生成。
managed profile 选择该 backing 会在配置求值时失败，因为 managed daemon 尚无独立 bounded storage 契约。

fixed backing 默认使用 profile state 下的 `fixed-image-v1/store.img`；`storage.rootDir` 可把完整 outer
store 明确放到独立磁盘（例如 `/data/niceeval/docker-profiles/harness-raw`）。该值必须是规范化后的非根
绝对路径，不能与 active data mount 或旧 sparse image 冲突。manifest 与 mount dependency 都从同一值
派生，infra 不复制内部子路径。

fixed watchdog 必须与宿主 Docker 位于同一 mount namespace；restore 的 unmount、raw image 原子替换与
remount，以及后续 Docker bind allocation，必须观察同一组 slot mount。
因此 fixed watchdog unit 不使用会创建私有 mount namespace 的 systemd filesystem sandbox 选项。

部署不会收养、扩容或改写同 alias 的旧 sparse loop image。
它也使用版本化 host config、slot/seed registry 和 event journal。切换 backing 会改变 descriptor digest、
slot attestation、filesystem identity 与 Setup Prefix execution domain；stable profile ID 与 daemon generation
保持不变。旧 image、host config 与 journal 留在原路径，供 cold rollback 使用。

outer store 与其中的 slot/seed image 都必须 fully allocated。物理校验按
`slots + seeds + slot-count temporary clones` 记账，并保留至少八分之一 store 容量。2 个 4 GiB slot、
10 个 4 GiB seed 与 2 个临时 clone 的 ledger 是 56 GiB，因此 outer store 至少为 64 GiB。
seed 没有 GC；用尽后 admission fail closed，不改写 published seed。

部署依次准备并挂载 outer store，再显式启动 `fixed-activation` transaction。该 unit 不加入
`multi-user.target`。它先让旧/新 watchdog 与 socket 停止并确认 PID/socket 消失，再取得 alias exclusive lock。
锁内依次完成双 journal、Docker resource、mount、process 与 profile cgroup closure。随后才 provision、生成
descriptor，并原子提交 root-owned activation manifest/epoch。

steady-state boot 只拉 verify-only fixed-image attestation、descriptor 与 watchdog。descriptor 对 attestation
同时声明 `Requires` 与 `After`，restart 不会再次切 backing。
首次部署或在线重切先 `systemctl start ...fixed-activation...`，成功后才 enable/start steady-state watchdog；
activation 失败会留下 marker 且 admission 保持关闭。

activation 要求旧、新 journal 中的 lease、reservation、queue、build 和 container 全为零。它也检查 container、
network、volume、image、BuildKit state volume、provisional image 与 slot mount。

检查范围还包括所有进程的 fd/cwd/root/maps。systemd 部署还要求 manifest 绑定的 profile slice 在 activation 时
`populated=0`，且所有 descendant `cgroup.procs` 为空。任何查询/权限错误都 fail closed。

默认 daemon 上的 proxy、parent Attempt network 或旧式无法证明属于 detached cache 的 NiceEval label 同样阻断。
只有同时带 stable profile identity 与 `niceeval.ownership-class=detached-cache/v1`、且没有 active ownership 字段的
realization 可以保留，并写入 manifest。

raw image copy 只操作未挂载 temporary。它先核对 source digest，byte-copy 后恢复目标稳定 UUID。fully allocate、
只读 e2fsck、blkid 与最终 digest 全部通过才 atomic replace。

capture 的 artifact ID 是恢复 seed UUID 后的 published seed 最终 raw digest；restore slot digest 单独记账。
copy/re-UUID/attest/replace/publication 阶段及 source/target/temporary 的 UUID、digest 都进入版本化 journal。
事实不唯一时 scrub unpublished capture 或 quarantine restore，不猜测 roll-forward，也不原地修改 published seed。

daemon、watchdog、data mount与 aggregate cgroup可以常驻。日常 Invocation不拥有它们，也不在
结束时停止它们。NixOS removal或 host package uninstall才负责宿主资源；删除 data必须由管理员
再次确认精确 filesystem/backing，普通 `niceeval` CLI无此能力。

## Invocation 启动

```text
import trusted Eval/config/Experiment modules
  -> pure discovery + link + user selection, with zero Provider I/O
  -> collect profile aliases from selected dockerSandbox declarations
  -> load root-owned descriptors
  -> connect watchdog and attest profile
  -> create one Invocation UUID and per-profile leases
  -> bind each selected Docker Sandbox to its profile context
  -> physical plan
  -> validate every request can fit profile
  -> begin build/admission scheduling
```

attestation和 lease失败发生在任何 NiceEval发起的 Docker I/O与模型调用前。`--dry`不创建
image/container，但仍完成 profile attestation、短命 Invocation lease和静态容量可行性检查；
`check`相同。

多个 Invocation可同时启动。它们不争夺一把 profile全局锁；只有 build slot、逐容器 resource vector
和 Docker data allocation进入 watchdog公平队列。一个 Invocation等待 admission时，已持有容量的其它 Invocation
继续运行。

## Build

```text
request build reservation
  -> watchdog grant maxBuilds slot
  -> persist build operation + provisional image ref
  -> re-attest profile ID + daemon generation
  -> stream normalized build request through control service
  -> watchdog owns daemon/BuildKit session
  -> publish image digest or cancel session
  -> prove session/process activity terminated
  -> release build reservation
```

同一 BuildKey仍走 NiceEval既有 build协调；watchdog额外限制不同进程、不同 BuildKey的总 build数。
build取消或失败先进入 `cancelling`。只有 daemon请求结束、BuildKit session消失、相关 process/cgroup
活动归零且 provisional ref已提交或移除，watchdog才释放 reservation。generation在 build中变化时
结果不提交，Invocation进入 draining。

## Attempt create

```text
request {cpu,memory,pids,container=1,ephemeralDiskBytes} reservation
  -> watchdog atomically grants vector + free Docker data allocation and journals provision token
  -> prepare slot and verify project quota hard limit
  -> re-attest profile ID + daemon generation
  -> control service creates outer container with labels + hard resources
  -> commit reservation to container ID
  -> rprivate bind slot to /var/lib/docker
  -> start provider-owned root bootstrap / supervisor
  -> retry readiness as agent user
  -> initialize workspace/tools
  -> commit active
  -> hand Sandbox to Attempt
```

readiness 前的 exec 只用于探测，不运行 before 或 Agent。create/readiness 失败先提交 destroy intent，
再 force remove并由 id + token证明资源消失。watchdog随后卸载、scrub并验证 Docker data allocation，最后释放
reservation。无法证明回收时 reservation与 slot保持占用，slot进入 `quarantined`，不能为了继续派发
而只删账。

## Setup prefix capability

profile 绑定会在 planning 读取 typed state coverage。只有独立 fixed-image slot 才能完整保存 `dockerData`；shared loop/project-quota Profile 固定为 `Unsupported`。该结果只影响准备缓存，不关闭正常运行：

```text
profile attested
  -> declare coverage = dockerData | Unsupported
  -> lookup longest cumulative dockerData prefix
  -> hit: stop inner workload and daemon, release the private slot
  -> restore immutable seed into a fresh private slot
  -> create a new outer container and restart provider-owned transient state
  -> execute the first all/opaque barrier and every suffix action again
  -> agent.ensure -> Agent -> Eval test
```

capture 在 Action 成功后停止 inner workload 与 dockerd/containerd，卸载当前 slot，把 raw image 发布为 immutable seed。Runner 再恢复到新 slot 继续后缀，不把 staging slot 直接交给 Agent。capture/restore request 携带 required state、SetupPrefixKey、manifest digest 与 generation；Host 拒绝 `all`、缺失字段或 identity mismatch。

capture publish 使用同一个 `operationId` 完成 prepare 与 publish。调用方丢失 publish response 时，
以该 identity 向 Host 对账。已提交返回 `already-published`，不得重新执行已经成功的 Action。

release/abort 已先取得 fence 时返回 `cancel-fenced`。Host 以 scrub 完成作为确定终态，
不把该结果标记为 ambiguity。

连续对账仍无法证明终态时，Runner 将当前 Invocation 标为 environment-level incomplete。
公开诊断包含该 `operationId` 与 `niceeval docker profile doctor <alias>` 修复提示，
但不包含 Host 文件路径。Runner 停止派发剩余 Attempt，也不自动重试或再次执行成功 Action。

`all` 或 opaque barrier 之后的 action 都真实执行，显示 `unsupported-state-ancestor` 或 `opaque-ancestor`。shared Profile 不向 watchdog 申请 artifact seed、copy slot 或 restore；可观测结果是 `unsupported`，不是 cache hit 或 degraded restore。

## 正常与领域失败

passed、failed、errored都执行相同物理收尾：

```text
abort remaining command tree
  -> agent teardown + registered cleanup
  -> physical after
  -> submit destroy intent to watchdog
  -> stop/force remove outer container
  -> verify id + labels + cgroup gone
  -> detach + scrub Docker data allocation
  -> verify empty + quota usage zero + no mount/process reference
  -> commit removed
  -> release admission reservation
```

rootless privileged恒为 DestroyOnly。领域 `failed`不留 stopped container；诊断证据在 remove前通过
既有 Record/diff/execution管线取回。Provider finalizer失败不改写 Verdict，但 Invocation追加
resource error并
退出非零，watchdog继续持有 recovery责任。

## Timeout 与 Ctrl+C

Attempt timeout先 abort Agent/exec，再走同一 finalizer。Docker stop/remove使用独立 cleanup signal，
不能复用已经 abort的 Attempt signal。

第一次 Ctrl+C停止派发并等待在飞 finalizer；第二次触发有界 force remove与 registry drain；第三次
允许 CLI硬退。watchdog已持有 durable intent和 reservation，因此即使用户不等进程内 cleanup，
宿主回收责任也不会消失。daemon、watchdog和 installed mount从不随 Invocation停止。

## CLI SIGKILL

SIGKILL没有进程内 cleanup保证，owner必须是持久 watchdog，而不是“下一次 CLI顺便回收”。创建期
已经持久化：

- 随机 Invocation UUID、lease token digest与 authenticated control connection；
- reservation、provision token、container ID和 state transition；
- build operation ID、BuildKit session、provisional image ref与 build reservation；
- profile ID、daemon generation、Attempt identity与 dead-man deadline labels；
- kept registry的独立原子提交事实。

watchdog检测 control connection断开和 heartbeat停止后，把 lease转为 `lost`。PID/start time只作
辅助诊断。经过有界 grace后按固定顺序恢复：

1. 停止为该 Invocation授予新 reservation；
2. 取消在飞 BuildKit session，并在终止证据齐全后释放 build reservation；
3. 对账 durable journal、Docker labels与当前 daemon generation；
4. 排除已经原子登记的 `kept`资源；
5. running/provisioning outer container先 force remove，stopped container直接 remove；
6. 重复枚举并验证相关 cgroup/process/mount消失；
7. 对匹配 token的 Docker data allocation执行 draining、scrubbing与 verified-free；
8. 释放匹配 container reservation，把 lease提交为瞬时 `recovered` 回执，再从活跃账本移除。

没有 profile ID + Invocation UUID + provision token + journal事实的完整匹配不自动删除。无法枚举、
卸载、scrub或验证时保持 recovery占用并隔离 slot。profile仍可在剩余容量内服务其它 Invocation，但
不能重用该 reservation；
`doctor`显示原始错误和宿主修复入口。

outer PID 1的 dead-man deadline是 watchdog失联时的第二重停止机制，不是资源所有权主机制。下一次
`exp`/`doctor`会观察并报告恢复结果，但正确性不依赖“必须再运行一次 NiceEval”。

## Watchdog restart

watchdog service被杀或重启时：

1. systemd立即重启 service；
2. service从 durable journal、Docker labels和 kept registry重建状态；
3. 对每个 build operation重新连接或取消 BuildKit session，终止前保留 slot；
4. 在对账完成前停止新 admission；
5. 活跃 CLI失去 control generation后停止新 build/create并重连；
6. 能用原 lease token证明连续性的 CLI恢复 session，其它 lease按 SIGKILL路径回收；
7. reservation总和与实际 resource set完全一致后重新开放 admission。

重启不能把 active误判成 orphan，也不能把 committed kept资源删除。

## Daemon restart

daemon restart改变 generation和 daemon ID。daemon ID是审计事实，不是结果 fingerprint；一次
Invocation内的 connection generation则必须稳定。

watchdog发现 restart后停止 admission并对账：

- 所有活跃 CLI收到 generation失效，停止派发；
- 已产生模型成本的 Attempt不自动重跑；
- 在飞 build进入 cancelling，终止证据齐全前不释放 build slot；
- 按 stable profile ID + Invocation labels在新 daemon视图枚举可见资源；
- 资源状态不完整的 Invocation标为 environment-level incomplete；
- journal、labels、reservation与 daemon视图收敛后更新 runtime attestation并恢复新 Invocation。

daemon常驻连续性是验收项：正常 CLI结束不改变 generation；只有宿主 service restart才改变。

## Host reboot 与断电

本机 Linux开机顺序是 bounded filesystem → aggregate cgroup → watchdog recovery → Docker daemon →
profile ready。watchdog在 profile ready前对账上次 boot未提交的 journal。旧 process消失不直接授权释放 lease；只有
build session、resource枚举、kept registry和 journal全部收敛才释放容量。

## 跨进程并发验收

两个独立 `niceeval exp`同时绑定同一 profile，各自声明多条 Attempt。验收必须证明：

- 两者同时取得 Invocation lease，不发生全局独占；
- reservation总和从不超过 aggregate allocatable CPU/memory/PID/container/build上限；
- `ephemeralDiskBytes`总和从不超过物理可授予容量，每笔 reservation只对应一个私有 Docker data allocation；
- 等待者按 watchdog公平队列获得容量，取消等待不泄漏 slot；
- 任一 CLI结束或 SIGKILL不会删除另一 Invocation的资源；
- 每个 outer container和相关 shim/build process实际位于 aggregate cgroup后代；
- 一条 Attempt的 OOM、PID storm、填满 Docker data allocation或 timeout不击穿 sibling。

默认32 GiB filesystem与8 GiB allocation只开放2路。4路晋升至少使用64 GiB filesystem，8路晋升至少使用
128 GiB filesystem；两者都不能依赖稀疏超卖。先跑4路 task-shaped Attempt作为参照；8路必须在相同
故障矩阵、宿主 headroom和硬上限内实测通过，
才允许宿主 profile把 `maxContainers`声明为8。Experiment可以把 `maxConcurrency`设得更大，但不能
越过 watchdog admission。

四路每个 Attempt 为4 CPU，所以 allocatable 不得低于16 CPU，aggregate 不得低于20 CPU。八路
allocatable 不得低于32 CPU、48 GiB memory与16384 PID，aggregate不得低于40 CPU、64 GiB
memory与20480 PID。两种规模都要保存不少于120秒的共同活动区间：每一路必须同时有真实 coding
agent、已 build/run/healthy 的 inner Compose 与持续增长的 CPU activity；排队、readiness、sleep
或仅存在 container 都不计入 active。
