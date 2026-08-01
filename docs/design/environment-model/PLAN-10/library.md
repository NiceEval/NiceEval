# PLAN-10 —— Library 候选形状

**相关文档**：[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 导出入口

Eval 与 Experiment 的 Sandbox 声明都从 `niceeval/sandbox` 导出：

```typescript
import {
  command,
  defineSandboxCommand,
  dockerComposeSandbox,
  dockerfileSandbox,
  dockerImageSandbox,
  e2bSandbox,
  registerSandboxContent,
  sandboxLayer,
  shell,
  vercelSandbox,
  type Sandbox,
  type SandboxCommand,
  type SandboxCommandContext,
  type SandboxCommandTarget,
  type SandboxLayer,
} from "niceeval/sandbox";
```

`SandboxLayer` 是作者声明；`Sandbox` 是启动后执行命令与文件操作的句柄，两者不可互换。

## `SandboxLayer`

```typescript
type SandboxLayerKind = "root" | "extension";
type MaybePromise<T> = T | Promise<T>;

declare const sandboxLayerKind: unique symbol;
declare const stableSandboxCommandKind: unique symbol;
declare const registeredSandboxContentKind: unique symbol;

interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  readonly [sandboxLayerKind]: Kind;
  prepare(command: SandboxCommand): SandboxLayer<Kind>;
}

interface AttemptRef {
  readonly id: string;
  readonly index: number;
}

type SerializableValue =
  | null
  | boolean
  | number
  | string
  | readonly SerializableValue[]
  | { readonly [key: string]: SerializableValue };

interface SandboxProgress {
  report(message: string, completed?: number, total?: number): void;
}

interface SandboxDiagnosticSink {
  report(diagnostic: {
    readonly code: string;
    readonly message: string;
    readonly details?: SerializableValue;
  }): void;
}

interface SandboxFactsWriter {
  set(key: string, value: SerializableValue): void;
}

interface SandboxCommand {
  (
    sandbox: SandboxCommandTarget,
    context: SandboxCommandContext,
  ): MaybePromise<void>;
}

interface SandboxCommandContext {
  readonly phase: "prepare";
  readonly owner:
    | { readonly kind: "eval"; readonly id: string }
    | { readonly kind: "experiment"; readonly id: string };
  readonly attempt: AttemptRef;
  readonly signal: AbortSignal;
  readonly progress: SandboxProgress;
  readonly diagnostic: SandboxDiagnosticSink;
  readonly facts: SandboxFactsWriter;
  onCleanup(command: SandboxCleanupCommand): void;
}

interface SandboxCleanupContext {
  readonly phase: "cleanup";
  readonly owner: SandboxCommandContext["owner"];
  readonly attempt: AttemptRef;
  readonly signal: AbortSignal;
  readonly diagnostic: SandboxDiagnosticSink;
}

type SandboxCleanupCommand = (
  sandbox: SandboxCommandTarget,
  context: SandboxCleanupContext,
) => MaybePromise<void>;
```

`prepare()` 是普通 Layer 唯一的公开生命周期方法，每条 Attempt 都执行。
命令需要清理时，在本次执行成功取得资源后通过 `context.onCleanup()` 注册；Runner 对已成功注册的 cleanup 按全局准备顺序逆序执行。
声明与资源取得放在同一 command 中，因此未执行或取得失败的命令不会产生虚假的 cleanup。

PLAN-10 没有 `.setup()` / `.teardown()` / `.beforeEach()` / `.afterEach()`、scope option、priority、`dependsOn` 或 layer concat。
绑定完整 Case 的资源由 Provider finalizer 清理；跨 Attempt 状态由 State Feature 清理。

## Root 与 extension

`sandboxLayer()` 只能创建 extension layer：

```typescript
declare function sandboxLayer(): SandboxLayer<"extension">;
```

具体 Provider factory 原子地产生 root layer：

```typescript
interface DockerComposeSandboxOptions {
  readonly file: string | URL;
  readonly workspaceService: string;
  readonly build?: "on-demand" | "prebuilt";
  readonly executionUser?: string;
  readonly env?: Readonly<Record<string, string>>;
}

interface DockerfileSandboxOptions {
  readonly context: string | URL;
  readonly dockerfile?: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
}

interface DockerImageSandboxOptions {
  readonly image: string;
}

interface E2BSandboxOptions {
  readonly template: string;
  readonly lifetimeMs?: number;
}

interface VercelSandboxOptions {
  readonly snapshotId: string;
}

declare function dockerComposeSandbox(
  options: DockerComposeSandboxOptions,
): SandboxLayer<"root">;
declare function dockerfileSandbox(
  options: DockerfileSandboxOptions,
): SandboxLayer<"root">;
declare function dockerImageSandbox(
  options: DockerImageSandboxOptions,
): SandboxLayer<"root">;
declare function e2bSandbox(
  options: E2BSandboxOptions,
): SandboxLayer<"root">;
declare function vercelSandbox(
  options: VercelSandboxOptions,
): SandboxLayer<"root">;
```

root factory 同时声明完整起点并选择 Provider。
共享 `SandboxLayer` 接口不暴露 `.template()`、`.provider()` 或可写 `template` 属性；command 链只保留原 kind，不能把 extension 变成 root，也不能给 root 再追加第二个起点。

Compose root 保存 service、网络、volume、ready、主执行空间与整组 finalizer，不会被压成单容器 image。
`workspaceService` 是 Agent、Eval、文件 API、workdir 与 diff 共同锚定的主 Sandbox。

## Eval 与 Experiment 使用同一个类型

```typescript
interface EvalDef {
  readonly sandbox?: SandboxLayer;
  test(t: TestContext): Promise<void> | void;
}

interface ExperimentDef {
  readonly sandbox?: SandboxLayer;
  readonly agent: Agent;
}
```

省略 `sandbox` 等价于空的 extension layer，但不会提供隐式 root：

```typescript
const omittedSandbox = sandboxLayer();
```

因此作者只在需要 root 或准备命令时写字段。
字段所在位置决定 owner，不表示创建两份 Sandbox。

## Command 形状与 identity

```typescript
interface SerializableCommandOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly root?: boolean;
  readonly stream?: boolean;
  readonly timeout?: number;
  readonly stdin?: string;
}

interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}

interface SuccessfulCommandResult extends CommandOutput {
  readonly exitCode: 0;
}

interface NonZeroCommandResult extends CommandOutput {
  readonly exitCode: number;
}

type CommandResult = SuccessfulCommandResult | NonZeroCommandResult;

interface SandboxFileOperations {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  copyPath(sourcePath: string, targetPath: string): Promise<void>;
}

interface RegisteredSandboxContent {
  readonly [registeredSandboxContentKind]: "file" | "directory";
  readonly digest: string;
}

type SandboxCommandIdentityValue =
  | null
  | boolean
  | number
  | string
  | RegisteredSandboxContent
  | readonly SandboxCommandIdentityValue[]
  | { readonly [key: string]: SandboxCommandIdentityValue };

type StableSandboxCommand = SandboxCommand & {
  readonly [stableSandboxCommandKind]: true;
};

interface SandboxCommandTarget extends SandboxFileOperations {
  readonly workdir: string;
  runCommand(
    command: string,
    args?: readonly string[],
    options?: SerializableCommandOptions,
  ): Promise<SuccessfulCommandResult>;
  runShell(
    script: string,
    options?: SerializableCommandOptions,
  ): Promise<SuccessfulCommandResult>;
  tryCommand(
    command: string,
    args?: readonly string[],
    options?: SerializableCommandOptions,
  ): Promise<CommandResult>;
  tryShell(
    script: string,
    options?: SerializableCommandOptions,
  ): Promise<CommandResult>;
  putContent(content: RegisteredSandboxContent, targetPath: string): Promise<void>;
}

interface SandboxCommandIdentity {
  readonly id: string;
  readonly revision: string;
  readonly inputs: SandboxCommandIdentityValue;
}

declare function command(
  executable: string,
  args?: readonly string[],
  options?: SerializableCommandOptions,
): StableSandboxCommand;

declare function shell(
  script: string,
  options?: SerializableCommandOptions,
): StableSandboxCommand;

declare function defineSandboxCommand(
  identity: SandboxCommandIdentity,
  run: SandboxCommand,
): StableSandboxCommand;

declare function registerSandboxContent(
  source: string | URL,
): RegisteredSandboxContent;
```

`runCommand()` / `runShell()` 对非零退出默认失败；预期非零的探测必须显式使用 `tryCommand()` / `tryShell()`。
timeout、cancel 与 transport failure 始终抛错。

`command()` / `shell()` 由纯数据参数生成稳定 identity。
复杂 callback 只有通过 `defineSandboxCommand({ id, revision, inputs }, run)` 登记所有有效输入时才稳定；直接传入的 callback 一律 opaque，不能命中跨 Run carry。
本地文件或目录先经 `registerSandboxContent()` 取得 digest-backed handle，再放入 command identity。

命令不取得 `stop()` 或 Provider-native SDK，不能创建 sidecar、修改 Case 拓扑、保存 template 或替换主 Sandbox。

## Agent layer

Sandbox Agent Adapter 内部总有一个 extension-only Agent layer。
它在作者两层之后进入同一条准备序列，但它的节点可以是 `AgentProvisioner`，不要求降格为普通 `SandboxCommand`：

```typescript
interface AgentProvisioner {
  readonly name: string;
  readonly targetIdentity: SerializableValue;
  readonly platforms?: readonly string[];
  readonly installMode: string;
  prepare?(context: {
    readonly targetPlatform: string;
    readonly signal: AbortSignal;
  }): MaybePromise<PreparedAgentPayload | undefined>;
  inspect(
    sandbox: SandboxCommandTarget,
    context: AgentProvisionContext,
  ): Promise<AgentInstallInspection>;
  install(
    sandbox: SandboxCommandTarget,
    context: AgentProvisionContext,
  ): Promise<void>;
}

interface AgentProvisionContext {
  readonly attempt: AttemptRef;
  readonly targetPlatform: string;
  readonly preparedPayload?: PreparedAgentPayload;
  readonly signal: AbortSignal;
  readonly facts: SandboxFactsWriter;
}

interface PreparedAgentPayload {
  readonly digest: string;
  readonly content: RegisteredSandboxContent;
}

type AgentInstallInspection =
  | { readonly installed: false; readonly reason: string }
  | {
      readonly installed: true;
      readonly actualIdentity: SerializableValue;
    };

interface AgentSandboxLayer {
  readonly kind: "extension";
  readonly provisioners: readonly AgentProvisioner[];
  install(provisioner: AgentProvisioner): AgentSandboxLayer;
}

interface SandboxAgentDef {
  readonly sandbox?: AgentSandboxLayer;
  // send、runtime setup、teardown 与事件协议省略
}

declare function agentSandboxLayer(): AgentSandboxLayer;
```

Adapter 入口从 `niceeval/adapter` 导出 `agentSandboxLayer()`；Eval / Experiment 作者不需要导入它。

Adapter helper 可以把多个 Agent 安装组件按声明顺序加入该 layer：

```typescript
defineSandboxAgent({
  sandbox: agentSandboxLayer()
    .install(nodeRuntimeProvisioner)
    .install(codexCliProvisioner),
  async send(context, input) {
    // ...
  },
});
```

`AgentProvisioner` 继续拥有：

- 宿主侧 prepare 与 staged payload；
- 目标平台、安装模式和目标 identity；
- inspect、miss 时 install、安装后 reinspect；
- Adapter 专属 facts、诊断与凭据边界。

Runner 只统一顺序与记录 envelope，不把这些字段投影成较弱的 SandboxCommand。
Direct Agent 没有运行中的 Sandbox，也没有 Agent layer；Eval 或 Experiment 为 Direct Agent 声明任何 SandboxLayer 都是 link error。

## 每个配对的静态约束

```text
Eval root      + Experiment extension -> Eval root
Eval extension + Experiment root      -> Experiment root
Eval root      + Experiment root      -> conflict
Eval extension + Experiment extension -> missing
```

这个 XOR 取决于 discovery 与 selector 形成的真实 pair，不能由单个 TypeScript 文件证明。
`niceeval check`、`--dry` 与正常运行必须消费同一个 pair linker。

同一 Run 的不同 pair 可以解析不同 root；`SandboxLayer` 的 kind 品牌只证明单个声明不能伪造或变形，不把“整个 Run 只能有一个 template”写进类型。
