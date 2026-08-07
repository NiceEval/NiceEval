# Docker 执行配置 —— CLI

运行命令从 `dockerSandbox({ profile })`取得 profile别名。CLI不要求额外 flag；它只提供 profile的
只读发现与 doctor。宿主部署由 NixOS module、systemd host package或 macOS VM package完成。

## 运行

```bash
niceeval check harness
niceeval exp harness --dry
niceeval exp harness
```

CLI先加载可信 Eval、config与 Experiment TypeScript，再收集所有选中 Docker factory声明。在任何
Docker discovery、pull、build、create或模型调用前，NiceEval对每个被引用的 profile执行：

1. 从受信 profile registry按别名查找唯一 descriptor；
2. 验证 descriptor的 owner、mode与纯数据 schema；
3. 连接 control endpoint并完成 profile attestation；
4. 为该 profile创建带随机 UUID的 Invocation lease；
5. 把 Docker endpoint、stable profile ID与 policy revision绑定到对应 ProviderPlan。

discovery、link与用户选题在 profile查找前完成，而且不发起 Provider I/O。未选中的 Experiment即使
声明了当前机器不存在的 profile也不报错；只有实际选中 pair引用的别名参加 attestation与 lease。

一次 Invocation可以使用多个 profile。每个 Docker Sandbox始终路由到自己声明的 profile，build与
create不能跨 profile复用连接。`DOCKER_HOST`、Experiment env与 Agent env不能替换已绑定 endpoint。

未声明 profile时：

- 非 privileged Docker继续使用既有 Docker endpoint查找规则；
- `privileged: "rootless"`在 factory求值阶段报 `sandbox.docker-profile-required`；
- 禁止回退 `/var/run/docker.sock`、rootful daemon、TCP endpoint或日常 UID的 rootless daemon。

声明 profile的普通或 rootless privileged分支都必须提供完整 CPU、memory、PID与只读 rootfs。
缺少任一字段在连接 daemon前报 `sandbox.docker-profile-resources-required`，不能以零值或无界值进入
admission。

macOS、Windows或非 systemd主机不能因 `docker info`显示 `rootless`就自动满足能力。rootless
privileged必须引用已经登记、且支持完整 attestation/control protocol的 profile。

## Profile发现

```bash
niceeval docker profile list
niceeval docker profile list --json
```

`list`只读系统 registry，不导入项目、不执行 profile callback，也不探测默认 Docker。human输出
显示本地别名、稳定 ID缩写、security level、policy revision、endpoint kind与健康摘要；JSON输出
稳定 schema。

别名可以随机器不同，也可以改名。stable profile ID来自宿主部署，让 detached operation找回原
endpoint。以下任一情形会把条目标为 invalid并禁止使用：

- 两个 descriptor宣称同一 stable ID；
- 一个别名映射多个 ID；
- descriptor是 symlink；
- owner/mode不合格；
- alias selector不唯一。

## Doctor

```bash
niceeval docker profile doctor default
niceeval docker profile doctor default --smoke
niceeval docker profile doctor default --json
```

默认 doctor只读检查：

- descriptor是 root-owned callback-free data，父目录不能由运行 access group写入；
- Docker endpoint与 control endpoint的类型、socket inode、目录权限和宿主 peer UID；
- 本机 daemon由专用 UID持有，且 invoking UID不同；VM evidence证明 VM内部的 backend owner；
- daemon security options含 rootless，且无 TCP listener、host socket或 host loopback开放；
- daemon ID、generation、DockerRootDir与 runtime attestation一致；
- cgroup v2 controllers、systemd driver、aggregate properties与 policy revision一致；
- daemon、buildkit、containerd/shim和 probe container的 cgroup path都是 aggregate path的后代；
- data-root的 filesystem identity与硬容量证明匹配；
- watchdog protocol、durable journal、active Invocation/reservation与 orphan状态一致。

VM profile由 control service返回同一组 remote evidence，并用宿主 package建立的 machine identity核验。
本机 CLI不能直接读取 VM中的 `/proc`，但 smoke仍须从 probe container读取真实 cgroup文件，并由
control service证明它们属于 VM aggregate subtree。

`--smoke`创建短命 rootless privileged probe，设置2 CPU、512 MiB、0 extra swap、256 PID、只读
rootfs与64 MiB tmpfs，并从容器读取：

```text
cpu.max
memory.max
memory.swap.max
pids.max
```

四项必须与请求一致，probe cgroup必须处于 aggregate subtree。probe随后运行最小 nested Alpine，
再验证 outer container、inner process、mount、label与 reservation全部消失。Docker inspect中的
HostConfig不是限额生效证据。

doctor输出逐项 PASS/FAIL，任一安全项失败退出1。它不改配置、不删除 orphan、不重启 daemon；
修复操作属于对应宿主 package。

## 不提供任意命令代理

不存在以下入口：

```text
niceeval docker --profile default -- <command>
niceeval docker profile exec default <command>
```

这类接口会把 outer Docker权限交给任意项目命令，绕过 provider labels、admission与回收协议。
NiceEval只在受管 build/create/inspect/remove和既有 detached sandbox operation内使用 endpoint。

## Detached sandbox命令

`niceeval sandbox list|enter|stop|prune`不猜测当前默认 profile。任何经 profile创建并写入资源
registry的 Docker资源都保存 stable profile ID；后续命令按该 ID查找当前 descriptor并重新
attestation。profile改名或 socket迁移后仍能找回；profile缺失或 ID不匹配则拒绝操作，绝不回退
默认 daemon。

rootless privileged provider是 `DestroyOnly`，不会产生 kept entry；SIGKILL orphan仍通过 stable
profile ID与 watchdog journal路由。允许 retention的其它 Docker profile也沿用这条契约。

## 宿主部署

### NixOS

NiceEval发布的 NixOS module提供声明式入口：

```nix
services.niceeval.dockerProfiles.default = {
  enable = true;
  accessUsers = [ "ctrdh" ];
  capacity = {
    cpus = 14;
    memory = "28G";
    pids = 9216;
    maxContainers = 8;
    maxBuilds = 2;
  };
  storage = {
    size = "30G";
    backing = "loop-ext4";
  };
};
```

module原子产生 dedicated account/subids、systemd units、bounded filesystem、root-owned descriptor、
socket ACL与开机 recovery。改变声明由 NixOS rebuild处理，不经过 `niceeval exp`。

### Ubuntu、Debian与其它 systemd Linux

官方 `niceeval-docker-profile-host`系统包提供 versioned descriptor schema、systemd unit templates与
tmpfiles/sysusers配置。它还提供 watchdog/admission service、host-side doctor与部署/移除事务。
管理员在系统包层显式提供 dedicated UID/subids、access group与一个可证明有硬容量的 mount。

host package拒绝普通根分区子目录和只靠容量告警的配置。它可以使用 loop-backed ext4，也可以接收
管理员预建的 LVM、ZFS或独立 filesystem。具体 backing不进入 Docker factory。

### macOS

官方 macOS package创建专用 Linux VM，在 VM内部署与 Linux相同的 rootless daemon、aggregate
cgroup和 watchdog，再把受认证的 Docker/control Unix endpoint提供给宿主。package把该后端登记为
`default`，由 launchd管理 VM生命周期与开机恢复。

共享 Docker Desktop仍可服务省略 profile的普通非 privileged Docker Sandbox。它不能满足
`privileged: "rootless"`，因为 privileged workload可以控制 Docker Desktop VM中的 sibling与
daemon，无法兑现 profile的隔离和 watchdog所有权。

### External profile

专用远端 Linux host或 VM可以发布相同的 descriptor与 versioned control protocol。它必须显式登记
别名，不能靠当前 Docker context自动升级为安全 profile。NiceEval只接受内置 security level能完整
核验的事实，不运行第三方验证 callback。

## 运行反馈

human plan按实际用到的每个 profile显示一段摘要：

```text
DOCKER PROFILE  default · managed-rootless/v1 · policy 8f31c0d2
  aggregate 14 CPU · 28 GiB memory · 0 swap · 9216 PID · 30 GiB disk · max 8
  this invocation up to 4 containers · 4 CPU / 6 GiB / 2048 PID each
  shared admission 3 active invocations · 6/8 containers reserved
```

可发布 JSON只包含 security level、semantic policy revision、aggregate公开容量、单容器请求与有效
本地并发。socket、data path、daemon ID、UID、unit、lease token与其它 Invocation命令行不写入
Record。

profile错误发生在 Docker discovery/build与模型成本之前。错误至少包含稳定 code、失败事实、
factory声明位置、profile别名与下一条 `niceeval docker profile doctor <name>`。不能延迟成普通
Docker create 500或 permission denied。
