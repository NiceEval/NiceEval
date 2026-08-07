# Docker 执行配置 —— Architecture

本功能把现有 Dockerfile与 image factory合成官方 `dockerSandbox()`，不新增 DinD provider或
outer Compose编排。profile是同一个 provider的执行 binding；DinD只是评估镜像中的一种 workload。

## 组件与所有权

```text
host deployment (root/admin)
  owns descriptor + dedicated UID + systemd units + bounded filesystem

profile watchdog/admission (persistent TCB)
  owns durable leases + reservations + recovery journal

rootless Docker daemon (dedicated host UID)
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
  readonly securityLevel: "managed-rootless/v1" | "managed-vm-rootless/v1";
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
    readonly kind: "local-systemd" | "dedicated-linux-vm";
    readonly machineIdentity: string;
    readonly owner: { readonly uid: number; readonly gid: number };
    readonly filesystem: {
      readonly identity: string;
      readonly mountPath: string;
      readonly dockerRootDir: string;
      readonly limitBytes: number;
    };
    readonly cgroup: {
      readonly aggregatePath: string;
      readonly policyRevision: string;
      readonly controllers: readonly ["cpu", "memory", "pids"];
    };
  };
  readonly capacity: {
    readonly cpus: number;
    readonly memoryBytes: number;
    readonly memorySwapBytes: 0;
    readonly pids: number;
    readonly maxContainers: number;
    readonly maxBuilds: number;
    readonly reservedMemoryBytes: number;
    readonly reservedPids: number;
  };
  readonly policy: {
    readonly hostLoopback: false;
    readonly tcpDockerEndpoint: false;
    readonly outerSocketInjection: false;
    readonly privilegedTranslation: "rootless-userns";
    readonly writableRoot: "declared-tmpfs-only";
  };
}
```

descriptor不含 callback、可执行路径 Hook、shell snippet、项目 module或凭据。选择名由 registry
文件名/索引映射到 `profileId`；改名不改变稳定 ID。transport只描述 CLI宿主，backend只描述运行
daemon的 Linux machine；本机 profile两者 machine identity相同，VM profile则不同。

external/remote profile沿用同一原则：显式 descriptor + versioned control/attestation protocol。
仅有 Docker endpoint、TLS 连接或 `docker info` 中的 `rootless` 不足以宣称
受管 security level。core只接受自己能完整验证的 security level，不执行外部 profile提供的
自定义验证 callback。macOS专用 VM使用 `managed-vm-rootless/v1`，共享 Docker Desktop不符合它。

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

macOS managed-vm deployment在专用 Linux VM内满足同一组 daemon、cgroup、filesystem与 watchdog
约束。宿主 package用 machine identity绑定 VM与转发后的两个 Unix endpoint。共享 Docker Desktop
VM不能成为该 profile的后端。

## Attestation

CLI加载可信评测 module并收集 `dockerSandbox({ profile })`后，在任何 Docker discovery/build前
完成以下检查：

1. descriptor不是 symlink，owner/mode正确，所有父目录不可由 runtime access group写；
2. transport中的两个 endpoint均是声明路径的 Unix socket，宿主 peer UID和 socket inode匹配；
3. endpoint不是 `/run/docker.sock`、`/var/run/docker.sock`，daemon没有 TCP listener；
4. control challenge返回 descriptor digest、profile ID、host/backend machine identity与当前
   daemon generation；
5. 本机 daemon进程对应 backend owner，且 invoking UID不同；VM evidence证明 guest daemon对应
   backend owner；
6. Docker info中的 daemon ID、DockerRootDir、rootless、cgroup v2/systemd driver与 attestation相同；
7. backend filesystem identity、mount与可见硬容量匹配；
8. 本机 systemd事实或 VM control evidence与 aggregate descriptor一致，controllers没有退化；
9. daemon、containerd/buildkit、shim以及 doctor probe的 cgroup路径均为 `aggregatePath`的严格
   backend aggregate path后代，不是同 slice下的 sibling；
10. watchdog journal、Docker labels、active leases与 reservations可对账。

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
  };
  readonly state: "queued" | "granted" | "committed" | "releasing";
}
```

watchdog在一个事务中检查所有活跃 Invocation 的已授予向量：

```text
sum(container.cpus)        <= allocatable cpus
sum(container.memoryBytes) <= allocatable memory
sum(container.pids)        <= allocatable pids
sum(container.count)       <= maxContainers
sum(active build slots)    <= maxBuilds
```

allocatable容量已扣除 daemon、watchdog、build和宿主 recovery headroom。一个容器请求自身超过上限时
preflight立即失败；暂时无余量则进入跨进程公平队列，不超卖。client取消排队不留 reservation。
Experiment/global `maxConcurrency` 先限制本进程派发，watchdog admission再限制全机；两者都通过才
create。

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

不能在 materialize看到 `privileged`后临时换 daemon。`privileged: "rootless"`、规范化 resources、
target platform与 semantic policy revision进入 ProviderPlan、CaseKey和 Attempt fingerprint。
Dockerfile BuildKey仍只认会改变 image bytes的 context、Dockerfile、args、platform与 base image；
CPU/memory/tmpfs不误入 BuildKey。

profile选择名、stable ID、endpoint locator、owner UID、filesystem路径、aggregate容量、daemon ID和
generation不进入可分享 identity。daemon ID/generation属于连接审计；stable ID属于 detached资源
路由；semantic policy revision才表示可比较的执行语义。

## 单容器资源

Docker HostConfig精确设置 `NanoCpus`、`Memory`、`MemorySwap=Memory`、`PidsLimit`、
`ReadonlyRootfs` 与 `Tmpfs`。rootless cgroup可能静默退化，因此 doctor和 E2E从容器读取真实 cgroup
文件；只看 inspect不足以通过。

`readOnlyRootfs + bounded tmpfs` 把一条 Attempt的可写面限制在声明路径。inner
`/var/lib/docker`是有界 tmpfs，计入该容器 memory cgroup；它不会用 outer data-root保存不受限
的 inner layers。

## 单容器 DinD readiness

评估 image的 root entrypoint负责：

1. 初始化有界 home/workspace；
2. 只监听同容器 Unix socket启动 inner dockerd；
3. 等待 root身份 `docker info`；
4. 把 socket交给显式 agent group/user；
5. exec NiceEval注入的 PID 1 command。

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
