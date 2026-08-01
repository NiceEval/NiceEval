# PLAN-9 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 导出入口

所有作者侧 Sandbox 声明从 `niceeval/sandbox` 导出：

```typescript
import {
  composeSandbox,
  defineSandboxRecipe,
  dockerfileSandbox,
  dockerSandbox,
  e2bSandbox,
  profileSandbox,
  type Sandbox,
  type SandboxRecipe,
  type SandboxTemplate,
} from "niceeval/sandbox";
```

本方案没有 `niceeval/environment` 作者入口。
运行中的 Sandbox 类型继续从同一模块导出，但它与 SandboxRecipe 是两个不可互换的类型。

## `SandboxRecipe`

```typescript
interface SandboxRecipe<Self = SandboxRecipe> {
  readonly template?: SandboxTemplate;
  readonly setupHooks?: readonly SandboxSetup[];
  readonly teardownHooks?: readonly SandboxTeardown[];
  setup(fn: SandboxSetup): Self;
  teardown(fn: SandboxTeardown): Self;
}

type SandboxSetup = (
  sandbox: Sandbox,
  context: SandboxSetupContext,
) => Promise<void> | void;

type SandboxTeardown = (
  sandbox: Sandbox,
  context: SandboxSetupContext,
) => Promise<void> | void;
```

Recipe 是不可变声明。
`.setup()` 按追加顺序执行，`.teardown()` 按追加逆序执行；Runner 另外在 owner 之间执行反向 teardown。
每个 setup hook 是一层顺序 layer：它只操作已启动的 Sandbox，不合成 image、template 或第二个 Sandbox。

`SandboxSetupContext` 记录 owner、Attempt、identity、signal、progress、diagnostic 与 facts。
它不暴露 Provider-native SDK，也不允许新增 service 或替换主 Sandbox。

## Eval 与 Experiment

```typescript
interface EvalDef {
  readonly sandbox?: EvalSandboxRecipe;
  test(t: TestContext): Promise<void> | void;
}

interface ExperimentDef {
  readonly sandbox?: ExperimentSandboxRecipe;
  readonly agent: Agent;
}
```

EvalSandboxRecipe 不能选择 Provider。
沙箱型 Agent 的 ExperimentSandboxRecipe 必须自己选择 Provider，或从项目 config 继承一个 Provider recipe；Direct Agent 不需要 Sandbox recipe。

两处 `sandbox` 不表示创建两个 Sandbox。
Runner 把它们与 Agent 的专用 contribution 解析成同一条 owner stack，并只创建一个 Sandbox Case。

## 没有 template 的 recipe

`defineSandboxRecipe()` 声明只在现有 Sandbox 上执行的 setup：

```typescript
export default defineEval({
  sandbox: defineSandboxRecipe()
    .setup(checkoutRepository)
    .setup(installProjectDependencies),
  async test(t) {
    await t.send("完成任务。");
  },
});
```

它不选择起点，也不选择 Provider。
当 Experiment 拥有 active template 时，这些 setup 在 Experiment setup 后执行。

## Eval template

### `composeSandbox()`

```typescript
export default defineEval({
  sandbox: composeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
    build: "on-demand",
    executionUser: "image",
  }),
});
```

```typescript
interface ComposeSandboxOptions {
  file: string | URL;
  workspaceService: string;
  build?: "on-demand" | "prebuilt";
  executionUser?: string;
  env?: Readonly<Record<string, string>>;
}
```

`composeSandbox()` 返回带 Compose SandboxTemplate 的 EvalSandboxRecipe。
它不选择 Provider；`workspaceService` 对应 Agent、Eval、文件 API、workdir 与 diff 共同使用的主 Sandbox。

### `dockerfileSandbox()`

```typescript
export default defineEval({
  sandbox: dockerfileSandbox({
    context: new URL(".", import.meta.url),
    dockerfile: "Dockerfile",
    buildArgs: { PROFILE: "judge" },
  }),
});
```

Dockerfile 内容、过滤后的 context、build args、基础镜像 digest 与目标平台进入 BuildKey。

### `profileSandbox()`

```typescript
export default defineEval({
  sandbox: profileSandbox("python-data-science"),
});
```

字符串 profile 变成显式 recipe factory，不再借用 `environment: string` 字段。
这个稳定 id 称为 sandbox profile。
profile 必须在当前 Experiment Provider recipe 的 `templates` 表命中；缺失是启动期配置错误。

## Experiment Provider recipe

```typescript
export default defineExperiment({
  sandbox: dockerSandbox().setup(ensureGitForLedger),
  agent: codexAgent(),
});
```

`dockerSandbox()` 选择 Docker Provider，并携带 Provider 的 fallback template。
Eval recipe 有 template 时 fallback 不激活；Eval 没有 template 时，fallback 成为 active template，Experiment 成为 template owner。

Provider-native fallback 仍可显式配置：

```typescript
dockerSandbox({ image: "acme/coding@sha256:..." });
e2bSandbox({ template: "mempal-codex-v3" });
vercelSandbox({ snapshotId: "snap_01J..." });
```

这些字段只表示 Experiment fallback。
它们不会覆盖 Eval recipe 的 Compose、Dockerfile 或 profile template，也不与之合并。

## Profile 覆盖

Experiment Provider recipe 可以按 Eval profile 提供完整 Provider-native Case：

```typescript
dockerSandbox({
  templates: {
    "terminal-bench/sheets": {
      image: "acme/tb-sheets-with-tools@sha256:...",
    },
  },
});
```

`templates[profile]` 优先于 Provider 对 Eval template 的内建规划。
它替换物理实现，但 template owner 仍是 Eval，因此 owner setup 顺序仍为 Eval、Experiment、Agent。

预制表项必须携带能核对原始 Eval template 的 provenance。
产物名、profile 字符串或用户声明的 `fulfills` 不能代替同源身份。

## Provider 内建 template 支持

Docker Provider 内建 Compose 与 Dockerfile template 支持。
普通 Experiment 没有 `materializers` 字段，也不导入 `dockerComposeMaterializer()`。

自定义 Provider 在自身定义中同点声明支持的 SandboxTemplate kind 与 planner。
支持能力与实现不能由每个 Experiment 临时拼成注册表。

## Setup helper

plain setup function 每 Attempt 执行，不能声称预装命中或参与可比 identity。
昂贵条件使用领域 helper 封装 target identity、inspect、必要时 install 与 re-inspect。

helper 仍可以执行宿主侧 staged payload 准备，但 Agent 安装继续由 AgentProvisioner 拥有。
通用 Sandbox setup 不复制 Agent 的安装模式、平台探测、鉴权、会话与逐 Attempt Agent facts。

## 普通文件传输

`test(t)` 继续使用一套普通 Sandbox API。
本地 URL 上传时，Runner 自动记录 source tree、内容身份、目标与 send 区间；顺序决定 Agent 可见性，send 窗口决定 Agent diff 归因。
