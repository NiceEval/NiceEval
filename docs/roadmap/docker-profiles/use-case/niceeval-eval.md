# Use Case：NiceEval-Eval 单容器 DinD

NiceEval-Eval用 coding agent实际安装、迁移和操作 NiceEval。Agent必须能在 Sandbox内运行用户项目
的 `docker`与 `docker compose`，但 outer Sandbox不应因此变成 Compose sidecar或宿主 root。

这不是新的 DinD Sandbox类型。NiceEval-Eval使用统一的官方 `dockerSandbox()`，选择 Dockerfile
source，并声明 profile、rootless privileged、结构化资源和 readiness。

## 目录

```text
NiceEval-Eval/
  sandbox/
    Dockerfile
    niceeval-dind-entrypoint.sh
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

## 单容器

每条 Attempt只有一台 outer eval container：

```text
official Docker Sandbox provider
  -> selected managed-rootless profile
       -> privileged outer eval container
            -> root entrypoint / PID 1
            -> inner dockerd (Unix socket only)
            -> node coding agent
            -> agent-created inner containers / Compose projects
```

root entrypoint准备有界 home，启动 inner dockerd并等待 root probe。官方 Docker provider随后以
`node`运行作者声明的 `docker info` readiness；只有普通 agent用户真实能连接 inner socket才进入
Sandbox lifecycle setup。

inner socket没有离开 eval container。Agent拥有 inner root等价能力，但看不到 outer daemon、其它
Attempt、宿主 project/HOME/凭据或 rootful socket。

## Experiment共用声明

```ts
import { codexAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export const EVAL_MAX_CONCURRENCY = 4;
export const agentUnderTest = codexAgent();

export const sandbox = dockerSandbox({
  source: {
    type: "dockerfile",
    context: new URL("../sandbox/", import.meta.url),
  },
  profile: "default",
  user: "node",
  privileged: "rootless",
  resources: {
    cpus: 4,
    memoryBytes: 6 * GiB,
    pidsLimit: 2048,
    readOnlyRootfs: true,
    tmpfs: {
      "/var/lib/docker": { sizeBytes: 3 * GiB, mode: 0o711, executable: true },
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
});
```

每个 Experiment显式写 `maxConcurrency: EVAL_MAX_CONCURRENCY`。这不是把全仓并发降到1；多个
Invocation和每个 Invocation内的 Attempt都可并发，profile watchdog只在 aggregate容量不足时排队。

## 宿主与运行

NixOS宿主声明官方 module并 rebuild：

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
  storage = { size = "30G"; backing = "loop-ext4"; };
};
```

普通运行不 sudo：

```bash
pnpm exec niceeval docker profile doctor default --smoke
pnpm exec niceeval exp harness --dry
pnpm exec niceeval exp harness
```

Ubuntu/Debian的 systemd host package与 macOS专用 VM package同样登记 `default`。Experiment不按
操作系统分支，也不需要 CLI profile flag。

更换本地 profile名字、socket路径或 daemon generation不会让旧结果失去携带资格。profile的
semantic policy revision、Sandbox image digest或 per-container资源声明改变才影响 fingerprint。已有付费结果
先用 `--dry`检查携带状态；需要保留时按既有 `niceeval accept`流程重锚，不自动全量重跑。

## 验收

### 单路

- `id -u`是1000；
- Node是v24；
- `docker info`与`docker compose version`以 node成功；
- inner Alpine成功运行；
- inner Compose成功 up/down；
- outer `cpu.max` / `memory.max` / `memory.swap.max` / `pids.max`与声明一致；
- outer container cgroup是 profile aggregate path的严格后代；
- rootfs只读，所有可写路径容量可核对；
- outer socket、control socket、lease token与 host gateway在容器内均不可见；
- 结束后 outer container、inner process与 inner mount全部消失，profile daemon generation不变。

### 四路与两个 Invocation

同时启动两个独立 CLI，各自运行 task-shaped Attempt，组合包含成功、领域失败、timeout、Ctrl+C和
主动 abort。结束后：

- 两个 Invocation曾同时 active，未使用 profile独占锁；
- aggregate reservation从未越过 CPU/memory/PID/container/build上限；
- 一个 Invocation退出未删除另一个的 container；
- profile无遗留 active/provisioning NiceEval container或 reservation；
- sibling没有因单条填盘、OOM或 PID storm失效；
- cleanup p95低于 Runner看门狗边界。

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

8路不是只改一个常量。相同任务矩阵必须先通过4路参照运行，再在实际宿主证明8个 outer scope都在
aggregate cgroup内、硬资源与 headroom仍成立、跨进程 admission无超卖。宿主 module把
`maxContainers`声明为8后，Experiment才可同步上调；只改 `maxConcurrency`不能越过 profile。

### 三种官方宿主集成

- NixOS VM test从零 rebuild、reboot、doctor、nested Docker、SIGKILL recovery全通过；
- 通用 systemd Linux真实安装 host package，使用管理员提供的 bounded mount，完成同一 smoke与
  reboot recovery；
- macOS从零安装专用 VM package，验证 launchd reboot、host/guest machine identity、nested Docker、
  多 Invocation admission与 CLI SIGKILL recovery；
- 三种部署产出的 descriptor/control protocol可由同一 NiceEval core消费，下游没有专用 daemon
  shell脚本。
