# Docker 执行配置 —— Library

Eval、config 与 Experiment TypeScript 是宿主上的可信评测代码。`dockerSandbox()` 同时声明容器
起点、Sandbox能力和宿主 profile别名，但不接收 Docker socket路径。不同机器可以把同一别名映射
到不同的受验证后端。

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
  readonly readOnlyRootfs?: boolean;
  readonly tmpfs?: Readonly<Record<string, DockerSandboxTmpfsOptions>>;
}

interface ManagedDockerResources extends DockerSandboxResources {
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly pidsLimit: number;
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

type DockerSandboxOptions =
  | (DockerSandboxCommonOptions & {
      readonly profile?: undefined;
      readonly privileged?: undefined;
      readonly resources?: DockerSandboxResources;
    })
  | (DockerSandboxCommonOptions & {
      readonly profile: string;
      readonly privileged?: "rootless";
      readonly resources: ManagedDockerResources;
    });

declare function dockerSandbox(options: DockerSandboxOptions): SandboxLayer;
```

`source` 是穷尽联合：调用只能选择 image或 Dockerfile，不能同时提供，也不能都缺。Compose仍用
`dockerComposeSandbox()`，因为它拥有多台容器、network与 volume，不是一台主容器的另一种 source。

`profile`是宿主 registry中的非空别名，例如 `"default"`。普通 Docker Sandbox可以省略它并沿用
既有 Docker endpoint查找规则。`privileged: "rootless"`必须同时声明 `profile`，缺少时在 factory
求值阶段报错。

`privileged` 不接受 boolean或 `rootful`。`"rootless"` 表示 profile必须证明 privileged被限制在
rootless user namespace或独立 VM内。它不是把 Dockerode `HostConfig.Privileged`直接交给作者。

凡是声明 profile，无论是否 privileged，都必须显式提供 CPU、memory、PID和
`readOnlyRootfs: true`。四项没有 profile默认值，也不能省略；watchdog因此总能在 create前取得
完整 reservation向量。可写路径只能来自显式 `tmpfs`，省略 `tmpfs`表示容器没有额外可写路径。

## DinD 声明

```ts
import { dockerSandbox } from "niceeval/sandbox";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

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
      "/var/lib/docker": {
        sizeBytes: 3 * GiB,
        mode: 0o711,
        uid: 0,
        gid: 0,
        executable: true,
      },
      "/home/sandbox/workspace": {
        sizeBytes: 2 * GiB,
        mode: 0o755,
        uid: 1000,
        gid: 1000,
        executable: true,
      },
      "/home/node": {
        sizeBytes: 512 * MiB,
        mode: 0o700,
        uid: 1000,
        gid: 1000,
      },
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
});
```

Docker `start` 只表示 PID 1已运行，不表示 entrypoint启动的 inner dockerd已 ready。NiceEval在任何
Sandbox lifecycle setup、prepare、agent ensure或 Attempt命令前重试 readiness command。容器提前
退出或超时归入 `sandbox.create`，随后执行整台容器的 Provider finalizer。

## 输入规范化

所有数值必须是正有限值；字节与 PID必须是 safe integer。tmpfs key必须是规范化绝对路径，不能
是 `/`，路径按字典序冻结。`mode`是 `0..0o7777`整数，uid/gid是非负 safe integer。

默认值遵循 absent等价：

- 普通 Docker省略 `profile` = 使用既有 endpoint查找规则；
- 省略 `privileged` = 非 privileged；
- 不带 profile的分支省略 `resources` 与空对象相同；
- `readOnlyRootfs: false` 与省略相同；
- 省略 `executable` = `false`；
- 省略 `intervalMs` = 250 ms。

`memoryBytes`同时映射到 Docker memory与 memory+swap，总 swap额外量为0。`tmpfs`始终带
`nosuid,nodev`，并按 `executable`选择 `exec`或 `noexec`。tmpfs实际占用计入容器 memory cgroup；
各路径 `sizeBytes`之和不是额外内存。

`readOnlyRootfs: true`是单 Attempt磁盘 DoS边界。只有显式 tmpfs可写；Agent不能改写 outer
writable layer。缺少必要写路径会在 readiness/setup报告配置错误，不能自动回退到可写 rootfs。

## 身份

以下静态声明进入 template identity：

- 完整 `source`；
- `privileged`；
- 完整规范化后的 `resources`；
- readiness command与 user。

readiness timeout/interval是生命周期预算，不改变已完成 Attempt的语义，因此不使旧结果失去携带
资格。physical planning得到的 profile semantic policy revision、target platform、privileged与
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

带 `privileged: "rootless"`的 provider capability恒为 `DestroyOnly`。它不能与
`--keep-sandbox`组合，也不能跨 Invocation retention。Invocation内普通复用仍须遵守既有
reset/lifetime契约，不由 privileged自动开启。

容器 entrypoint/PID 1可以是 root，用来启动 inner dockerd、收紧 socket mode并等待 ready。
NiceEval受管命令和 coding agent使用 `user`，例如 `node`。能访问 inner socket的用户在该评估
容器内拥有 root等价能力；普通用户身份用于工具兼容，不是容器内安全边界。

outer profile socket、control endpoint与 lease token不以 mount、子进程变量或文件形式进入评估
容器。容器内 `DOCKER_HOST`只能指向 inner Unix socket。

## 观测

`managed-rootless/v1` policy阻断 host loopback，outer eval container不注入
`host.docker.internal`，`Sandbox.otlpHost`为 `null`。OTLP不能成为隐式 host gateway。

受控 OTLP proxy若被纳入 profile，必须成为可 attest的语义 capability，并进入 semantic policy
revision。
