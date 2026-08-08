# PLAN-8 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 导出边界

Environment 声明从 `niceeval/environment` 导出；Provider 配置与运行时 Sandbox 操作从 `niceeval/sandbox` 导出：

```typescript
import {
  composeEnvironment,
  dockerfileEnvironment,
  type EnvironmentSource,
} from "niceeval/environment";
import {
  dockerSandbox,
  e2bSandbox,
  type Sandbox,
  type SandboxConfig,
} from "niceeval/sandbox";
```

模块边界表达两个不同问题：Environment 描述题目从什么条件启动；SandboxConfig 选择谁规划它，并配置启动后的 Experiment 准备。

## Eval Environment

```typescript
interface EvalDef {
  readonly environment?: string | EnvironmentSource;
  setup?(sandbox: Sandbox, context: EvalSetupContext): Promise<void> | void;
  teardown?(sandbox: Sandbox, context: EvalSetupContext): Promise<void> | void;
  test(t: TestContext): Promise<void> | void;
}
```

字符串是 environment profile；EnvironmentSource 是 folder-local、Provider-neutral 的题目 Environment 输入。
两者都不选择 Provider，也都不是运行中的 Sandbox。

### `composeEnvironment()`

```typescript
export default defineEval({
  environment: composeEnvironment({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
    build: "on-demand",
    executionUser: "image",
  }),
});
```

```typescript
interface ComposeEnvironmentOptions {
  file: string | URL;
  workspaceService: string;
  build?: "on-demand" | "prebuilt";
  executionUser?: string;
  env?: Readonly<Record<string, string>>;
}
```

`workspaceService` 是 Agent、Eval、文件 API、workdir 与 diff 共同锚定的 service。
Environment 仍可声明伴随 service，但普通 setup 只取得主 Sandbox，不取得任意修改 service、网络与 volume 的入口。

### `dockerfileEnvironment()`

```typescript
export default defineEval({
  environment: dockerfileEnvironment({
    context: new URL(".", import.meta.url),
    dockerfile: "Dockerfile",
    buildArgs: { PROFILE: "judge" },
  }),
});
```

```typescript
interface DockerfileEnvironmentOptions {
  context: string | URL;
  dockerfile?: string;
  buildArgs?: Readonly<Record<string, string>>;
}
```

`composeEnvironment()` 与 `dockerfileEnvironment()` 返回不同 kind 的 EnvironmentSource。
它们只描述输入，不承诺当前 Provider 支持该 kind。

## `SandboxConfig`

`dockerSandbox()`、`e2bSandbox()`、`vercelSandbox()` 与 `localSandbox()` 返回 Provider-specific SandboxConfig。
这个值放进 `experiment.sandbox` 或 `config.sandbox`，不是运行中的 Sandbox。

```typescript
interface SandboxConfig {
  readonly provider: string;
  setup(fn: SandboxHook): SandboxConfig;
  teardown(fn: SandboxHook): SandboxConfig;
}
```

具体 Provider 仍使用可辨识联合保存自己的字段。
作者通常不直接标注 `SandboxConfig`，而是调用对应工厂。

### Provider 内建 Environment 支持

```typescript
export default defineExperiment({
  sandbox: dockerSandbox().setup(ensureGitForLedger),
});
```

Docker Provider 直接支持 Compose 与 Dockerfile Environment。
普通 Experiment 没有 `materializers` 字段，也不导入 `dockerComposeMaterializer()`。

自定义 Provider 的 Environment kind 支持与规划函数必须在 Provider 定义内同点声明。
它是 Provider 作者扩展面，不是每个 Experiment 重复装配的注册表。

## `defaultEnvironment`

Provider 原生 fallback 使用明确的 `defaultEnvironment` 字段：

```typescript
dockerSandbox({
  defaultEnvironment: { image: "acme/coding@sha256:..." },
});

e2bSandbox({
  defaultEnvironment: { template: "mempal-codex-v3" },
});

vercelSandbox({
  defaultEnvironment: { snapshotId: "snap_01J..." },
});
```

`defaultEnvironment` 是 Provider-native 的完整起点声明。
它只在当前 Eval 没有 Environment 时使用，不与 Eval Environment 合并，也不替换它。

省略字段时，Provider 可以使用自己文档化的内建 defaultEnvironment。
Runner 仍把最终使用的 image、template 或 snapshot identity 写入 Attempt Record，不能用“默认”掩盖实际起点。

## `environments[profile]`

项目可以按 profile 提供 Provider-native 的完整预制 Case：

```typescript
dockerSandbox({
  environments: {
    "terminal-bench/sheets": {
      image: "acme/tb-sheets-with-mempal@sha256:...",
    },
  },
});
```

`environments[profile]` 命中时优先于 Provider 按 EnvironmentSource 规划。
它用于替换慢路径，或表达无法在运行中安装的完整组合；启动后仍执行三层 setup 的检查与准备。

表项不是第二份 Environment contribution，也不声明框架把 Eval 与 Experiment 两份声明合并过。
它的 provenance 必须能证明自己对应当前 Environment source，不能由配置里的同名字符串自行背书。

## 三层 setup

Experiment sandbox setup：

```typescript
const sandbox = dockerSandbox()
  .setup(ensureCompanyCertificates)
  .setup(ensureGitForLedger);
```

Eval setup：

```typescript
export default defineEval({
  async setup(sandbox) {
    await sandbox.runShell("pnpm install --frozen-lockfile");
  },
});
```

Agent setup 由 Adapter 与 AgentProvisioner 拥有。
三层都作用于最终主 Sandbox，但保留各自的 identity、频次、phase、反馈与 teardown。

setup 数组顺序就是执行顺序。
本方案没有公共 `defineLayer()`，也不会把 AgentProvisioner 投影成较弱的通用安装协议。

## 普通文件传输

PLAN-7 的普通上传语义原样保留。
本地 URL 进入 `uploadFile` 或 `uploadDirectory` 时，Runner 写入真实读取的 source tree、内容身份、目标与 send 区间。

```typescript
await t.send("完成任务。");
await t.sandbox.uploadDirectory(new URL("tests/", import.meta.url), "/tests");
const result = await t.sandbox.runShell("bash /tests/run-tests.sh", { root: true });
t.check(result, commandSucceeded());
```

顺序决定可见性，send 区间决定 Agent diff 归因。
文件用途不进入 Environment 或 SandboxConfig 类型。
