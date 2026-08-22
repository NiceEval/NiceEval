# Docker 执行配置 —— Architecture

本功能把现有 Dockerfile与 image factory合成官方 `dockerSandbox()`，不新增 DinD provider或
outer Compose编排。profile是同一个 provider的执行 binding；DinD只是评估镜像中的一种 workload。

## 组件与所有权

```text
host deployment (root/admin)
  owns descriptor + systemd units + bounded filesystem + pre-created allocation pool

profile watchdog/admission (persistent TCB)
  owns durable leases + reservations + data-slot state + recovery journal

profile Docker daemon (managed uses dedicated host UID)
  owns image/cache data + outer container runtime

NiceEval CLI (trusted daily UID)
  owns one Invocation UUID + provider clients + its builds/containers

Eval/config/Experiment modules (trusted host code)
  choose dockerSandbox source + local profile alias + requirements

outer eval container (untrusted workload)
  owns PID 1 + inner dockerd + coding agent + inner Compose resources
```

专用 UID 是无登录 account，不共享日常用户 HOME，不属于 docker/root/sudo 等宿主特权组。它只读
daemon binary和 profile 配置，只写 bounded data-root与自己的 runtime directory。

普通运行 UID通过 access group连接 outer socket和 control socket。能访问 outer Docker socket
等于能以专用 UID的 rootless user namespace管理容器，因此运行 UID及其加载的评测 module都属于
可信 TCB。只有评估容器、起始 repo、Agent与 inner workload属于不可信面。

## Callback-free profile descriptor

profile 是宿主 registry 中的 root-owned纯数据。下面字段是 v1 binding，而不是 Experiment 配置：

```ts
interface DockerExecutionProfileV1 {
  readonly schemaVersion: 1;
  /** 宿主部署生成的稳定不透明 ID；不等于本地选择名。 */
  readonly profileId: string;
  readonly securityLevel:
    | "raw-dind-storage/v1"
    | "managed-rootless/v1";
  /** NiceEval 从下方语义 policy 重新计算并核对，不能只信字符串。 */
  readonly semanticPolicyRevision: string;
  /** 全部路径和 UID 都属于运行 niceeval CLI 的宿主。 */
  readonly transport: {
    readonly kind: "unix";
    readonly hostMachineIdentity: string;
    readonly dockerSocket: { readonly path: string; readonly peerUid: number };
    readonly controlSocket: {
      readonly path: string;
      readonly peerUid: number;
      readonly protocol: "niceeval-docker-profile-control/v1";
    };
  };
  /** 下列 identity、UID和路径全部属于执行 Docker daemon的 Linux backend。 */
  readonly backend: {
    readonly kind: "local-systemd";
    readonly machineIdentity: string;
    readonly owner: { readonly uid: number; readonly gid: number };
    readonly filesystem: {
      readonly identity: string;
      readonly mountPath: string;
      readonly dockerRootDir: string;
      readonly limitBytes: number;
      /** 部署时预建，不能在 Attempt create路径临时扩容。 */
      readonly dockerDataPool: {
        readonly count: number;
        readonly bytesPerAllocation: number;
        readonly attestation: "linux-project-quota/v1";
      };
    };
    readonly cgroup: {
      readonly aggregatePath: string;
      readonly policyRevision: string;
      readonly controllers: readonly ["cpu", "memory", "pids"];
    };
  };
  readonly capacity: {
    /** 已扣除 daemon、build、watchdog 与 recovery headroom，可授予 Attempt 的容量。 */
    readonly cpus: number;
    readonly memoryBytes: number;
    readonly memorySwapBytes: 0;
    readonly pids: number;
    readonly maxContainers: number;
    readonly maxBuilds: number;
    /** 可授予 Docker data allocation的硬容量；不能按 sparse apparent size计算。 */
    readonly ephemeralDiskBytes: number;
    /** systemd aggregate cgroup 的硬上限；必须不小于 allocatable + headroom。 */
    readonly aggregate: {
      readonly cpus: number;
      readonly memoryBytes: number;
      readonly memorySwapBytes: 0;
      readonly pids: number;
    };
  };
  readonly policy:
    | {
        readonly level: "raw-dind-storage/v1";
        readonly privilegedTranslation: "host-daemon";
        readonly dockerData: "private-project-quota-allocation/v1";
      }
    | {
        readonly level: "managed-rootless/v1";
        readonly hostLoopback: false;
        readonly tcpDockerEndpoint: false;
        readonly outerSocketInjection: false;
        readonly privilegedTranslation: "rootless-userns";
        readonly writableRoot: "declared-tmpfs-only";
        readonly dockerData: "private-project-quota-allocation/v1";
      };
}
```

descriptor不含 callback、可执行路径 Hook、shell snippet、项目 module或凭据。选择名由 registry
文件名/索引映射到 `profileId`；改名不改变稳定 ID。transport与 backend都描述运行 CLI和 daemon的
Linux宿主，两个 machine identity必须相同。仅有 Docker endpoint、TLS 连接或 `docker info` 中的
`rootless`不足以宣称受管 security level。v1只接受 Linux、systemd与 cgroup v2；其它宿主不能注册
该 descriptor，也不能执行外部 profile提供的自定义验证 callback。

`raw-dind-storage/v1`只证明 Docker data allocation、跨进程磁盘准入和 watchdog恢复。它允许 outer daemon是
rootful，也不证明 network、user namespace、sibling或宿主隔离。managed security level必须包含同一
`private-project-quota-allocation/v1` capability，再叠加本节定义的 rootless、cgroup与网络承诺。
`securityLevel`必须与 `policy.level`相同；raw不能携带 managed policy字段来暗示更强保证。

## 宿主 TCB

官方 Linux managed-rootless deployment固定满足：

- root-owned descriptor与父目录；access group只有 traverse/read，不能写父目录或替换 socket；
- `User=<dedicated uid>`，不是 invoking UID；
- rootlesskit、dockerd与 watchdog都以 dedicated UID运行，`CapEff`为空且不属于宿主特权组；
- `Delegate=yes`，cgroup v2 `cpu,memory,pids` controllers 已下放；
- aggregate cgroup设置 CPU、memory、`MemorySwapMax=0` 与 Tasks硬上限；
- dockerd/containerd/buildkit、所有 shim和 outer container scope均位于 aggregate subtree；
- rootlesskit 使用独立 user、mount、network namespace；host loopback和 port driver关闭；
- dockerd只监听 descriptor中的 Unix socket；没有 TCP listener、host PID、host network、rootful
  socket或项目 bind；
- DockerRootDir精确落在可证明有硬容量的独立 filesystem；
- watchdog常驻并能访问 profile Docker endpoint；journal文件由 dedicated UID持有，位于 root-owned、
  access group不可写的专用父目录中。

daemon与watchdog跨 Invocation常驻，复用可信 Dockerfile build产生的 image cache。它们、aggregate
cgroup与 data mount是 installed infrastructure，不是某次运行的 orphan。

## Attestation

CLI加载可信评测 module并收集 raw的 `storageProfile`与 managed的 `profile`后，在任何 Docker
discovery/build前完成以下检查：

1. descriptor不是 symlink，owner/mode正确，所有父目录不可由 runtime access group写；
2. transport中的两个 endpoint均是声明路径的 Unix socket，宿主 peer UID和 socket inode匹配；
3. endpoint不是 `/run/docker.sock`、`/var/run/docker.sock`，daemon没有 TCP listener；
4. control challenge返回 descriptor digest、profile ID、host/backend machine identity与当前
   daemon generation；
5. 本机 daemon进程对应 backend owner，且 invoking UID不同；
6. Docker info中的 daemon ID与 DockerRootDir和 attestation相同；managed还要求 rootless、cgroup
   v2与 systemd driver匹配；
7. backend filesystem identity、mount与可见硬容量匹配；
8. 每个预建 slot的 project ID、hard limit和实际 backing匹配，且总承诺不超过可授予物理容量；
9. managed的本机 systemd事实与 aggregate descriptor一致，controllers没有退化；
10. managed daemon、containerd/buildkit、shim以及 doctor探测的 cgroup路径均为 `aggregatePath`的
    严格 backend aggregate path后代，不是同 slice下的 sibling；
11. watchdog journal、Docker labels、active leases、reservations与 data-slot状态可对账。

任一检查失败，profile不进入 planner context。provider在每次 build/create前通过 control service
重新核对 profile ID和 generation，防止 planning到 create之间切换 daemon。generation改变时整次
Invocation停止派发并标为 environment-level incomplete；不会在另一个 daemon自动重建已经产生模型
成本的 Attempt。

## Invocation lease 与跨进程 admission

profile不使用全局独占锁。每次 CLI向 watchdog创建 crash-safe Invocation lease：

```ts
interface DockerProfileInvocationLeaseV1 {
  readonly schemaVersion: 1;
  readonly invocationId: string;
  readonly profileId: string;
  readonly daemonGeneration: string;
  readonly clientNonceDigest: string;
  readonly createdAt: string;
  readonly lastHeartbeatAt: string;
  readonly state: "active" | "draining" | "lost" | "recovered";
  /** 仅作诊断，不作为存活或所有权的唯一证据。 */
  readonly process?: { readonly pid: number; readonly startedAt: string };
}
```

所有权依据是随机 Invocation UUID、不可伪造的 lease token、与 watchdog保持的 authenticated control
connection、durable journal和 Docker resource labels的组合。PID/start time只是诊断事实，不能单独
授权删除或接管。

每项 Docker操作先取得 reservation：

```ts
interface DockerProfileReservationV1 {
  readonly reservationId: string;
  readonly invocationId: string;
  readonly kind: "build" | "container";
  readonly provisionToken: string;
  readonly resources: {
    readonly cpus: number;
    readonly memoryBytes: number;
    readonly pids: number;
    readonly containers: 0 | 1;
    readonly ephemeralDiskBytes: number;
  };
  readonly state: "queued" | "granted" | "committed" | "releasing";
}
```

任何绑定 profile的 `dockerSandbox()`都在类型与运行时两层要求完整 CPU、memory、PID、
`dockerDataBytes`和只读 rootfs。planner把 `dockerDataBytes`规范化为 reservation的
`ephemeralDiskBytes`。因此 container reservation始终有确定向量，profile没有无界 create路径。
省略 profile的普通 Docker沿用既有 provider行为，不进入该 profile的 admission或安全承诺。

container create与 Dockerfile build都由 control service持有 daemon connection。CLI只提交规范化请求
与 context stream。raw和 managed共用这条持久 owner约束，使 CLI断连后 watchdog仍能取消 build、删除
container并回收 Docker data allocation。

Build reservation另有持久 operation：

```ts
interface DockerProfileBuildOperationV1 {
  readonly buildOperationId: string;
  readonly reservationId: string;
  readonly invocationId: string;
  readonly buildKey: string;
  readonly daemonGeneration: string;
  readonly provisionalImageRef: string;
  readonly state: "streaming" | "building" | "cancelling" | "terminated";
}
```

managed profile的 Dockerfile build不由 CLI直接向 daemon发送。官方 provider把规范化 build请求和
context stream交给 control service；watchdog持有 daemon build connection、BuildKit session与
provisional image ref。这样 CLI断连后，持久 owner仍能取消在飞 build。

build slot只有在以下事实都成立后才释放：daemon build请求已终止，BuildKit不再报告该 session，
对应 process/cgroup活动已消失，provisional ref已提交为完成 digest或已移除。无法证明终止时，
reservation保持占用并让 doctor报告 degraded，不能先释放 slot再让后台 build继续运行。

watchdog在一个事务中检查所有活跃 Invocation 的已授予向量：

```text
sum(container.cpus)        <= allocatable cpus
sum(container.memoryBytes) <= allocatable memory
sum(container.pids)        <= allocatable pids
sum(container.count)       <= maxContainers
sum(container.ephemeralDiskBytes) <= allocatable ephemeralDiskBytes
sum(active build slots)    <= maxBuilds
```

磁盘准入按已验证 backing上的可分配物理 bytes计算。稀疏文件的 apparent size、thin pool未兑现空间和
可压缩后的估计值都不能增加 `ephemeralDiskBytes`。每笔 reservation还必须匹配一个 hard limit不小于
请求值的 free allocation；容量向量与 allocation必须在同一 journal事务内授予。

allocatable容量已扣除 daemon、watchdog、build和宿主 recovery headroom。一个容器请求自身超过上限时
preflight立即失败；暂时无余量则进入跨进程公平队列，不超卖。client取消排队不留 reservation。
Experiment/global `maxConcurrency` 先限制本进程派发，watchdog admission再限制全机；两者都通过才
create。

默认 profile使用32 GiB硬容量 filesystem、8 GiB allocation和2路 `maxContainers`。其中16 GiB可授予
Attempt，其余空间留给 outer daemon image/cache、build、scrub和 recovery。晋升4路时 filesystem至少
64 GiB；晋升8路时至少128 GiB，并始终保持每路8 GiB的 hard quota和同等 headroom比例。

四路配置中每个 Attempt 请求 4 CPU，因此 allocatable 至少是 16 CPU；aggregate 硬上限至少是
20 CPU，并另提供 4 CPU 给 daemon、BuildKit、watchdog 与回收。八路晋升的 allocatable 至少是
32 CPU、48 GiB memory 与 16384 PID；aggregate 至少是 40 CPU、64 GiB memory 与 20480 PID。
descriptor 与 CLI 输出中的 `capacity` 一律指 allocatable，`capacity.aggregate` 才指 cgroup 硬上限，
两者不能混称。

## Outer 网络隔离

watchdog 为每个 Attempt 创建独占的 user-defined bridge network。network ID 与 container ID 作为
同一个 journal-first 生命周期单元管理。network 允许经 rootless NAT 访问公网 DNS/HTTPS 与拉取
依赖，但禁用 inter-container communication。不同 Attempt 的容器不得接入彼此 network。

managed profile 禁止使用 Docker 默认 bridge、host network、host gateway、published port，亦禁止把
outer Docker/control socket 注入容器。容器不得访问宿主 loopback、宿主控制 endpoint 或任一 sibling；
inner dockerd 与 Compose 只能存在于自己的 outer namespace。

create、CLI 断连或 SIGKILL 后，watchdog 以 profile ID、Invocation ID、Attempt ID、provision token
labels 对账 container 与 network。两者按同一生命周期单元回收；不能只删容器而遗留 network，亦不能
误删 active sibling。

admission是协调边界，aggregate cgroup与 bounded filesystem才是即使可信 CLI有 bug时仍成立的
硬边界。doctor必须用真实 process cgroup路径证明 container scope位于 aggregate之下。

## Physical planning 与身份

profile必须在 physical planning前绑定，因为以下步骤必须同源：

```text
attested daemon target platform
  -> Dockerfile FROM resolution
  -> BuildKey
  -> image build
  -> eval container create
```

不能在 materialize看到 Docker access后临时换 daemon。managed rootless DinD、规范化 resources、
target platform与 semantic policy revision进入 ProviderPlan、CaseKey和 Attempt fingerprint。
Dockerfile BuildKey仍只认会改变 image bytes的 context、Dockerfile、args、platform与 base image；
CPU/memory/tmpfs不误入 BuildKey。

语义 identity之外另有不公开的物理执行域：

```ts
interface DockerMaterializationDomain {
  readonly profileId: string;
  readonly daemonGeneration: string;
}
```

BuildKey描述“应构建哪些 bytes”，build realization按
`(DockerMaterializationDomain, BuildKey)`隔离。相同 BuildKey在两个 daemon各自保证本地 image存在，
不能把 daemon A的完成事实交给 daemon B。Sandbox复用池同样把 domain加入 CaseKey之外的物理 pool
key，禁止跨 profile或 generation复用 container。

Docker cache domain只存在于当前进程的 build coordinator、Sandbox pool和资源 registry。它不
进入 fingerprint或可分享结果，因此 daemon restart不会使既有结果失去携带资格；restart后的
新 Invocation仍会在新 domain重新确认 image realization。

profile选择名、stable ID、endpoint locator、transport/backend UID、filesystem路径、aggregate容量、daemon ID和
generation不进入可分享 identity。daemon ID/generation属于连接审计；stable ID属于 detached资源
路由；semantic policy revision才表示可比较的执行语义。

## 单容器资源

Docker HostConfig精确设置 `NanoCpus`、`Memory`、`MemorySwap=Memory`、`PidsLimit`、
`ReadonlyRootfs` 与 `Tmpfs`。rootless cgroup可能静默退化，因此 doctor和 E2E从容器读取真实 cgroup
文件；只看 inspect不足以通过。

`readOnlyRootfs + bounded tmpfs`限制普通可写路径。inner `/var/lib/docker`使用每 Attempt私有的
disk-backed Docker data allocation，不使用大 tmpfs。control service以固定 `rprivate` bind把已授予的目录挂到该
路径；mount propagation不能把 inner mount传播回宿主。source路径、allocation ID和 token不通过 inspect、
mount metadata、子进程变量或文件暴露给不可信 workload。

allocation由部署事务预建，不跨 Attempt复用已写状态。watchdog拥有如下状态机：

```text
free -> preparing -> granted -> attaching -> active
  -> draining -> scrubbing -> verified-free -> free
```

`preparing`核对 project ID与 hard quota；`attaching`只允许匹配 reservation token的 control owner执行。
收尾先卸载并确认无引用，再删除 slot全部内容和 inner Docker metadata。只有独立验证目录为空、quota用量
归零且没有 mount或进程引用后才进入 `verified-free`。任何证据不确定、token不匹配或 scrub失败都进入
`quarantined`；该 allocation继续计入已占容量，不能重新授予。

## 单容器 DinD readiness

官方 Docker provider注入的 root bootstrap / supervisor负责：

1. 初始化有界 home/workspace；
2. 只监听同容器 Unix socket启动 inner dockerd；
3. 等待 root身份 `docker info`；
4. 以镜像中已加入 `docker`组的 Agent用户执行 readiness；
5. 同时监督 daemon、keeper、日志与容器内 TTL。

outer container进入 Running后，官方 Docker provider仍重试作者声明的 readiness command。只有
`user: node`实际完成 `docker info`才算 create成功。Agent能使用 inner socket即拥有评估容器内
root等价权限，这是预期；inner container、network、volume与 Compose project全在本 Attempt内。

## 持久资源状态机

watchdog journal先于 Docker create持久化 intent，container创建期带
`profile-id`、`invocation-id`、`reservation-id`、`provision-token`与 Attempt标签。状态区分：

- `provisioning`：有 intent/reservation，资源尚未完整提交；
- `active`：Invocation仍持有、Attempt在运行；
- `kept`：已原子提交到 retention registry的明确留存资源；
- `destroying`：已提交销毁意图；
- `orphan`：owner lease已不可恢复，且既非 kept也非已完成销毁。

rootless privileged恒为 DestroyOnly，不会进入 `kept`；状态机仍必须区分 kept，避免通用 Docker
watchdog或 `sandbox prune`误删其它 profile的合法留存资源。

自动回收只触碰 profile ID、Invocation UUID、reservation与 journal/labels全部匹配的资源。单靠
容器名字、过期 heartbeat或一个 PID消失都不授权删除。正常 stop/remove只忽略 Docker 304/404；
其它错误保留 journal所有权并上报，不能吞掉。

任何持久 keep/orphan registry项都保存 stable profile ID。`sandbox enter/list/stop/prune`在新进程
按 ID重连原 profile；找不到时报告不可达，不尝试默认 Docker socket。

## 威胁模型

本功能防御：

- Agent任意执行 inner Docker API、构建恶意 image、运行 privileged inner container；
- Agent填盘、fork/PID、内存与 CPU消耗；
- Agent尝试定位 outer/host Docker socket或 host loopback；
- 多个可信 CLI并发争抢 profile容量；
- Runner timeout、Ctrl+C、SIGTERM、SIGKILL、watchdog与 daemon restart。

本功能不承诺防御：

- Linux kernel、rootlesskit、runc、dockerd的成功逃逸链；
- 已获 profile socket访问权的恶意宿主用户；
- 管理员安装的恶意 daemon/runtime或被攻陷的 host package；
- 物理宿主被攻陷。

需要抵御这些风险时使用带同一 profile选择契约的隔离 VM、一次性专用宿主或远程 provider。
