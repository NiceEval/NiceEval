# Nested Docker —— Library

Eval 声明能力，Experiment 选择 Incus VM。
两者都放进现有 `sandbox` 字段，不新增第二套 origin 字段。

## `sandboxLayer({ requirements })`

```ts
import { sandboxLayer } from "niceeval/sandbox";

interface SandboxLayerOptions {
  readonly requirements?: SandboxLayerRequirements;
}

interface SandboxLayerRequirements {
  readonly nestedDocker?: NestedDockerRequirement;
}

interface NestedDockerRequirement {
  readonly compose?: "v2";
  readonly minimumDataBytes: number;
}

declare function sandboxLayer(
  options?: SandboxLayerOptions,
): SandboxLayer<"command-only">;
```

`minimumDataBytes` 是正整数 byte 数。
4 GiB 是 NiceEval-Eval 这类题目的最低要求，不是所有 Eval 的全局默认。
`compose` 省略时不要求 Compose；写出 `"v2"` 时 Provider 必须证明 Compose V2 可用。
没有 `nestedDocker` 字段时，该 layer 不要求启动 daemon。

`nestedDocker` 固定表示 `docker/v1`、sandbox-private daemon 与 `dedicated-kernel/v1`；
这些是能力本身的语义，不是作者重复填写的选项。
Eval 侧用这份 command-only layer 配置声明 Nested Docker。
它不选择 image、project、storage pool 或 Provider。

```ts
import { defineEval } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";

const GiB = 1024 ** 3;

export default defineEval({
  sandbox: sandboxLayer({
    requirements: {
      nestedDocker: {
        compose: "v2",
        minimumDataBytes: 4 * GiB,
      },
    },
  }),
  async test(t) {
    await t.send("在仓库里用 Docker Compose 完成安装。");
  },
});
```

## `incusSandbox()`

```ts
import { incusSandbox } from "niceeval/sandbox";

interface IncusSandboxResources {
  readonly cpus?: number;
  readonly memoryBytes?: number;
  readonly dockerDataBytes?: number;
}

interface IncusSandboxOptions {
  readonly image: string;
  readonly project: string;
  readonly storagePool: string;
  readonly resources?: IncusSandboxResources;
  readonly acceptDevelopmentDomain?: boolean;
}

declare function incusSandbox(
  options: IncusSandboxOptions,
): SandboxLayer<"template-bearing">;
```

`image`、`project`、`storagePool` 必填。
`image` 是 digest-pinned locator，例如 `name@sha256:<64 hex>`，不能用可变 alias。
它始终指向 exact trusted base；业务 preparation cache 不改变它的含义，也不通过 `incusSandbox()`
增加字段或另设公开 cache API。
`acceptDevelopmentDomain` 是 `boolean`，省略时等于 `false`，只接受 reference domain。
显式 `true` 才允许 development domain。
该字段进入 identity 与 `--dry`；省略与显式 `false` 是同一份 identity。

reference Experiment：

```ts
export default defineExperiment({
  agent: codexAgent(),
  maxConcurrency: 4,
  sandbox: incusSandbox({
    image: "niceeval/docker-execution-v1@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    project: "niceeval-eval",
    storagePool: "niceeval-evals",
    resources: {
      cpus: 4,
      memoryBytes: 6 * GiB,
      dockerDataBytes: 4 * GiB,
    },
  }),
});
```

development Experiment 必须同时写出 `acceptDevelopmentDomain: true`，并使用 development project 与 pool：

```ts
incusSandbox({
  image: "niceeval/docker-execution-v1@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  project: "niceeval-eval-dev",
  storagePool: "niceeval-sandbox-dev",
  acceptDevelopmentDomain: true,
})
```

未写出该字段时，development domain 不能承接这条 Experiment。
`acceptDevelopmentDomain: true` 配 reference project / pool 同样失败。

## 能力 receipt

Provider planner 在 create 前返回可序列化 receipt：

```ts
type DockerExecutionCapacity =
  | { readonly _tag: "Attested"; readonly bytes: number }
  | {
      readonly _tag: "Unattested";
      readonly acceptedByExperiment: boolean;
      readonly reason: string;
    };

interface DockerExecutionCapability {
  readonly api: "docker/v1";
  readonly compose: "v2" | "unavailable";
  readonly isolation: "dedicated-kernel/v1";
  readonly daemon: "sandbox-private";
  readonly executionDomain: "reference" | "development";
  readonly executionDomainId: string;
  readonly capacity: DockerExecutionCapacity;
}
```

planning 比较 requirement 与 receipt。

- `capacity._tag === "Attested"`：`bytes >= minimumDataBytes` 才满足；
- `capacity._tag === "Unattested"`：仅当 `acceptedByExperiment === true` 时允许计划继续。
  它绝不声称容量 attested，也不可与 reference 比较。

缺 capability、隔离较弱、Compose 不足或容量不满足时，返回
`sandbox-capability-unsatisfied`，列出 required / provided。
它不尝试其它 Provider，也不回退宿主 socket 或 DinD。

`incusSandbox()` 的 receipt 固定为：

| 字段 | reference | development + explicit opt-in |
|---|---|---|
| `api` | `"docker/v1"` | `"docker/v1"` |
| `compose` | `"v2"` | `"v2"` |
| `isolation` | `"dedicated-kernel/v1"` | `"dedicated-kernel/v1"` |
| `daemon` | `"sandbox-private"` | `"sandbox-private"` |
| `executionDomain` | `"reference"` | `"development"` |
| `capacity` | `{ _tag: "Attested", bytes }` | `{ _tag: "Unattested", acceptedByExperiment: true, reason }` |

Eval 省略 `compose` 时，receipt 仍可以是 `"v2"`。
Eval 写 `compose: "v2"` 而 receipt 是 `"unavailable"` 时失败。

## Guest 与公开句柄

Incus VM 兑现的主 Sandbox 固定为：

| 事实 | 值 |
|---|---|
| 执行身份 | `node`，uid 1000 |
| `workdir` | `/home/sandbox/workspace` |
| Docker daemon | guest 内普通 dockerd，本机 Unix socket |
| `otlpHost` | `null` |

NiceEval 不在 Attempt ready 后临时安装 daemon。
用户镜像也不携带 DinD entrypoint 或 privileged outer-container protocol。
Provider 负责把 Docker CLI、Compose 与 daemon 带进 trusted origin。

## 身份

会改变执行语义的字段进入 identity 与 `--dry`：

- Nested Docker requirement 的 `compose` 与 `minimumDataBytes`；
- `incusSandbox()` 的 `image`、`project`、`storagePool`、`resources`、`acceptDevelopmentDomain`；
- Provider 的 execution domain 与 capability receipt。

`acceptDevelopmentDomain: true` 的结果与 reference 不可比。
development domain 不是 reference，也不能参加 reference 对照。

## 非法组合

| 输入 | 结果 |
|---|---|
| Eval 声明 `requirements.nestedDocker`，Experiment 不是 `incusSandbox()` | `sandbox-capability-unsatisfied`；不回退 |
| `incusSandbox()` 配 `--keep-sandbox` | 创建资源前失败 |
| `incusSandbox()` 配 `sandboxReuse: true` | 创建资源前失败 |
| 省略 `acceptDevelopmentDomain` 却选择 development project / pool | fail-closed，不改走 reference 伪装 |
| `acceptDevelopmentDomain: true` 配 reference project / pool | `sandbox-capability-unsatisfied` |
| `dockerAccess` socket / raw / managed DinD | 不是 nested Docker public path，也不能满足 `docker/v1` |

## 错误码

core 使用 Provider-neutral code，不按 `provider === "incus"` 分支：

| code | 含义 |
|---|---|
| `sandbox-capability-unsatisfied` | 当前 Provider 不能满足 exact requirement |
| `sandbox-capacity-unavailable` | reservation 已满，或可写容量低于安全阈值 |
| `sandbox-artifact-unverified` | manifest、snapshot 或 clone identity 不一致 |
| `sandbox-readiness-failed` | guest、Docker、Compose、socket 或 quota 验证失败 |
| `sandbox-allocation-lost` | ledger 仍 active，但 Provider object 已不存在 |
| `sandbox-destroy-incomplete` | destroy 未得到“已删除或不存在”的终态证明 |

公开形状到此为止。
未列出的 factory 字段不存在。
