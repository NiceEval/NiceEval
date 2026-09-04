# PLAN-5 —— Provider-neutral nested Docker（推荐）

## 核心心智

Nested Docker 是一项 Sandbox 能力要求，不是 Docker Profile、mount 方案或 Provider 产品名。
Eval 声明它需要 Docker API、Compose、专用 kernel 和最低 data capacity；Experiment 仍用现有
template-bearing Sandbox factory 选择一个能兑现这些要求的 Provider。

产品 V1 只承诺具名能力 `docker/v1`。它不承诺 Agent 可以创建任意 NiceEval Sandbox，也不把
Kubernetes、Firecracker API 或第二层 NiceEval control plane 暴露给 Agent。

## Library 调用面

Eval 的声明是 command-only Sandbox layer，不选择 Provider 或 Sandbox origin：

```ts
import { defineEval } from "niceeval";
import { sandboxRequirements } from "niceeval/sandbox";

const GiB = 1024 ** 3;

export default defineEval({
  environment: sandboxRequirements({
    docker: {
      api: "docker/v1",
      compose: "v2",
      isolation: "dedicated-kernel/v1",
      minimumDataBytes: 4 * GiB,
    },
  }),
  // ...
});
```

公开形状完整定义为：

```ts
interface SandboxRequirementsOptions {
  readonly docker?: DockerExecutionRequirement;
}

interface DockerExecutionRequirement {
  readonly api: "docker/v1";
  readonly compose: "v2" | "not-required";
  readonly isolation: "dedicated-kernel/v1";
  readonly minimumDataBytes: number;
}
```

`minimumDataBytes` 是正整数 byte 数。4 GiB 是本题的最低要求，不是所有 Eval 的全局默认。
没有 `docker` 字段的 Sandbox 不因此启动 daemon。

Experiment 选择具体 Provider 与完整 Sandbox origin。自托管写法是：

```ts
export default defineExperiment({
  agent: codexAgent(),
  maxConcurrency: 4,
  sandbox: incusSandbox({
    image: "niceeval/docker-execution-v1",
    project: "niceeval-eval",
    storagePool: "evals",
    resources: {
      cpus: 4,
      memoryBytes: 6 * GiB,
      dockerDataBytes: 4 * GiB,
    },
  }),
});
```

托管写法可以把 `incusSandbox()` 换成经过认证的 `runloopSandbox()`。两者返回相同的公共 Sandbox
operations，但 Provider locator、credential、snapshot 与 storage policy 保持私有。

## 能力绑定

每个 Provider planner 返回可序列化 capability receipt：

```ts
interface DockerExecutionCapability {
  readonly api: "docker/v1";
  readonly compose: "v2" | "unavailable";
  readonly isolation: "dedicated-kernel/v1";
  readonly dataBytes: number;
  readonly daemon: "sandbox-private";
}
```

planning 在 create、Record append、模型调用和 Attempt dispatch 前比较 requirement 与 receipt。
缺 capability、隔离较弱或容量不足时返回 `sandbox-capability-unsatisfied`，列出 required/provided，
不尝试其它 Provider，也不回退 socket 或 DinD。

## Sandbox 实例

每条 Attempt 得到一台 VM 或等价专用 kernel Sandbox。主 Sandbox 是 guest 工作空间；Agent、Eval test、
文件 API 与 diff 都在这里运行。guest 内普通 Docker daemon 监听本机 Unix socket。4 GiB Docker data
virtual disk 与 guest root、workspace 分开，方便 quota、clone 与销毁。

Provider 负责把 Docker CLI、Compose 和 daemon 带进 trusted origin。NiceEval 不在 Attempt ready 后
临时安装 daemon，也不要求用户镜像携带 DinD entrypoint 或 privileged outer-container protocol。

## 缓存

Provider artifact 可以捕获 exact SetupPrefix，但只有受信任 prepare worker 能发布。
普通 Attempt 永不把自己的 Docker data、workspace 或 secret promotion 成共享 artifact。

共享加速按三层组成：digest-pinned OCI catalog/mirror、trusted BuildKit external cache、Provider-native
immutable artifact。每个 Attempt 从 artifact clone 私有 root/data disk，之后的所有写入都属于它自己。
目标架构不再把 `sandboxState.dockerData` 暴露成 NiceEval 特殊 public state surface；Provider 只对完整、
可验证的 prepared Sandbox artifact 报告 coverage。

## 生命周期与错误

完整 owner、ledger、capture 与 recovery 见 [Architecture](architecture.md)，时序见
[Lifecycle](lifecycle.md)。错误使用 Provider-neutral code：

- `sandbox-capability-unsatisfied`：当前 Provider 不能满足 exact requirement；
- `sandbox-capacity-unavailable`：四路 reservation 已满或 pool 可写容量低于安全阈值；
- `sandbox-artifact-unverified`：manifest、snapshot 或 clone identity 不一致；
- `sandbox-readiness-failed`：guest、Docker、Compose、socket 或 quota 验证失败；
- `sandbox-allocation-lost`：ledger active，但 Provider object 已不存在；
- `sandbox-destroy-incomplete`：destroy 未得到“已删除或不存在”的终态证明。

所有错误都保留 Provider diagnostic，但 core 不按 `provider === "incus"` 或 `"runloop"` 分支。

## Cases

这个候选兑现 C1–C10 的方法由同一 capability 与 allocation protocol定义，不因 Provider 改名。
C11 先以 Incus VM 作为 NixOS reference Provider 完成，再以 Runloop 做第二个 adapter PoC，证明公共
contract 不是只包了一层 Incus 名字。完整公开验收见[真实 dogfood](use-case/README.md)。
