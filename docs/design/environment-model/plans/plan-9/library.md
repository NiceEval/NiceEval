# PLAN-9 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 导出入口

所有作者侧 Sandbox 声明从 `niceeval/sandbox` 导出：

```typescript
import {
  command,
  composeSandbox,
  defineSandboxCommand,
  defineSandboxRecipe,
  dockerSandbox,
  dockerSandbox,
  e2bSandbox,
  registerSandboxContent,
  shell,
  vercelSandbox,
  type Sandbox,
  type SandboxCommand,
  type SandboxCommandContext,
  type SandboxCommandTarget,
  type SandboxRecipe,
  type SerializableCommandOptions,
} from "niceeval/sandbox";
```

本方案没有 `niceeval/environment` 作者入口。
运行中的 Sandbox 类型继续从同一模块导出，但它与 SandboxRecipe 是两个不可互换的类型。

## `SandboxRecipe`

```typescript
type SandboxCommandPhase = "setup" | "teardown" | "beforeEach" | "afterEach";
type WindowPhase = "setup" | "teardown";
type AttemptPhase = "beforeEach" | "afterEach";
type SandboxRecipeKind = "command-only" | "template-bearing";
type MaybePromise<T> = T | Promise<T>;

declare const sandboxRecipeKind: unique symbol;
declare const stableSandboxCommandKind: unique symbol;
declare const registeredSandboxContentKind: unique symbol;

interface SandboxRecipe<Kind extends SandboxRecipeKind = SandboxRecipeKind> {
  readonly [sandboxRecipeKind]: Kind;
  setup(command: SandboxCommand<"setup">): SandboxRecipe<Kind>;
  teardown(command: SandboxCommand<"teardown">): SandboxRecipe<Kind>;
  beforeEach(command: SandboxCommand<"beforeEach">): SandboxRecipe<Kind>;
  afterEach(command: SandboxCommand<"afterEach">): SandboxRecipe<Kind>;
}

type SandboxCommand<Phase extends SandboxCommandPhase> =
  Phase extends WindowPhase
    ? SandboxCommandCallback<WindowSandboxCommandContext<Phase>>
    : Phase extends AttemptPhase
      ? SandboxCommandCallback<AttemptSandboxCommandContext<Phase>>
      : never;

type SandboxCommandCallback<Context> = (
  sandbox: SandboxCommandTarget,
  context: Context,
) => MaybePromise<void>;

type SandboxCommandContext<Phase extends SandboxCommandPhase> =
  Phase extends WindowPhase
    ? WindowSandboxCommandContext<Phase>
    : Phase extends AttemptPhase
      ? AttemptSandboxCommandContext<Phase>
      : never;

interface SandboxCommandContextBase<Phase extends SandboxCommandPhase> {
  readonly phase: Phase;
  readonly owner: SandboxCommandOwner;
  readonly signal: AbortSignal;
  readonly progress: SandboxProgress;
  readonly diagnostic: SandboxDiagnosticSink;
  readonly facts: SandboxFactsWriter;
}

interface WindowSandboxCommandContext<Phase extends WindowPhase>
  extends SandboxCommandContextBase<Phase> {
  readonly scope: "window";
}

interface AttemptSandboxCommandContext<Phase extends AttemptPhase>
  extends SandboxCommandContextBase<Phase> {
  readonly scope: "attempt";
  readonly attempt: AttemptRef;
}

type SandboxCommandOwner =
  | { readonly kind: "eval"; readonly id: string }
  | { readonly kind: "experiment"; readonly id: string };

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

declare const nonZeroExitCodeKind: unique symbol;
type NonZeroExitCode = number & { readonly [nonZeroExitCodeKind]: true };

interface NonZeroCommandResult extends CommandOutput {
  readonly exitCode: NonZeroExitCode;
}

type CommandResult = SuccessfulCommandResult | NonZeroCommandResult;

interface SandboxFileOperations {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  copyPath(sourcePath: string, targetPath: string): Promise<void>;
  putContent(content: RegisteredSandboxContent, targetPath: string): Promise<void>;
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

interface SandboxCommandTarget extends SandboxFileOperations {
  readonly workdir: string;
  runCommand(command: string, args?: readonly string[], options?: SerializableCommandOptions):
    Promise<SuccessfulCommandResult>;
  runShell(script: string, options?: SerializableCommandOptions):
    Promise<SuccessfulCommandResult>;
  tryCommand(command: string, args?: readonly string[], options?: SerializableCommandOptions):
    Promise<CommandResult>;
  tryShell(script: string, options?: SerializableCommandOptions): Promise<CommandResult>;
}

type StableSandboxCommand<Phase extends SandboxCommandPhase> =
  SandboxCommand<Phase> & { readonly [stableSandboxCommandKind]: true };

interface StablePhaseAgnosticSandboxCommand {
  <Phase extends SandboxCommandPhase>(
    sandbox: SandboxCommandTarget,
    context: SandboxCommandContext<Phase>,
  ): MaybePromise<void>;
  readonly [stableSandboxCommandKind]: true;
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
): StablePhaseAgnosticSandboxCommand;

declare function shell(
  script: string,
  options?: SerializableCommandOptions,
): StablePhaseAgnosticSandboxCommand;

declare function defineSandboxCommand<Phase extends SandboxCommandPhase>(
  identity: SandboxCommandIdentity,
  run: SandboxCommand<Phase>,
): StableSandboxCommand<Phase>;

declare function registerSandboxContent(
  source: string | URL,
): RegisteredSandboxContent;

interface DockerSandboxOptions {
  readonly source:
    | { readonly type: "image"; readonly image: string }
    | {
        readonly type: "dockerfile";
        readonly context: string | URL;
        readonly file?: string;
        readonly buildArgs?: Readonly<Record<string, string>>;
      };
}

interface E2BSandboxOptions {
  readonly template: string;
  readonly lifetimeMs?: number;
}

interface VercelSandboxOptions {
  readonly snapshotId: string;
}

declare function defineSandboxRecipe(): SandboxRecipe<"command-only">;
declare function composeSandbox(
  options: ComposeSandboxOptions,
): SandboxRecipe<"template-bearing">;
declare function dockerSandbox(
  options: DockerSandboxOptions,
): SandboxRecipe<"template-bearing">;
declare function e2bSandbox(
  options: E2BSandboxOptions,
): SandboxRecipe<"template-bearing">;
declare function vercelSandbox(
  options: VercelSandboxOptions,
): SandboxRecipe<"template-bearing">;
```

Recipe 是不可变声明。
它是 opaque / branded factory 的返回定义值：内部区分 command-only 与 template-bearing 两种状态，四个 command 方法只保留原状态。公开 API 没有 `.template()`、`.provider()`、`.concat()` 或对象字面量入口能在同一 recipe 再加起点。即使 Eval 与 Experiment 声明了 identity 相同的 template，仍是 1×1 conflict，不能去重后猜 ownerOrder。
四个方法使用同一种 SandboxCommand 执行原语，但 phase 是类型参数：

| Scope | 正向方法 | 反向方法 | fresh | reuse |
|---|---|---|---|---|
| Window（fresh Sandbox / 复用周期） | `.setup()` | `.teardown()` | 各一次 | 每复用周期各一次 |
| Attempt | `.beforeEach()` | `.afterEach()` | 各一次 | 每 Attempt 各一次 |

`.setup()` 与 `.beforeEach()` 都按追加顺序执行；`.teardown()` 与 `.afterEach()` 都按追加逆序执行。Runner 另外在 owner 之间执行反向收尾。
同一条链上不同方法的调用位置不会让 lifecycle phase 彼此穿插；方法名决定 command 所在的 phase，声明顺序只在同一方法内生效。
两个 owner 的 command 在能力上没有差别：都只操作已启动 Sandbox 的窄视图，不合成 image、template 或第二个 Sandbox。owner 仅决定顺序、归因与收尾位置。

共享 `SandboxRecipe` 协议只包含 command stack 方法，不包含 `template` 属性。
作者通过具体 factory 的 options 选择起点，Runner 才在内部把它归一成 SandboxTemplate：

```text
composeSandbox({ file, workspaceService }) -> ComposeSandboxTemplate + Docker Compose Provider
dockerSandbox({ source: { type: "dockerfile", context, ... } })        -> DockerfileSandboxTemplate + Docker Provider
dockerSandbox({ source: { type: "image", image } })              -> DockerImageSandboxTemplate + Docker Provider
e2bSandbox({ template })                   -> E2BSandboxTemplate + E2B Provider
vercelSandbox({ snapshotId })              -> VercelSnapshotSandboxTemplate + Vercel Provider
```

因此 `e2bSandbox({ template: "mempal-codex-v3" })` 中的 `template` 只是该 factory 的 provider-native option，不要求与其它 factory 共享字段类型。普通作者不能通过 `recipe.template = ...` 或直接构造对象替换 factory 的归一规则。
每次调用 template-bearing factory 都算一份 template contribution。`dockerSandbox()` 的必填 `source` 明确表达完整起点；不存在 provider-only factory 或隐式 default。

`SandboxCommandContext` 携带 owner、精确 phase、scope、signal、progress、diagnostic 与 facts。Attempt phase 的 `attempt` 必填，Window phase 根本没有该字段；依赖 Attempt 的命令不能误传给 `.setup()` 后才在运行时拿到 `undefined`。inline callback 由调用点推导 phase，不增加标注负担。`AttemptRef` 的完整值进入当前 Attempt fingerprint；callback 不能读取 index 后仍复用另一条 Attempt 的 identity。

Window scope 没有伪造的“当前 Attempt”：其 command activity、facts、耗时与 diagnostic 归 RunningSandboxCase / 复用周期 Record，复用周期内 Attempt 只引用该 Record。attempt scope 的同类证据直接归当前 Attempt。这样 setup 失败或最终 teardown 失败即使发生在 Attempt 边界外，也有稳定归属。

每个 phase 使用自己的 signal。`teardown` / `afterEach` 取得独立 cleanup budget，不能复用已经 abort 的前向 signal；Window context 也不暴露 Attempt index、model 等会让复用周期按借用者分叉的字段。

`SandboxCommandTarget` 保留 workdir、checked command 与 Sandbox 内文件 IO，但没有 `stop()`，也不暴露 Provider-native SDK。它不能新增 service、替换主 Sandbox 或保存新 template；`copyPath()` 的两端都在 Sandbox 内。

host path / URL 传输遵守三条规则：

- source 先经过 `registerSandboxContent()`，由 discovery 读取并登记内容 digest；callback 只接收 manifest-backed handle。
- 稳定命令把 handle 放进 `SandboxCommandIdentity.inputs`。Runner 在 Provider planning 前把它规范化为 source manifest，并折入 command identity、所属 stack identity 与 Attempt fingerprint。
- 直接传入的 callback 若捕获 handle 而未登记 inputs，仍按 opaque 处理。

运行中的完整 `Sandbox` 继续供 `test(t)` 与 Provider 内部使用；它与 `SandboxCommandTarget` 不是同一个能力类型。

`SandboxCommandTarget.runCommand()` / `runShell()` 对非零退出默认抛出携带 `CommandResult` 的 exit error；只有把非零当探测结果时才显式调用 `tryCommand()` / `tryShell()`。try 返回的非零证据标为 `accepted` / `handled`，不污染 failed-command 判据；timeout、cancel 与 transport failure 仍然抛错。这样 setup 的 `await sandbox.runCommand(...)` 不会在 exit 1 后被当成成功。`test(t).sandbox.runCommand()` 继续返回任意 exit code 供断言，不被这项生命周期语义改写。

## Eval 与 Experiment

```typescript
interface EvalDef {
  readonly sandbox?: SandboxRecipe;
  test(t: TestContext): Promise<void> | void;
}

interface ExperimentDef {
  readonly sandbox?: SandboxRecipe;
  readonly agent: Agent;
}
```

两侧故意接受同一个类型。template factory 放在哪个字段，哪一侧就是 template owner；Provider 由这份 template 带出，不固定归 Experiment。

两处 `sandbox` 不表示创建两个 Sandbox。
Runner 把它们与 Agent 的专用 contribution 归一成同一条 owner stack，并只创建一个 Sandbox 实例。

## Pair link 约束

每个 Sandbox Agent 实际选中的 Eval × Experiment 配对遵守同一张表：

| Eval 显式 template | Experiment 显式 template | 结果 |
|---|---|---|
| 有 | 有 | `sandbox.template-conflict`，整个 Run 零 Sandbox 创建 |
| 有 | 无 | Eval template 激活，Eval 是 owner |
| 无 | 有 | Experiment template 激活，Experiment 是 owner |
| 无 | 无 | `sandbox.template-missing`，整个 Run 零 Sandbox 创建 |

这项约束跨越独立模块与动态 Eval selector，不能只靠单文件 `tsc`。Runner 在 discovery 与 selector 求值完成后构造全部 pair plan，并在 fingerprint、build、carry、网络与 Sandbox 创建前聚合全部错误。正常运行和 `--dry` 使用同一份 linked matrix，不在各阶段重新选择 template。

冲突诊断必须同时包含 experiment id、eval id、两边的 owner、factory、template kind、identity 与声明文件，并明确 NiceEval 不会合并或按优先级忽略任一 template。

Direct Agent 没有运行中的 Sandbox；任一侧声明 SandboxRecipe 都是 `sandbox.unexpected-for-direct-agent`，不能像旧 API 那样静默忽略。Experiment selector 匹配零 Eval 默认也是 link error；若未来确需空运行，必须有显式 `allowEmpty`，不能把“什么都没评”报告成成功。

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
当 Experiment 拥有 active template 时，Experiment 与 Eval 的 Window scope setup 先完成；随后每条 Attempt 先执行 Experiment beforeEach，再执行这些 Eval beforeEach。

## Template-bearing recipe

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

`composeSandbox()` 接受 Compose 起点参数并返回 SandboxRecipe；它同时选择 Docker Compose Provider。Compose SandboxTemplate 由 factory 的返回定义值在内部携带，不作为共享 Recipe 属性暴露。
`workspaceService` 对应 Agent、Eval、文件 API、workdir 与 diff 共同使用的主 Sandbox。

### `dockerSandbox()`

```typescript
export default defineEval({
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL(".", import.meta.url),
      file: "Dockerfile",
      buildArgs: { PROFILE: "judge" },
    },
  }),
});
```

Dockerfile 内容、过滤后的 context、build args、基础镜像 digest 与目标平台进入 BuildKey；factory 同时选择 Docker Provider。

### Provider-native template

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" }),
  agent: codexAgent(),
});
```

这里 Experiment 同时选择 E2B template 与 E2B Provider，所以选中的 Eval 必须都是 command-only recipe。MemoryBench 走这条路径。

相同 factory 也可以由 Eval 使用：

```typescript
export default defineEval({
  sandbox: e2bSandbox({ template: "terminal-bench-single-v2" }),
});
```

Terminal-Bench 的多容器 Eval 可以用 `composeSandbox(...)`，单机 Eval 可以用 `e2bSandbox(...)`；同一 Experiment 无需按 Provider 分叉。

`dockerSandbox({ source: { type: "image", image } })`、`e2bSandbox({ template })` 与 `vercelSandbox({ snapshotId })` 的原生起点字段必填。PLAN-9 第一阶段不提供 profile registry、provider-only factory、implicit default 或“第二份 template 的物理替换”。共享起点直接抽成普通 TypeScript 工厂函数，返回对应 factory 的定义值。

若 Experiment command 无法在 Eval template 上执行，该 pair 就不兼容；作者必须让恰好一侧改用已经融合条件的完整 template，不能让 Runner 合并两个起点。

## Provider 与 template factory

`composeSandbox()` 与 `dockerSandbox()` 由 Docker Provider 包提供；`e2bSandbox()` 由 E2B Provider 包提供。普通 Experiment 不注册 source builder，也不选择另一份 Provider。

自定义 Provider 必须连同自己的 template factory 与 planner 一起导出。支持能力与实现不能由每个 Experiment 临时拼成注册表。

## Command 责任

SandboxCommand 的执行频次由声明方法决定。
昂贵安装、运行期能力检查与整窗共享配置适合 `.setup()`；checkout、Fixture 和每题依赖准备适合 `.beforeEach()`。对应的 cleanup 分别放在 `.teardown()` 与 `.afterEach()`。
框架不为它建立 Requirement、inspect 或 install 协议，也不根据预制 template 名猜测某条 command 可以删除。

普通 shell layer 不必写 callback：

```typescript
defineSandboxRecipe()
  .setup(command("apt-get", ["install", "-y", "git"], { root: true }))
  .beforeEach(shell("pnpm install --frozen-lockfile"));
```

`command()` / `shell()` 天然携带纯数据 identity，并使用 checked exit。identity 的效果投影明确包含 executable / script、argv、cwd、env、root 与 stdin；`stream` 只属于观测配置，`timeout` 属于执行政策，两者进入 configHash 与运行 Record，任一变化都不得沿用旧 command carry。options 不接受 `onStdout` / `onStderr` 等函数回调。

复杂探测、分支与文件 IO 可以直接写 callback，但直接传入的 callback 一律 opaque；JavaScript 无法可靠证明它没有读取 `process.env`、时间或其它全局状态。需要稳定 identity 的命令必须用 `defineSandboxCommand({ id, revision, inputs }, run)` 显式登记，所有动态输入与 `RegisteredSandboxContent.digest` 都进入 `inputs`。Runner 不使用 `Function.prototype.toString()`、函数名或所谓 static import closure 猜闭包值。

opaque callback 仍可执行，但 Attempt 不能跨 Run carry；Window command 还会注入 invocation / pair salt，不能跨 pair 或 invocation 共享复用周期。任一 phase 含 opaque command 时，计划明确显示 `carryEligible = false`，不能拿伪稳定哈希命中旧状态。

Agent 安装继续由 AgentProvisioner 拥有。
通用 SandboxCommand 不复制 Agent 的宿主侧 prepare、staged payload、安装模式、平台探测、鉴权、会话与逐 Attempt Agent facts。

## 普通文件传输

`test(t)` 继续使用一套普通 Sandbox API。
本地 URL 上传时，Runner 自动登记 source tree、内容身份、目标与 send 区间；顺序决定 Agent 可见性，send 区间决定 Agent diff 归因。
