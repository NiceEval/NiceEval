# Library

## SandboxLayer API

```ts
declare const deploymentCommandBrand: unique symbol;
declare const deploymentStepBrand: unique symbol;
declare const deploymentInputBrand: unique symbol;

interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  deploy(
    command: DeploymentCommand,
    options?: { readonly cache?: "preferred" | "required" },
  ): SandboxLayer<Kind>;
}

interface DeploymentCommand {
  readonly [deploymentCommandBrand]: true;
  readonly id: string;
  readonly behaviorRevision: string;
  readonly recipe: readonly DeploymentRecipeStep[];
  readonly inputs: readonly DeploymentInput[];
}

type DeploymentRecipeStep = DeploymentExecStep | DeploymentShellStep;

interface DeploymentExecStep {
  readonly [deploymentStepBrand]: true;
  readonly type: "exec";
  readonly command: string;
  readonly args: readonly string[];
  readonly inputIds: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

interface DeploymentShellStep {
  readonly [deploymentStepBrand]: true;
  readonly type: "shell";
  readonly script: string;
  readonly inputIds: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

interface RegisteredSandboxContent {
  readonly [deploymentInputBrand]: true;
  readonly type: "content";
  readonly id: string;
  readonly digest: string;
  readonly source: string | URL;
  readonly target: string;
}

interface ResolvableDeploymentInput {
  readonly [deploymentInputBrand]: true;
  readonly type: "resolvable";
  readonly id: string;
  readonly resolverType: string;
  readonly resolverRevision: string;
  readonly request: JsonValue;
}

type DeploymentInput = RegisteredSandboxContent | ResolvableDeploymentInput;

declare function defineDeploymentCommand(input: Omit<DeploymentCommand, typeof deploymentCommandBrand>): DeploymentCommand;
declare function deploymentExec(input: Omit<DeploymentExecStep, typeof deploymentStepBrand | "type">): DeploymentExecStep;
declare function deploymentShell(input: Omit<DeploymentShellStep, typeof deploymentStepBrand | "type">): DeploymentShellStep;
declare function sandboxContent(input: Omit<RegisteredSandboxContent, typeof deploymentInputBrand | "type">): RegisteredSandboxContent;
declare function npmPackageInput(input: {
  readonly id: string;
  readonly package: string;
  readonly version: string;
}): ResolvableDeploymentInput;
```

`DeploymentCommand` 与逐 Attempt 的 `SandboxCommand` 不互相赋值，也没有 callback overload。recipe 只包含结构化 exec 与 shell 操作；函数闭包、当前时间、随机数和未登记子进程变量不能进入 recipe。

`inputIds` 必须逐项引用同一个 command 中存在的 input。Provider 把 `content` input 只读放到 `target`，把 `resolvable` input 的 runtime binding 兑现为同名逻辑 handle。路径冲突、未引用 input、未知 id、重复 id、secret env key 和不规范路径都在 planning 拒绝。

command 必须满足以下条件：

- 对捕获的 Sandbox 状态是确定性的；
- Sandbox 外只读 immutable input，不创建或更新外部资源，也不消费一次性 token；
- 从同一 verified base state 可以安全重试；
- 失败后只允许销毁旧 staging，再从 base state 新建，不在部分修改的 staging 上重跑。

不满足这些条件的工作使用 `.setup()`。

## Input resolution

`RegisteredSandboxContent` 直接携带 canonical digest。`ResolvableDeploymentInput` 由具体 Provider 或扩展创建私有 planning binding，例如 Docker image ref 身份查找器。core 只得到安全、可序列化的 immutable identity；runtime binding 保留临时 locator 与读取能力。

身份查找器的 type、revision、请求值和最终 immutable identity 进入 DeploymentKey。locator 与 credential value 不进入。recipe 只能引用身份查找器产出的逻辑 handle，不能再次查找浮动 ref。

例如 canary tag 在每次 planning 中先查找精确版本与包 digest：

```ts
const candidate = npmPackageInput({
  id: "niceeval",
  package: "niceeval",
  version: "canary",
});

const runtimes = defineDeploymentCommand({
  id: "niceeval-harness-runtimes",
  behaviorRevision: "1",
  inputs: [
    sandboxContent({ id: "runtime-v09", digest: runtimeV09Digest, source: runtimeV09Archive, target: "/opt/runtime/v09.tar" }),
    sandboxContent({ id: "runtime-v012", digest: runtimeV012Digest, source: runtimeV012Archive, target: "/opt/runtime/v012.tar" }),
    candidate,
  ],
  recipe: [
    deploymentShell({
      script: "./sandbox/niceeval-runtime-import.sh",
      inputIds: ["runtime-v09", "runtime-v012", "niceeval"],
    }),
  ],
});

export default defineExperiment({
  sandbox: dockerImage({ context: HARNESS_CONTEXT })
    .deploy(runtimes, { cache: "required" })
    .setup(restoreExperimentCheckpoint),
});
```

`defineExperiment()` 增加可选的 `maxDeploymentConcurrency`：

```ts
interface ExperimentDefinition {
  readonly maxDeploymentConcurrency?: number;
}
```

它必须是正整数，默认 1。CLI `--max-deployment-concurrency` 在本次 Invocation 优先于该值，不改变 DeploymentKey。

tag 仍指向同一 digest 时命中；tag 更新时 DeploymentKey 自动变化。作者不为 canary 关闭缓存。

## Composition

Eval 与 Experiment contribution 沿 template owner → other author 的既有 layer 顺序连接，再保留各 layer 内声明顺序。ordered command identity 与身份查找后的 input 进入 key。只有 Experiment contribution 且 DeploymentBaseKey 相同，可以跨 Eval 共享；Eval contribution 自然使 key 分叉。

同一 `id + behaviorRevision` 对应不同 recipe 或 inputs bytes 是 planning identity collision，不允许后写替换前一项。cache policy 不改变 snapshot 内容，因此不进入 DeploymentKey；它进入 plan、debug 与 Record provenance。

V1 不让 command 直接接受 secret env、argv 或 file。只有 Provider 明确支持、且完全位于 captured storage schema 之外的 ephemeral secret channel 可以参与 input resolution 或只读获取。residue scan 只是纵深防御，不能把普通 secret 注入变成可发布状态。
