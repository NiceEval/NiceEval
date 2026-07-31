# PLAN-1 Library:Environment 与 Provision

**本方案**:[README](README.md) · [Architecture](architecture.md) · [Use Case](use-case/README.md)

本篇只定义用户调用的公开形状。
模型选择与取舍见 [README](README.md),解析、身份与生命周期见 [Architecture](architecture.md)。

## 导出入口

Environment 与 Provision 从 `niceeval/environment` 导出;Sandbox Provider 与运行时 `Sandbox` 句柄继续从 `niceeval/sandbox` 导出:

```typescript
import { composeEnvironment, defineProvision } from "niceeval/environment";
import { dockerSandbox, e2bSandbox } from "niceeval/sandbox";
```

模块边界对应两个问题:`niceeval/environment` 声明需要什么,`niceeval/sandbox` 声明由谁运行及运行后怎样操作。

## `composeEnvironment(options)`

Eval 使用它声明 folder-local Compose Environment:

```typescript
export default defineEval({
  environment: composeEnvironment({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
    build: "on-demand",
    executionUser: "image",
  }),
  async test(t) { /* ... */ },
});
```

```typescript
interface ComposeEnvironmentOptions {
  file: string | URL;
  workspaceService: string;
  build?: "on-demand" | "never";
  executionUser?: "image" | "sandbox";
  env?: Readonly<Record<string, string>>;
}
```

`workspaceService` 是 Agent、`test(t)`、workdir、文件 API 与 diff 共同锚定的 Compose service。
这个名字表达用户可观察的职责,不使用只说明拓扑位置的 `mainService`。

`composeEnvironment` 不选择 Provider。
Docker Provider 内建支持;其它 Provider 只有兑现相同 workspace、网络、就绪、采证与清理契约后才能声明支持。

## `dockerSandbox()` 内建 Environment 支持

常规 Experiment 不注册 Environment 转换器:

```typescript
export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: dockerSandbox(),
});
```

`dockerSandbox()` 自动消费 `composeEnvironment(...)` 与后续定稿的 Dockerfile Environment。
用户不写 `materializers` 表,也不导入 `dockerComposeMaterializer()`。

具名 Environment 仍可通过 Provider 配置覆盖:

```typescript
dockerSandbox({
  environments: {
    "terminal-bench/sheets": {
      image: "acme/tb-sheets@sha256:...",
    },
  },
});
```

Eval 显式引用同名 profile,或 folder-local Environment 推导出该 profile 时,`environments` 表项优先于 Provider 内建的按需构建。
这保留用预制产物替换慢路径的出口,但不要求普通用户维护第二张注册表。

## `defineProvision(spec)`

Provision 是 Experiment 希望在 Sandbox 中成立的一项安装状态:

```typescript
const mempal = defineProvision({
  name: "mempal",
  identity: {
    version: "0.9.0",
    recipeRevision: 3,
    model: "minilm-l6@sha256:9f2c...",
  },
  platforms: ["linux/amd64", "linux/arm64"],
  installRequirements: {
    root: true,
    network: "direct",
  },
  inspect: async (sandbox) => {
    const installed = await readMempalManifest(sandbox);
    return installed === undefined
      ? { installed: false, reason: "missing" }
      : { installed: true, identity: installed.identity, facts: installed.facts };
  },
  install: async (sandbox, ctx) => {
    await installMempal(sandbox, ctx.prepared.files.archive);
    await writeMempalManifest(sandbox, ctx.identity);
  },
  prepare: async (ctx) => {
    const archive = join(ctx.stageDir, `mempal-${ctx.target.platform}.tar.gz`);
    await downloadAndVerifyMempal(ctx.target.platform, archive);
    return { files: { archive } };
  },
});
```

### 完整形状

```typescript
type Scalar = string | number | boolean;
type JsonValue = null | Scalar | JsonValue[] | { [key: string]: JsonValue };
type ProvisionIdentity = Readonly<Record<string, JsonValue>>;

interface ProvisionInstallRequirements {
  root?: true;
  network?: "direct";
}

interface ProvisionTarget {
  platform: string;
  root: "available" | "unavailable" | "unknown";
  network: "direct" | "none" | "unknown";
}

type ProvisionInspection<I extends ProvisionIdentity> =
  | { installed: false; reason: string; detail?: string }
  | {
      installed: true;
      identity: ProvisionIdentity;
      facts?: Readonly<Record<string, Scalar>>;
    };

interface PreparedProvision {
  files: Readonly<Record<string, string>>;
}

interface ProvisionContext<I extends ProvisionIdentity> {
  identity: I;
  experimentId: string;
  target: ProvisionTarget;
  signal: AbortSignal;
  progress(update: ProgressUpdate): void;
  diagnostic(diagnostic: DiagnosticInput): void;
  fact(key: string, value: Scalar): void;
}

interface ProvisionPrepareContext<I extends ProvisionIdentity>
  extends ProvisionContext<I> {
  stageDir: string;
}

interface ProvisionInstallContext<I extends ProvisionIdentity>
  extends ProvisionContext<I> {
  prepared: PreparedProvision;
}

interface ProvisionSpec<I extends ProvisionIdentity> {
  name: string;
  identity: I;
  platforms?: readonly string[];
  installRequirements?: ProvisionInstallRequirements;
  inspect(
    sandbox: Sandbox,
    context: ProvisionContext<I>,
  ): Promise<ProvisionInspection<I>>;
  install(
    sandbox: Sandbox,
    context: ProvisionInstallContext<I>,
  ): Promise<void>;
  prepare?(
    context: ProvisionPrepareContext<I>,
  ): Promise<PreparedProvision>;
}
```

`ProgressUpdate` 与 `DiagnosticInput` 复用现有生命周期反馈形状。
Provision 没有 teardown;安装内容随 Sandbox 销毁,跨 Attempt 状态仍由 Sandbox Hook 管理。
没有声明 `prepare` 时,`install` 收到 `{ files: {} }`;共享 helper 因此不需要为 `prepared` 增加 undefined 分支。

### identity 与 inspect

`identity` 必须覆盖安装配方、payload、模型与其它会改变实验条件的输入。
函数体不参与 fingerprint,所以脚本内容要以 digest 或人工递增 revision 进入 identity。

`inspect` 返回实际安装的 identity,不返回作者自己判定的 `ok: true`。
框架用稳定 JSON 比较实际 identity 与目标 identity;不相等时执行 `install`,随后再次 inspect。
安装后的 identity 仍不相等时,Attempt `errored`。

这条形状把声明了新模型但检查只看 CLI 版本的问题从文档义务变成协议约束。

### platforms 与 installRequirements

`platforms` 表达 Provision 本身可以运行的平台。
目标平台不在列表中时计划期 `skipped`;省略表示 Provision 不限制平台。

`installRequirements` 只约束 inspect miss 后的安装动作。
inspect 已命中时不检查这些字段,所以需要外网安装的 Provision 可以在已经预装完成的断网 Environment 中运行。

miss 后若 root 或 network 明确不相容,Attempt `errored` 并指向安装前置条件。
Provider 无法静态证明的能力保留为 `unknown`,由 install 的实际结果决定,不伪装成已满足。

### prepare

`prepare` 是可选的宿主侧 payload 准备,用于断网安装和大文件共享。
它取得解析后的目标平台;single-flight key 包含 Provision name、identity 与 `target.platform`,不同架构不会误用同一 payload。

`prepare` 在第一次 inspect miss 后按需启动。
等待共享准备时 Attempt deadline 继续计算,因为 Sandbox 已经创建并持续占用 Provider 资源;记录同时保留 Run 级共享准备 timing。

## `experiment.provisions`

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: BASE_TEMPLATE }),
  provisions: [companyCertificates, nodeRuntime, mempal],
});
```

`provisions` 是有序数组。
Runner 按声明顺序 inspect 和 install;只要执行过 install,最后按同一顺序重新 inspect 全部 Provision。
后一个 Provision 破坏前一个时,错误点名失败项与它上次通过后执行过安装的候选项。

Adapter 自己确保 Agent CLI 就位,但这不作为 Agent Provision 暴露给 Experiment 作者。
需要在 Agent 安装后配置扩展时,继续使用 adapter factory 的安装后扩展点。

Direct Agent 没有 Sandbox。
Direct Agent 与非空 `provisions` 组合在启动期报配置错误,不静默忽略。

Provision 的有序 `{ name, identity }` 列表进入 `configHash` 和 `run.json`。
name 重复在启动期一次穷举报错;name 限 `[a-z0-9-]+`。

## Sandbox Hook 与 Provision 的边界

| 用户目标 | 使用 |
|---|---|
| 安装二进制、运行时、证书、模型 cache | Provision |
| 载入或回存跨 Attempt 状态 | Sandbox `setup` / `teardown` |
| 写入 workdir 的任务文件 | Fixture |
| 启停 Experiment 整场一份的宿主机服务 | Experiment `setup` / `teardown` |

Provision 声明可检查的目标状态;Hook 承载每个 Sandbox 的运行状态与副作用。
两者不能互相替代,也不合并成一个万能 setup。
