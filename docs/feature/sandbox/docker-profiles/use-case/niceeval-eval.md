# Use Case：NiceEval-Eval 单容器 DinD

NiceEval-Eval用 coding agent实际安装、迁移和操作 NiceEval。Agent必须能在 Sandbox内运行用户项目
的 `docker`与 `docker compose`，但 outer Sandbox不应因此变成 Compose sidecar或宿主 root。

这不是新的 DinD Sandbox类型。NiceEval-Eval使用统一的官方 `dockerSandbox()`，选择 Dockerfile
source，并声明 managed rootless DinD、结构化资源和 readiness。

## 目录

```text
NiceEval-Eval/
  sandbox/
    Dockerfile
  experiments/
    shared.ts
    install/*.ts
    advance/*.ts
    experiment/*.ts
    harness/*.ts
```

`sandbox/Dockerfile`是唯一运行镜像，固定 base digest，包含 Node 24、Python、coding-agent CLI、
Docker CLI/daemon与 Compose plugin。每个 Eval仍是完整 folder-local题包；不会为 DinD增加 outer
`docker-compose.yaml`，也不会增加启动宿主 daemon的下游 shell wrapper。

## DinD镜像

下面用浮动 tag保持示例可读；真实评估仓库必须把 `FROM`钉到审核过的 digest：

```dockerfile
FROM docker:29-dind

RUN apk add --no-cache ca-certificates git nodejs npm python3 \
  && addgroup -g 1000 node \
  && adduser -D -u 1000 -G node node \
  && addgroup node docker
```

项目不提供 NiceEval专用 `ENTRYPOINT`。`dockerAccess.mode: "dind"`让 provider替换镜像原有
Entrypoint/Cmd，并检查官方 dind工具面。

provider用 `docker-init` 与受管 Node supervisor同时启动 dockerd 和 Sandbox keeper。
dockerd 只监听 `unix:///var/run/docker.sock`，并使用 2 秒关闭时限。
启动协议、日志、TTL、错误诊断和版本都归 NiceEval，不要求下游脚本 `exec "$@"`。

这里的 inner daemon只监听容器内的 Unix socket；不要给它增加 TCP listener，也不要把 outer或宿主
socket mount进来。

## 单容器

每条 Attempt只有一台 outer eval container：

```text
official Docker Sandbox provider
  -> selected managed-rootless profile
       -> privileged outer eval container
            -> docker-init PID 1 + provider supervisor
            -> inner dockerd (Unix socket only)
            -> node coding agent
            -> agent-created inner containers / Compose projects
```

provider bootstrap准备日志与 keeper，启动 inner dockerd。官方 Docker provider随后以
`node`运行作者声明的 `docker info` readiness；只有普通 agent用户真实能连接 inner socket才进入
physical before。

inner socket没有离开 eval container。Agent拥有 inner root等价能力，但看不到 outer daemon、其它
Attempt、宿主 project/HOME/凭据或 rootful socket。

## Experiment声明

```ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.4",
  maxConcurrency: 4,
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../sandbox/", import.meta.url),
    },
    dockerAccess: {
      mode: "dind",
      isolation: "managed-rootless",
      profile: "default",
    },
    user: "node",
    resources: {
      cpus: 4,
      memoryBytes: 6 * GiB,
      pidsLimit: 2048,
      dockerDataBytes: 8 * GiB,
      readOnlyRootfs: true,
      tmpfs: {
        "/home/sandbox/workspace": {
          sizeBytes: 2 * GiB,
          mode: 0o755,
          uid: 1000,
          gid: 1000,
          executable: true,
        },
        "/home/node": { sizeBytes: 512 * MiB, mode: 0o700, uid: 1000, gid: 1000 },
        "/tmp": { sizeBytes: 1024 * MiB, mode: 0o1777 },
        "/run": { sizeBytes: 128 * MiB, mode: 0o755 },
      },
    },
    readiness: {
      command: ["docker", "info"],
      user: "node",
      timeoutMs: 30_000,
    },
  }),
});
```

`sandbox`由 Experiment直接持有，并应用到该 Experiment选择的 Eval；它不是一段脱离
`defineExperiment()`的独立配置。每个 Experiment显式写 `maxConcurrency: 4`。这不是把全仓并发降到1；多个
Invocation和每个 Invocation内的 Attempt都可并发，profile watchdog只在 aggregate容量不足时排队。

## 宿主与运行

NixOS宿主声明官方 module并 rebuild：

```nix
services.niceeval.dockerProfiles.default = {
  enable = true;
  accessUsers = [ "ctrdh" ];
  capacity = {
    cpus = 16;
    memory = "28G";
    pids = 8192;
    maxContainers = 2;
    maxBuilds = 2;
  };
  aggregate = { cpus = 20; memory = "32G"; pids = 12288; };
  storage = { size = "32G"; slotSize = "8G"; backing = "loop-ext4"; };
};
```

普通运行不 sudo：

```bash
pnpm exec niceeval docker profile doctor default
pnpm exec niceeval exp harness --dry
pnpm exec niceeval exp harness
```

Ubuntu/Debian的 systemd host package同样登记 `default`。Experiment不按 Linux发行版分支，也不需要
CLI profile flag；其它平台在 profile加载阶段 fail closed。

更换本地 profile名字、socket路径或 daemon generation不会让旧结果失去携带资格。profile的
semantic policy revision、Sandbox image digest或 per-container资源声明改变才影响 fingerprint。已有付费结果
先用 `--dry`检查携带状态；需要保留时按既有 `niceeval accept @<完整 locator>` 流程重锚，不自动全量重跑。

## 验收

本页定义 NiceEval-Eval应承接的真实 Docker E2E契约，不表示相邻仓库当前具备或跑过这些场景。
在下游补齐并给出通过证据前，本仓删除子进程变量门控的本机 Docker测试所留下的真实协作缺口仍然存在。

### Docker access矩阵

- socket：显式挂入可信 Unix socket，普通用户可运行 child container；镜像预设 endpoint/context时在
  Agent启动前失败；
- raw DinD：官方 dind兼容派生镜像能 build/run child container，2375/2376无 listener，停止/恢复后
  inner daemon可用，daemon退出时 outer container非零退出；
- managed DinD：完成 profile attestation、资源准入、sibling隔离、nested Docker与 watchdog回收，
  attestation失败不得降级到 raw或 socket；
- Compose：Agent在 inner daemon内执行 `docker compose up`、访问服务并 `down`，成功、失败、timeout与
  中断后都没有遗留 container、network、volume或 reservation。

### 单路

- `id -u`是1000；
- Node是v24；
- `docker info`与`docker compose version`以 node成功；
- inner Alpine成功运行；
- inner Compose成功 up/down；
- outer `cpu.max` / `memory.max` / `memory.swap.max` / `pids.max`与声明一致；
- outer container cgroup是 profile aggregate path的严格后代；
- rootfs只读，`/var/lib/docker`来自8 GiB project-quota Docker data allocation，其它可写路径容量可核对；
- outer socket、control socket、lease token与 host gateway在容器内均不可见；
- 每个 Attempt 使用独占 user-defined outer bridge；TCP、UDP、ICMP 与私网扫描均不能到达 sibling，
  也不能到达宿主 loopback/control endpoint，但公网 DNS/HTTPS 与 inner Compose 必须可用；
- 结束后 outer container、inner process与 inner mount全部消失，profile daemon generation不变。

### 四路与两个 Invocation

同时启动两个独立 CLI，各自运行 task-shaped Attempt，组合包含成功、领域失败、timeout、Ctrl+C和
主动 abort。结束后：

- 两个 Invocation曾同时 active，未使用 profile独占锁；
- aggregate reservation从未越过 CPU/memory/PID/container/build上限；
- 一个 Invocation退出未删除另一个的 container；
- profile无遗留 active/provisioning NiceEval container或 reservation；
- sibling没有因单条填满 Docker data allocation、OOM或 PID storm失效；
- cleanup p95低于 Runner看门狗边界。
- 四个 outer container有至少120秒共同活动区间；每一路在该区间内都必须有真实 coding agent、已
  build/run/healthy的 inner Compose和持续增长的 CPU activity。排队、sleep、readiness或只创建容器
  不算 active。

### SIGKILL

在四路运行中 SIGKILL其中一个 CLI，不启动第二次 doctor/exp来触发资源回收。持久 watchdog必须自行
发现 lost lease、排除另一 Invocation与 kept registry、按 journal + labels删除 orphan并释放准确
reservation。另一个 Invocation继续运行，installed daemon/data mount保持在线且 generation不变。

另一路在 Dockerfile build进行中 SIGKILL CLI。watchdog必须取消对应 BuildKit session；build slot在
daemon请求、session和 process/cgroup活动全部终止前保持占用，不能让后续 build造成 `maxBuilds`
超卖。

随后运行 doctor只是核对恢复事实，不承担恢复动作。

### Watchdog 与 daemon restart

- SIGKILL watchdog后由 systemd重启，从 durable journal重建且不误删 active sibling；
- restart outer daemon时所有现有 Invocation停止派发并报告 environment incomplete，不自动重跑已
  付费 Attempt；
- recovery收敛后新 Invocation可用，daemon ID变化只作为审计事实。

### 八路

8路不是只改一个常量。默认32 GiB storage profile只准入2笔8 GiB Docker data allocation。4路 profile至少提供
64 GiB硬容量，8路 profile至少提供128 GiB硬容量；不得用稀疏文件的逻辑大小重复承诺同一批物理块。

相同任务矩阵必须先通过4路参照运行，再在实际宿主证明8个 outer scope都在
aggregate cgroup内、硬资源与 headroom仍成立、跨进程 admission无超卖。宿主 module把
`maxContainers`声明为8后，Experiment才可同步上调；只改 `maxConcurrency`不能越过 profile。
八路 allocatable 至少是32 CPU、48 GiB memory与16384 PID；aggregate硬上限至少是40 CPU、
64 GiB memory与20480 PID。八路也必须满足同一个不少于120秒的真实共同活动区间。

### 两种官方 Linux宿主集成

- NixOS VM test从零 rebuild、reboot、doctor、nested Docker、SIGKILL recovery全通过；
- 通用 systemd Linux真实安装 host package，使用管理员提供的 bounded mount，完成同一 smoke与
  reboot recovery；
- 两种部署产出的 descriptor/control protocol可由同一 NiceEval core消费，下游没有专用 daemon
  shell脚本。
