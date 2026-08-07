# Docker 执行配置（Docker Profile）

Coding agent经常需要在 Sandbox里运行 `docker build`、`docker run`与 `docker compose`。把宿主
`/var/run/docker.sock`挂进评估容器，会让不受信任的 Agent取得宿主 root等价能力。把评估容器
直接交给宿主 rootful daemon并开启 privileged，同样没有可接受的隔离边界。

本主题扩展 NiceEval内建的 `dockerSandbox()`。评测代码在 factory中声明起始镜像、managed
rootless DinD、单容器资源与 readiness。profile后端可以是本机 rootless daemon、专用宿主
或 VM，但它不是新的 Sandbox provider，也不是 DinD专用抽象。

首个本地 Linux后端由专用 OS UID持有 rootless Docker daemon。macOS后端使用专用 Linux VM，
不把共享 Docker Desktop VM当作 privileged隔离边界。Agent、inner dockerd与 inner Compose都在
同一个 outer eval container里，outer socket永远不进入该容器。

## 核心心智

```text
宿主部署者一次配置
  -> NixOS module、systemd host package 或 macOS VM package
  -> rootless Docker + 有硬容量的 data filesystem
  -> aggregate cgroup + 持久 watchdog/admission service
  -> root-owned、纯数据的 profile descriptor
  -> 本机别名 default

可信评测代码
  dockerSandbox({
    source: {...},
    dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "default" }
  })
  -> NiceEval加载声明
  -> 在任何 Docker I/O、build与模型调用前 attest profile
  -> discovery、physical planning、build、run全程使用同一 daemon

每条 Attempt
  -> 原子取得 CPU/memory/PID/container reservation
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
- inner daemon readiness。

managed分支不会接受含糊的 `privileged: true`。需要 raw privileged DinD时必须显式写
`isolation: "raw-privileged"`。`dockerComposeSandbox()`不接受这组单容器字段；这里的
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

官方 NixOS module、通用 systemd host package或 macOS VM package负责专用 UID、subid、delegation、
socket ACL、有界 filesystem、aggregate cgroup、daemon与 watchdog。日常 `niceeval exp`和
`niceeval docker profile doctor`从不 sudo、不修改 `/etc`、不 mount loop device，也不安装 daemon。

有硬容量的 filesystem是宿主契约。loop-backed ext4只是 Linux部署包可选的兑现方式，不是跨平台
公开 API。

## Profile选择

managed DinD中的 `profile: "default"`是宿主本地别名。NixOS、Ubuntu和 macOS可以各自把合适
后端登记成 `default`，所以同一份 Experiment不需要按操作系统分支。别名不是结果 identity；实际
profile的 semantic policy revision才表示执行语义。

普通 `dockerSandbox()`可以省略 `dockerAccess`，此时Agent拿不到任何 Docker socket。socket模式与
raw privileged DinD不使用 profile；managed rootless DinD必须声明 profile。managed Sandbox必须给出完整 CPU、memory、
PID、只读 rootfs和显式可写 tmpfs。profile不存在、无法 attest或安全级别不符，均在 Docker build
与模型调用前失败，不能回退到宿主 rootful socket。

## 安全保证

Linux managed profile的 Docker API权限落在专用 host UID的 user namespace中，不等于宿主 root。
macOS managed profile把同一边界放在专用 Linux VM内。宿主服务不接收评测 repo、HOME、凭据、
rootful Docker socket、host PID或 host network bind；评估容器拿不到 outer socket。

拥有 profile socket ACL的宿主用户属于可信运行者。若要防御 Linux kernel、rootlesskit、runc或
dockerd逃逸，应使用专用 VM或远端 profile；本功能不把本机容器边界描述成 VM边界。

## 资源与并发

资源有三层：

| 层 | owner | 约束 |
|---|---|---|
| Profile aggregate | 宿主 cgroup + 有界 filesystem | 总 CPU、memory、swap、PID、磁盘与 daemon/build headroom |
| 跨进程 admission | 持久 watchdog | 多个 Invocation的 reservation总和、同时 build与 container数 |
| 单个 eval container | outer rootless daemon | CPU、memory、0 extra swap、PID、只读 rootfs、有界 tmpfs |

同一 profile可以同时服务多个 `niceeval exp`。每条 Attempt在 create前向 watchdog原子申请资源
向量；所有进程的已授予向量之和不得超过 aggregate可分配量。Experiment `maxConcurrency`限制本
Invocation，profile admission再限制所有 Invocation的总资源。4路和实测通过后的8路无需独占整个
profile。

## 范围

本主题包含：

- 统一的 `dockerSandbox()`与 image/Dockerfile source联合；
- factory上的三种 Docker access、profile、resources与 readiness；
- 只读的 `niceeval docker profile list|doctor`；
- callback-free profile schema、稳定 profile ID与语义 policy revision；
- 官方 NixOS module、通用 systemd host package与 macOS专用 VM package；
- build前 attestation、跨进程 admission、身份与 fail-closed planning；
- 持久 watchdog主导的正常回收、Ctrl+C、SIGKILL、watchdog/daemon restart恢复；
- detached Docker操作按稳定 profile ID重连；
- NiceEval-Eval单容器 DinD与4/8路并发验收。

本主题不包含：

- 把 rootful或 outer Docker socket暴露给评估容器；
- `niceeval docker ... -- <command>`这类任意命令代理；
- 日常 TypeScript CLI交互 sudo或修改宿主；
- 由日常开发 UID持有的临时 rootless daemon；
- 把共享 Docker Desktop VM宣称为 privileged安全 profile；
- Docker Compose outer sidecar/provider作为 DinD实现；
- 仅凭 `docker info`出现 `rootless`就信任外部 endpoint；
- rootless privileged Sandbox的 retention。

## 入口

- [Library](library.md) —— 统一 Docker factory、profile、resources与 readiness。
- [CLI](cli.md) —— profile只读发现、doctor与宿主部署边界。
- [Architecture](architecture.md) —— profile数据、TCB、attestation、admission、资源与身份。
- [Lifecycle](lifecycle.md) —— 部署、运行、并发、中断、SIGKILL与 restart。
- [NiceEval-Eval用例](use-case/niceeval-eval.md) —— 单容器 DinD与4/8路验收。
