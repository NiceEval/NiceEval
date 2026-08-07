# Docker 执行配置 —— Lifecycle

## 宿主部署

NixOS module或通用 systemd host package完成本机 Linux事务：

```text
validate Linux/systemd/cgroup v2/admin authority
  -> record deployment intent
  -> provision dedicated UID/GID + subuid/subgid
  -> provision or attest bounded filesystem
  -> install aggregate cgroup + daemon + watchdog units
  -> create root-owned descriptor and socket ACL
  -> start watchdog and rootless daemon
  -> write runtime attestation
  -> run host smoke doctor
  -> commit deployment
```

macOS VM package完成另一条宿主事务：

```text
validate virtualization + launchd + admin authority
  -> create dedicated VM identity and bounded disk
  -> boot Linux guest
  -> provision guest UID/subids/cgroup/daemon/watchdog
  -> install host Unix transport and root-owned descriptor
  -> attest host/guest machine identity pair
  -> run host-to-guest smoke doctor
  -> commit deployment
```

失败按 host deployment journal逆序回滚本轮新建资源。已有 user、unit、mount、filesystem或 profile
只在稳定 identity和 intent完全匹配时收养；同名异主资源拒绝替换。

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

多个 Invocation可同时启动。它们不争夺一把 profile全局锁；只有 build slot和逐容器 resource vector
进入 watchdog公平队列。一个 Invocation等待 admission时，已持有容量的其它 Invocation继续运行。

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
request {cpu,memory,pids,container=1} reservation
  -> watchdog atomically grants and journals provision token
  -> re-attest profile ID + daemon generation
  -> create outer container with labels + hard resources
  -> commit reservation to container ID
  -> start provider-owned root bootstrap / supervisor
  -> retry readiness as agent user
  -> initialize workspace/tools
  -> commit active
  -> hand Sandbox to Attempt
```

readiness前的 exec只用于 probe，不运行 setup/prepare/agent。create/readiness失败先提交 destroy intent，
再 force remove并由 id + token证明资源消失，最后释放 reservation。无法证明回收时 reservation保持
占用并由 watchdog接管，不能为了继续派发而只删账。

## 正常与领域失败

passed、failed、errored都执行相同物理收尾：

```text
abort remaining command tree
  -> agent teardown + registered cleanup
  -> sandbox lifecycle teardown
  -> submit destroy intent to watchdog
  -> stop/force remove outer container
  -> verify id + labels + cgroup gone
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
7. 释放匹配 container reservation并把 lease提交为 `recovered`。

没有 profile ID + Invocation UUID + provision token + journal事实的完整匹配不自动删除。无法枚举或
删除时保持 recovery占用，profile仍可在剩余容量内服务其它 Invocation，但不能重用该 reservation；
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

本机 Linux开机顺序是 bounded filesystem → aggregate cgroup → watchdog recovery → rootless daemon →
profile ready。macOS先由 launchd确认 dedicated VM machine identity，再进入 VM内相同顺序。watchdog
在 profile ready前对账上次 boot未提交的 journal。旧 process消失不直接授权释放 lease；只有
build session、resource枚举、kept registry和 journal全部收敛才释放容量。

## 跨进程并发验收

两个独立 `niceeval exp`同时绑定同一 profile，各自声明多条 Attempt。验收必须证明：

- 两者同时取得 Invocation lease，不发生全局独占；
- reservation总和从不超过 aggregate allocatable CPU/memory/PID/container/build上限；
- 等待者按 watchdog公平队列获得容量，取消等待不泄漏 slot；
- 任一 CLI结束或 SIGKILL不会删除另一 Invocation的资源；
- 每个 outer container和相关 shim/build process实际位于 aggregate cgroup后代；
- 一条 Attempt的 OOM、PID storm、填满 tmpfs或 timeout不击穿 sibling。

先跑4路 task-shaped Attempt作为参照；8路必须在相同故障矩阵、宿主 headroom和硬上限内实测通过，
才允许宿主 profile把 `maxContainers`声明为8。Experiment可以把 `maxConcurrency`设得更大，但不能
越过 watchdog admission。

四路每个 Attempt 为4 CPU，所以 allocatable 不得低于16 CPU，aggregate 不得低于20 CPU。八路
allocatable 不得低于32 CPU、48 GiB memory与16384 PID，aggregate不得低于40 CPU、64 GiB
memory与20480 PID。两种规模都要保存不少于120秒的共同活动区间：每一路必须同时有真实 coding
agent、已 build/run/healthy 的 inner Compose 与持续增长的 CPU activity；排队、readiness、sleep
或仅存在 container 都不计入 active。
