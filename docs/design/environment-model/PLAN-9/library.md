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
  type SandboxCommand,
  type SandboxRecipe,
} from "niceeval/sandbox";
```

本方案没有 `niceeval/environment` 作者入口。
运行中的 Sandbox 类型继续从同一模块导出，但它与 SandboxRecipe 是两个不可互换的类型。

## `SandboxRecipe`

```typescript
interface SandboxRecipe<Self = SandboxRecipe> {
  setup(command: SandboxCommand): Self;
  teardown(command: SandboxCommand): Self;
  beforeEach(command: SandboxCommand): Self;
  afterEach(command: SandboxCommand): Self;
}

type SandboxCommand = (
  sandbox: Sandbox,
  context: SandboxCommandContext,
) => Promise<void> | void;
```

Recipe 是不可变声明。
四个方法接受同一种 SandboxCommand，只显式选择执行 scope：

| Scope | 正向方法 | 反向方法 | fresh | reuse |
|---|---|---|---|---|
| Window（fresh Case / 复用窗口） | `.setup()` | `.teardown()` | 各一次 | 每窗口各一次 |
| Attempt | `.beforeEach()` | `.afterEach()` | 各一次 | 每 Attempt 各一次 |

`.setup()` 与 `.beforeEach()` 都按追加顺序执行；`.teardown()` 与 `.afterEach()` 都按追加逆序执行。Runner 另外在 owner 之间执行反向收尾。
同一条链上不同方法的调用位置不会让 lifecycle phase 彼此穿插；方法名决定 command 所在的 phase，声明顺序只在同一方法内生效。
两个 owner 的 command 在能力上没有差别：都只操作已启动的 Sandbox，不合成 image、template 或第二个 Sandbox。owner 仅决定顺序、归因与收尾位置。

共享 `SandboxRecipe` 协议只包含 command stack 方法，不包含 `template` 属性。
作者通过具体 factory 的 options 选择起点，Runner 才在内部把它归一成 SandboxTemplate：

```text
composeSandbox({ file, workspaceService }) -> ComposeSandboxTemplate
dockerfileSandbox({ context, ... })        -> DockerfileSandboxTemplate
profileSandbox(profile)                    -> ProfileSandboxTemplate
dockerSandbox({ image })                   -> DockerImageSandboxTemplate fallback
e2bSandbox({ template })                   -> E2BSandboxTemplate fallback
vercelSandbox({ snapshotId })              -> VercelSnapshotSandboxTemplate fallback
```

因此 `e2bSandbox({ template: "mempal-codex-v3" })` 中的 `template` 只是该 factory 的 provider-native option，不要求与其它 factory 共享字段类型。普通作者不能通过 `recipe.template = ...` 或直接构造对象替换 factory 的归一规则。

`SandboxCommandContext` 记录 owner、`scope: "window" | "attempt"`、可选 Attempt、signal、progress、diagnostic 与 facts。

window scope 没有伪造的“当前 Attempt”：其 command activity、facts、耗时与 diagnostic 归 RunningSandboxCase / 复用窗口记录，窗口内 Attempt 只引用该记录。attempt scope 的同类证据直接归当前 Attempt。这样 setup 失败或最终 teardown 失败即使发生在 Attempt 边界外，也有稳定归属。

它不暴露 Provider-native SDK，也不允许新增 service 或替换主 Sandbox。

类型使用 callback 而不是直接 shell 字符串，是为了保留 `runCommand` 的 argv 安全语义、命令选项、文件传输与结果检查。运行效果仍然只是在同一 Sandbox 上执行命令和 IO。

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

`defineSandboxRecipe()` 声明只在现有 Sandbox 上执行的 command。题目 checkout 与依赖准备通常属于 Attempt scope：

```typescript
export default defineEval({
  sandbox: defineSandboxRecipe()
    .beforeEach(checkoutRepository)
    .beforeEach(installProjectDependencies),
  async test(t) {
    await t.send("完成任务。");
  },
});
```

它不选择起点，也不选择 Provider。
当 Experiment 拥有 active template 时，Experiment 与 Eval 的窗口 setup 先完成；随后每条 Attempt 先执行 Experiment beforeEach，再执行这些 Eval beforeEach。

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

`composeSandbox()` 接受 Compose 起点参数并返回 EvalSandboxRecipe；Compose SandboxTemplate 由 factory 产物在内部携带，不作为共享 Recipe 属性暴露。
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

这里 `ensureGitForLedger` 是窗口 setup：复用时只运行一次，其结果进入 reset anchor，后续 Attempt reset 不会丢掉 Git。

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
它替换物理实现，但 template owner 仍是 Eval，因此 Window scope 与 Attempt scope 的 owner 顺序都仍为 Eval、Experiment、Agent。

预制表项必须携带能核对原始 Eval template 的 provenance。
产物名、profile 字符串或用户声明的 `fulfills` 不能代替同源身份。

## Provider 内建 template 支持

Docker Provider 内建 Compose 与 Dockerfile template 支持。
普通 Experiment 没有 `materializers` 字段，也不导入 `dockerComposeMaterializer()`。

自定义 Provider 在自身定义中同点声明支持的 SandboxTemplate kind 与 planner。
支持能力与实现不能由每个 Experiment 临时拼成注册表。

## Command 责任

SandboxCommand 的执行频次由声明方法决定。
昂贵安装、运行期能力检查与整窗共享配置适合 `.setup()`；checkout、Fixture 和每题依赖准备适合 `.beforeEach()`。对应清理分别放在 `.teardown()` 与 `.afterEach()`。
框架不为它建立 Requirement、inspect 或 install 协议，也不根据预制 template 名猜测某条 command 可以删除。

需要重复进入的操作仍应由 command 检查实际结果；任一命令失败都必须返回失败，而不是靠后续 Agent 猜测。
command 的源码、配置与 scope 进入所属 Eval 或 Experiment recipe 指纹，但 Runner 不解释它想保证的软件 identity。

Agent 安装继续由 AgentProvisioner 拥有。
通用 SandboxCommand 不复制 Agent 的宿主侧 prepare、staged payload、安装模式、平台探测、鉴权、会话与逐 Attempt Agent facts。

## 普通文件传输

`test(t)` 继续使用一套普通 Sandbox API。
本地 URL 上传时，Runner 自动记录 source tree、内容身份、目标与 send 区间；顺序决定 Agent 可见性，send 窗口决定 Agent diff 归因。
