# Docker 执行配置（Docker Profile）

Coding agent经常需要在 Sandbox里运行 `docker build`、`docker run`与 `docker compose`。把宿主
`/var/run/docker.sock`挂进评估容器，会让不受信任的 Agent取得宿主 root等价能力。把评估容器
直接交给宿主 rootful daemon并开启 privileged，同样没有可接受的隔离边界。

本主题扩展 NiceEval内建的 `dockerSandbox()`。评测代码在 factory中声明起始镜像、managed
rootless DinD、单容器资源与 readiness。profile后端是同一 Linux宿主上的 Docker daemon，但它不是
新的 Sandbox provider，也不是 DinD专用抽象。

Linux managed后端由专用 OS UID持有 rootless Docker daemon。Agent、inner dockerd与 inner Compose都在
同一个 outer eval container里，outer socket永远不进入该容器。

## 核心心智

```text
宿主部署者一次配置
  -> NixOS module或 systemd host package
  -> Docker daemon + 有硬容量的 data filesystem + 预建 allocation pool
  -> aggregate cgroup + 持久 watchdog/admission service
  -> root-owned、纯数据的 profile descriptor
  -> 本机别名 default

可信评测代码
  dockerSandbox({
    source: {...},
    dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "default" }
    resources: { dockerDataBytes: 8 * GiB, ... }
  })
  -> NiceEval加载声明
  -> 在任何 Docker I/O、build与模型调用前 attest profile
  -> discovery、physical planning、build、run全程使用同一 daemon

每条 Attempt
  -> 原子取得 CPU/memory/PID/container/ephemeral-disk reservation与私有 Docker data allocation
  -> 一个 rootless daemon中的 privileged outer eval container
  -> root PID 1启动 inner dockerd并等待 ready
  -> coding agent以普通用户 exec
  -> agent使用同容器 Unix socket运行 Docker / Compose
```

daemon、watchdog、aggregate cgroup与 data filesystem是宿主部署，不归某次 Invocation所有。CLI
正常退出、报错或被强杀都不停止它们。Invocation只拥有自己的 lease、reservation、build与 outer
container。

## 四个边界

### 评测作者边界

`dockerSandbox()`声明：

- `source.type: "image" | "dockerfile"`；
- `dockerAccess.mode: "dind"`；
- `isolation: "managed-rootless"`与宿主 profile别名；
- 必填的每容器 CPU、memory、PID和只读 rootfs；
- 逐路径有界 tmpfs；
- inner Docker data硬上限 `dockerDataBytes`；
- inner daemon readiness。

managed分支不会接受含糊的 `privileged: true`。需要 raw privileged DinD时必须显式写
`isolation: "raw-privileged"`与 `storageProfile`。raw profile只承诺磁盘配额、跨进程准入和强杀恢复，
security level为 `raw-dind-storage/v1`；它不承诺 rootless或共享宿主隔离。
`dockerComposeSandbox()`不接受这组单容器字段；这里的
Compose是 Agent在单个评估容器内连接 inner dockerd后运行的 Compose，不是 outer sidecar。

### 信任边界

Eval、config与 Experiment TypeScript以当前宿主 UID执行，本来就能读取该用户可访问的文件和
socket，因此属于可信评测 TCB。本功能不承诺隔离来自 npm/project module的恶意宿主代码。

不可信面是上传进 Sandbox的起始 repo、它的依赖、Agent和 Agent启动的 inner workload。它们拿不到
outer Docker endpoint、control endpoint、profile descriptor或 lease token。

### NiceEval core边界

core在加载可信声明后负责 profile查找、attestation、语义 identity、Invocation lease、跨进程
admission、资源 registry与回收协议。profile是纯数据，不能携带 callback、shell Hook或项目代码。
core不提供“连接 profile后执行任意宿主命令”的入口。

### 宿主部署边界

官方 NixOS module或通用 systemd host package负责专用 UID、subid、delegation、
socket ACL、有界 filesystem、aggregate cgroup、daemon与 watchdog。日常 `niceeval exp`和
`niceeval docker profile doctor`从不 sudo、不修改 `/etc`、不 mount loop device，也不安装 daemon。

有硬容量的 filesystem是宿主契约。loop-backed ext4只是 Linux部署包可选的兑现方式，不是跨平台
公开 API。

## Profile选择

managed DinD中的 `profile: "default"`是宿主本地别名。NixOS和 Ubuntu可以各自把合适
后端登记成 `default`，所以同一份 Experiment不需要按 Linux发行版分支。别名不是结果 identity；实际
profile的 semantic policy revision才表示执行语义。

普通 `dockerSandbox()`可以省略 `dockerAccess`，此时Agent拿不到任何 Docker socket。socket模式与
raw privileged DinD必须声明 Docker storage profile，managed rootless DinD必须声明包含相同 storage
capability的 managed profile。两个分支都必须给出完整 CPU、memory、PID、`dockerDataBytes`、只读
rootfs和显式可写 tmpfs。profile不存在、无法 attest或安全级别不符，均在 Docker build
与模型调用前失败，不能回退到宿主 rootful socket。

## 安全保证

Linux managed profile的 Docker API权限落在专用 host UID的 user namespace中，不等于宿主 root。
宿主服务不接收评测 repo、HOME、凭据、
rootful Docker socket、host PID或 host network bind；评估容器拿不到 outer socket。

拥有 profile socket ACL的宿主用户属于可信运行者。若要防御 Linux kernel、rootlesskit、runc或
dockerd逃逸，应使用专用 VM或远端 profile；本功能不把本机容器边界描述成 VM边界。

## 资源与并发

资源有三层：

| 层 | owner | 约束 |
|---|---|---|
| Profile aggregate | 宿主 cgroup + 有界 filesystem | 总 CPU、memory、swap、PID、真实磁盘与 daemon/build/scrub headroom |
| 跨进程 admission | 持久 watchdog | 多个 Invocation的 reservation总和、`ephemeralDiskBytes`、同时 build与 container数 |
| 单个 eval container | outer daemon | CPU、memory、0 extra swap、PID、只读 rootfs、有界 tmpfs、私有 Docker data allocation |

同一 profile可以同时服务多个 `niceeval exp`。每条 Attempt在 create前向 watchdog原子申请资源
向量；所有进程的已授予向量之和不得超过 aggregate可分配量。Experiment `maxConcurrency`限制本
Invocation，profile admission再限制所有 Invocation的总资源。默认32 GiB filesystem配8 GiB allocation只
开放2路；4路与8路分别至少晋升到64 GiB与128 GiB硬容量，不能用稀疏文件超卖。

## Setup Prefix cache 边界

普通单容器 Docker 可以把全部可变状态收进 outer writable rootfs，因而可以用 exact image 实现 Setup Prefix cache。raw 与 managed Docker Profile 的 private data-root 位于 project-quota slot，不在该 rootfs。

只 commit outer image 会丢失 inner image 和 BuildKit 状态。把 seed 或 copy 放在 slot 之外会绕过 project quota，sparse backing 的逻辑容量也不能证明物理容量。因此 Profile 绑定的 Setup Prefix capability 固定报告 `Unsupported`，before action 按统一顺序真实执行。

这个 Profile 契约不包含 `ArtifactSet V2`、host artifact lease/index 或组件恢复。NiceEval 不会用缺少 data-root 的 outer image 报告 cache hit，也不会回退到未受 profile 约束的 Docker daemon。

## 范围

本主题包含：

- 统一的 `dockerSandbox()`与 image/Dockerfile source联合；
- factory上的三种 Docker access、profile、resources与 readiness；
- 只读的 `niceeval docker profile list|doctor`；
- callback-free profile schema、稳定 profile ID与语义 policy revision；
- 官方 NixOS module与通用 systemd host package；
- build前 attestation、跨进程 admission、身份与 fail-closed planning；
- 持久 watchdog主导的正常回收、Ctrl+C、SIGKILL、watchdog/daemon restart恢复；
- detached Docker操作按稳定 profile ID重连；
- NiceEval-Eval单容器 DinD与4/8路并发验收。
- raw DinD近期磁盘修复与 managed迁移的独立交付门。

本主题不包含：

- 把 rootful或 outer Docker socket暴露给评估容器；
- `niceeval docker ... -- <command>`这类任意命令代理；
- 日常 TypeScript CLI交互 sudo或修改宿主；
- 由日常开发 UID持有的临时 rootless daemon；
- 把共享 Docker Desktop VM宣称为 privileged安全 profile；
- Docker Compose outer sidecar/provider作为 DinD实现；
- 仅凭 `docker info`出现 `rootless`就信任外部 endpoint；
- rootless privileged Sandbox的 retention。
- Profile-bound DinD 的 `ArtifactSet V2` Setup Prefix cache。

## 两个独立交付门

raw DinD磁盘修复以 `raw-dind-storage/v1`为独立门。它必须证明8 GiB quota在写满时生效、两个默认
slot不会跨 Attempt复用、并发 Invocation不会超卖磁盘，并且 SIGKILL后 watchdog能完成 scrub或隔离
不确定的 allocation。该门不依赖 managed rootless迁移，也不能据此宣称共享宿主隔离。

managed迁移以 `managed-rootless/v1`为另一独立门。它必须先通过同一 storage capability的全部验收，
再证明专用 UID、user namespace、aggregate cgroup、网络隔离与 outer socket不可见。raw通过不能替代
managed门，managed尚未通过也不能阻止 raw磁盘修复交付。

v1 host package只接受 Linux、systemd和 cgroup v2。macOS、Windows、非 systemd Linux与无法证明
project quota的 filesystem在 profile加载阶段返回稳定 unsupported错误；不得回退到 raw、共享 Docker
Desktop、普通 rootful socket或无配额目录。

## 入口

- [Library](library.md) —— 统一 Docker factory、profile、resources与 readiness。
- [CLI](cli.md) —— profile只读发现、doctor与宿主部署边界。
- [Architecture](architecture.md) —— profile数据、TCB、attestation、admission、资源与身份。
- [Lifecycle](lifecycle.md) —— 部署、运行、并发、中断、SIGKILL与 restart。
- [NiceEval-Eval用例](use-case/niceeval-eval.md) —— 单容器 DinD与4/8路验收。
