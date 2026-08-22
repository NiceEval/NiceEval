# Docker 执行配置 —— Library

Eval、config 与 Experiment TypeScript 是宿主上的可信评测代码。`dockerSandbox()` 同时声明容器
起点、Sandbox能力和 Agent可用的 Docker access。Docker access分成显式 socket mount、raw
privileged DinD和 managed rootless DinD；三种模式不能互相回退。

## 一个单容器 factory

image 与 Dockerfile只决定起始镜像如何取得。两者创建、启动、命令执行、资源限制、readiness与
Provider finalizer完全相同，因此共用一个 factory：

```ts
interface DockerImageSource {
  readonly type: "image";
  readonly image: string;
}

interface DockerfileSource {
  readonly type: "dockerfile";
  readonly context: string | URL;
  readonly file?: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly target?: string;
}

type DockerSandboxSource = DockerImageSource | DockerfileSource;

interface DockerSandboxTmpfsOptions {
  readonly sizeBytes: number;
  readonly mode?: number;
  readonly uid?: number;
  readonly gid?: number;
  /** 默认 false；inner image/layer 或 workspace 工具需要执行时显式打开。 */
  readonly executable?: boolean;
}

interface DockerSandboxResources {
  readonly cpus?: number;
  readonly memoryBytes?: number;
  readonly pidsLimit?: number;
  /** inner dockerd 的 /var/lib/docker 可实际写入的硬上限。 */
  readonly dockerDataBytes?: number;
  readonly readOnlyRootfs?: boolean;
  readonly tmpfs?: Readonly<Record<string, DockerSandboxTmpfsOptions>>;
}

interface ProfiledDockerResources extends DockerSandboxResources {
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly pidsLimit: number;
  readonly dockerDataBytes: number;
  readonly readOnlyRootfs: true;
}

interface DockerSandboxReadiness {
  readonly command: readonly [string, ...string[]];
  readonly user?: string;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
}

interface DockerSandboxCommonOptions {
  readonly source: DockerSandboxSource;
  readonly user?: string;
  readonly readiness?: DockerSandboxReadiness;
  readonly lifetimeMs?: number;
  readonly pathPrepend?: readonly string[];
}

type DockerSandboxAccess =
  | {
      readonly mode: "socket";
      /** 宿主上的显式 Unix socket；容器内固定挂到 /var/run/docker.sock。 */
      readonly socketPath: string;
    }
  | {
      readonly mode: "dind";
      readonly isolation: "raw-privileged";
      /** 只证明磁盘配额、跨进程准入与强杀恢复，不声明宿主隔离。 */
      readonly storageProfile: string;
    }
  | {
      readonly mode: "dind";
      readonly isolation: "managed-rootless";
      readonly profile: string;
    };

type DockerSandboxOptions =
  | (DockerSandboxCommonOptions & {
      readonly dockerAccess?: undefined;
      readonly resources?: DockerSandboxResources;
    })
  | (DockerSandboxCommonOptions & {
      readonly dockerAccess: { readonly mode: "socket"; readonly socketPath: string };
      readonly resources?: DockerSandboxResources;
    })
  | (DockerSandboxCommonOptions & {
      readonly dockerAccess: {
        readonly mode: "dind";
        readonly isolation: "raw-privileged";
        readonly storageProfile: string;
      };
      readonly resources: ProfiledDockerResources;
    })
  | (DockerSandboxCommonOptions & {
      readonly dockerAccess: {
        readonly mode: "dind";
        readonly isolation: "managed-rootless";
        readonly profile: string;
      };
      readonly resources: ProfiledDockerResources;
    });

declare function dockerSandbox(options: DockerSandboxOptions): SandboxLayer;
```

`source` 是穷尽联合：调用只能选择 image或 Dockerfile，不能同时提供，也不能都缺。Compose仍用
`dockerComposeSandbox()`，因为它拥有多台容器、network与 volume，不是一台主容器的另一种 source。

`dockerAccess`省略时是普通 Docker Sandbox：不挂 socket，也不请求 privileged。三种 access的
职责和适用场景如下：

| 模式 | NiceEval负责 | 镜像负责 | 适用场景 | 权限边界 |
| --- | --- | --- | --- | --- |
| `socket` | 校验并 bind显式 Unix socket、补充 socket GID、检查默认 endpoint并执行 readiness | Docker CLI | 可信 Agent、个人开发机、已有 daemon且优先启动速度 | Agent拥有该 daemon的完整控制权；rootful socket通常等价宿主 root |
| `dind/raw-privileged` | 通过 storage profile取得私有 Docker data allocation、磁盘准入与强杀恢复，再启动受管 supervisor和 daemon | 官方 dind兼容派生镜像、Docker CLI/daemon、Agent用户加入 `docker`组 | 一次性 VM或专用 runner，需要先消除 inner Docker填盘风险 | outer privileged继承所选 daemon/宿主的风险；只承诺 `raw-dind-storage/v1`，不承诺 rootless或共享宿主隔离 |
| `dind/managed-rootless` | profile attestation、rootless privileged、资源准入、独占网络、watchdog恢复、受管 supervisor和 readiness | 官方 dind兼容派生镜像、Docker CLI/daemon、Agent用户加入 `docker`组 | 不可信 Agent、共享 Linux宿主、并发评估和强杀恢复 | privileged限制在受管 rootless user namespace内；仍不是 kernel或 VM逃逸防护 |

socket模式必须显式写宿主绝对路径，不从 NiceEval进程变量、Docker context或 Provider当前 endpoint推断路径。
NiceEval对路径执行 `realpath`，要求最终目标是 Unix socket，并把规范路径 bind到容器内固定的
`/var/run/docker.sock`。它读取 socket GID并用 Docker `GroupAdd`授予 Sandbox默认用户访问权；路径
不可读、目标不是 socket、补充组无法生效或默认用户仍无法执行 `docker info`时，Sandbox创建失败。

Agent启动前还会拒绝镜像预设的 endpoint/context，并确认默认 `docker info`与显式 Unix socket访问的是
同一 daemon。这是启动兼容性检查，不阻止 Agent随后显式选择其它 endpoint；安全边界由宿主与 managed
网络策略提供。

symlink只作为可信宿主配置的便捷入口，最终 bind的是求值时得到的规范目标；NiceEval不承诺防御
可信宿主在检查与 create之间替换该路径。

raw DinD的危险授权由必填字面量 `isolation: "raw-privileged"`表达，并且必须声明
`storageProfile`。该 profile只授予 `raw-dind-storage/v1`：每 Attempt磁盘配额、跨进程准入和强杀恢复。
它不把 raw privileged提升为 rootless，也不承诺同一共享宿主上的 sibling隔离。

managed DinD的 `profile`包含同一 storage capability，并额外证明 rootless、网络、cgroup和宿主边界。
两个分支都必须显式提供 CPU、memory、PID、`dockerDataBytes`和 `readOnlyRootfs: true`。profile缺失、
attestation失败或容量不足都 fail closed；managed绝不降级成 raw privileged。

三种 Docker access默认在 Sandbox默认用户下执行 `docker info`。`readiness`可以替换命令、用户和
超时，但不能关闭探活。NiceEval不向任意镜像安装 Docker组件；CLI、inner daemon和 entrypoint由
镜像提供，NiceEval官方指南提供完整配方。

## 非法组合与迁移

| 调用 | 结果或迁移 |
| --- | --- |
| `dockerAccess: { mode: "socket" }` | 配置期失败；`socketPath`必填 |
| socket的 `socketPath`不是绝对规范路径 | 配置期失败 |
| socket与 profile/privileged字段并存 | 配置期失败；三分支没有隐式组合 |
| `dockerAccess: { mode: "dind" }` | 配置期失败；`isolation`没有默认值 |
| `raw-privileged`缺 `storageProfile`或 `dockerDataBytes` | 在任何 Docker I/O前失败 |
| `managed-rootless`缺 profile或完整 resources | 在任何 Docker I/O前失败 |
| managed profile找不到或 attestation失败 | fail closed，不尝试 raw privileged |
| 旧 `profile + privileged: "rootless"` | 迁移到 `dockerAccess: { mode: "dind", isolation: "managed-rootless", profile }` |
| 需要旧式直接 privileged DinD | 显式改为 `dockerAccess: { mode: "dind", isolation: "raw-privileged" }` |

## DinD 声明

```ts
import { defineEval } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export default defineEval({
  description: "Agent can operate a Docker Compose project",
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
      intervalMs: 250,
    },
  }),
  async test(t) {
    await t.send("Use Docker Compose to start the project and fix its failing health check.");
  },
});
```

`dockerSandbox()`负责在 profile选择的外层 daemon上创建 privileged容器，替换原
Entrypoint/Cmd，注入 provider-owned supervisor，并用 `readiness`确认普通 Agent用户可以访问内层 Docker。

Dockerfile只需从官方 dind镜像派生、安装 Node与 Agent工具，并把 Agent用户
加入 `docker`组；不需要 NiceEval专用 entrypoint。完整的 Dockerfile和 Experiment写法见
[NiceEval-Eval单容器 DinD](use-case/niceeval-eval.md)。

Docker `start` 只表示 PID 1已运行，不表示 supervisor启动的 inner dockerd已 ready。NiceEval在任何
Sandbox lifecycle setup、prepare、agent ensure或 Attempt命令前重试 readiness command。容器提前
退出或超时归入 `sandbox.create`，随后执行整台容器的 Provider finalizer。

## 输入规范化

所有数值必须是正有限值；字节与 PID必须是 safe integer。tmpfs key必须是规范化绝对路径，不能
是 `/`，路径按字典序冻结。`mode`是 `0..0o7777`整数，uid/gid是非负 safe integer。

默认值遵循 absent等价：

- 省略 `dockerAccess` = 不把任何 Docker控制面交给 Agent；
- socket、raw DinD与 managed DinD三种分支必须显式选择；
- 不带 profile的分支省略 `resources` 与空对象相同；
- `readOnlyRootfs: false` 与省略相同；
- 省略 `executable` = `false`；
- 省略 `intervalMs` = 250 ms。

`memoryBytes`同时映射到 Docker memory与 memory+swap，总 swap额外量为0。`tmpfs`始终带
`nosuid,nodev`，并按 `executable`选择 `exec`或 `noexec`。tmpfs实际占用计入容器 memory cgroup；
各路径 `sizeBytes`之和不是额外内存。

`/var/lib/docker`不能出现在 `tmpfs`。provider把 storage profile租出的私有、disk-backed Docker data allocation以
固定 `rprivate` bind挂到该路径。这笔 allocation的 project quota hard limit等于 `dockerDataBytes`，因此写入量受磁盘
配额约束，不会挤占容器 memory cgroup。source路径、allocation ID和 lease token均不进入容器。

`readOnlyRootfs: true`与声明的 tmpfs限制其它可写路径。缺少必要写路径会在 readiness/setup报告配置
错误，不能自动回退到可写 rootfs。`dockerDataBytes`进入 template identity和 Attempt fingerprint；
storage profile别名、allocation ID与宿主路径不进入可分享 identity。

## 身份

以下静态声明进入 template identity：

- 完整 `source`；
- Docker access模式；
- 完整规范化后的 `resources`；
- readiness command与 user。

readiness timeout/interval是生命周期预算，不改变已完成 Attempt的语义，因此不使旧结果失去携带
资格。physical planning得到的 profile semantic policy revision、target platform、Docker access与
resources进入 ProviderPlan、CaseKey和 Attempt fingerprint。policy revision包含会改变 Agent可见
行为或隔离语义的规则，例如 network、privilege translation、cgroup enforcement与可写路径政策。

以下本机选择和运行事实不进入可分享 identity：

- `profile`字面别名和 stable profile ID；
- socket/control endpoint、OS UID、unit与 data-root绝对路径；
- daemon ID、daemon generation与 cache内容；
- aggregate总容量、当前占用和 admission排队顺序。

daemon ID与 generation仍用于本次 Invocation的私有审计和连接一致性检查。它们不进入 fingerprint，
不代表一次 Invocation可以静默切换 daemon。

## 能力与执行身份

带 managed rootless DinD的 provider capability恒为 `DestroyOnly`。它不能与
`--keep-sandbox`组合，也不能跨 Invocation retention。Invocation内普通复用仍须遵守既有
reset/lifetime契约，不由 privileged自动开启。

容器 entrypoint/PID 1可以是 root，用来启动 inner dockerd、收紧 socket mode并等待 ready。
NiceEval受管命令和 coding agent使用 `user`，例如 `node`。能访问 inner socket的用户在该评估
容器内拥有 root等价能力；普通用户身份用于工具兼容，不是容器内安全边界。

outer profile socket、control endpoint与 lease token不以 mount、子进程变量或文件形式进入评估
容器。默认 Docker CLI必须访问 inner Unix socket；NiceEval不为此注入 endpoint变量。Agent仍可显式
选择其它 endpoint，managed模式依靠网络策略限制其可达范围。

## 观测

`managed-rootless/v1` policy阻断 host loopback，outer eval container不注入
`host.docker.internal`，`Sandbox.otlpHost`为 `null`。OTLP不能成为隐式 host gateway。

受控 OTLP proxy若被纳入 profile，必须成为可 attest的语义 capability，并进入 semantic policy
revision。
