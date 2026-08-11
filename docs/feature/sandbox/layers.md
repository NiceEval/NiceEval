# Sandbox Layer —— 起点与准备的作者声明

Eval、Experiment 与 Agent 向同一个主 Sandbox 各贡献一层准备。
Eval 与 Experiment 使用完全相同的公开 `sandbox` 字段和 `SandboxLayer` 类型;Adapter 内部也拥有 Agent layer,但不能提供 template。

对每个实际选中的 `Eval × Experiment` 配对:

- 恰好一方的 layer 是 template-bearing,由具体 Provider factory 构造,携带完整起点并同时选定 Provider;
- 另一方是 command-only layer,只能在已经启动的主 Sandbox 中执行命令;
- Agent layer 始终是 command-only,并且始终排在两方作者 layer 之后;
- template owner 的命令先执行,另一方随后,Agent 最后;作者不能配置 priority、`dependsOn` 或另一套顺序。

```text
one linked pair
  = one template-bearing layer
  + one command-only author layer
  + one Agent layer

prepare order
  = template owner -> other author owner -> Agent
```

template 的唯一性是配对局部约束,一个 Run 可以同时存在多个 template。
同一 Experiment 可以选中分别使用 Compose、E2B 与 Docker image 的多个 Eval;Runner 为矩阵中的每个合法配对分别得到一个 template,再按物理身份共享构建或分配 Case。

`SandboxLayer` 是 **Eval / Experiment 对同一 Sandbox 生命周期的声明层**，不是 Docker image layer，也不是可单独构建的镜像增量。保留 `Layer` 这个词，是因为它表达 owner 与有序组合；物理运行句柄始终叫 `Sandbox`，完整运行单位始终叫 `SandboxCase`。
普通 layer 不能创建第二个 Sandbox、替换 template、增加 sidecar 或停止 Case。

## 作者只学四个规则

1. `dockerComposeSandbox()` / `e2bSandbox()` 等具体 factory 声明 template;`sandboxLayer()` 只声明命令。
2. 一个配对只能有一方带 template。两边都有是 `sandbox.template-conflict`,两边都没有是 `sandbox.template-missing`。
3. template owner 的命令先执行,另一方的命令后执行,Agent 安装最后执行;同一 layer 内按书写顺序执行。
4. 逐 Attempt 的准备使用 `prepare()`；只属于实际 Sandbox 寿命的目录、守护进程或快照使用 `setup()` / `teardown()`，不借此表达调度 lane。

普通 command 只有逐 Attempt 的 `prepare()` 一种频次;开启 Sandbox 复用后也先 reset,再执行完整准备链。物理 Sandbox 生命周期另由显式的 `setup()` / `teardown()` 表达。
预装或昂贵工具由 prepare command 检查实际版本,命中后快速返回;缺失时安装并复检。
作者因此不必区分周期级与逐题级两种 scope,也没有放错 scope 造成的复用污染。
完整时序与 fresh / reuse 次数表见 [三方准备时序](lifecycle.md)。

## 导出入口

```typescript
import {
  command,
  defineSandboxCommand,
  dockerComposeSandbox,
  dockerSandbox,
  dockerSandbox,
  e2bSandbox,
  localSandbox,
  registerSandboxContent,
  sandboxLayer,
  shell,
  vercelSandbox,
  type Sandbox,
  type SandboxCommand,
  type SandboxCommandContext,
  type SandboxCommandTarget,
  type SandboxHook,
  type SandboxHookContext,
  type SandboxLayer,
} from "niceeval/sandbox";
```

`SandboxLayer` 是作者声明;`Sandbox` 是启动后执行命令与文件操作的句柄,两者不可互换。

## `SandboxLayer`

```typescript
type SandboxLayerKind = "template-bearing" | "command-only";
type MaybePromise<T> = T | Promise<T>;

declare const sandboxLayerKind: unique symbol;

interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  readonly [sandboxLayerKind]: Kind;
  prepare(command: SandboxCommand): SandboxLayer<Kind>;
  setup(hook: SandboxHook): SandboxLayer<Kind>;
  teardown(hook: SandboxHook): SandboxLayer<Kind>;
}

interface SandboxHookContext {
  readonly experimentId: string;
  readonly signal: AbortSignal;
  fact(key: string, value: string | number | boolean): void;
  // 另有与当前生命周期绑定的 progress() / diagnostic() 反馈入口。
}

type SandboxHook = (
  sandbox: Sandbox,
  context: SandboxHookContext,
) => MaybePromise<void>;
```

hook 还可经上下文上报绑定当前生命周期的 progress 与 diagnostic；它没有 attempt、session、模型或复用池句柄。

`prepare()` 每条 Attempt 都执行。`setup()` / `teardown()` 则是一对**物理 Sandbox 生命周期** hook：同一个实际 Sandbox 创建并 ready 后只 setup 一次，在它的最后一条 Attempt 收尾、Provider finalizer 前只 teardown 一次。

setup 按声明顺序运行；teardown 按所有 setup 的全局逆序运行。setup 中途失败也仍会进入已登记的 teardown，随后才停止或释放 Provider 资源。

它们附着在配对后的实际 Sandbox 上，不引入 lane、lane id 或可由作者持有的复用池句柄。仅 Experiment 所有的 hook 不改变可共享的物理身份；Eval 所有的 hook 会把该 Eval 的物理生命周期隔离开。
command 链只保留原 kind:不能把 command-only layer 变成 template-bearing,也不能给 template-bearing layer 追加第二个起点。
共享接口不暴露 `.template()`、`.provider()` 或可写 template 属性;起点只能由具体 factory 的 options 声明。

即使 Eval 与 Experiment 声明了物理身份相同的 template,配对仍是 `sandbox.template-conflict`。
删除其中一份会改变 template owner、命令顺序、声明出处与失败归因,Runner 不能先去重再猜顺序。

## Template-bearing factory

```typescript
interface DockerComposeSandboxOptions {
  readonly file: string | URL;
  readonly workspaceService: string;
  readonly build?: "on-demand" | "prebuilt";
  readonly user?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly credentialEnv?: Readonly<Record<string, {
    readonly value: string;
    readonly revision?: string;
  }>>;
}

interface DockerSandboxOptions {
  readonly source:
    | { readonly type: "image"; readonly image: string }
    | {
        readonly type: "dockerfile";
        readonly context: string | URL;
        readonly file?: string;
        readonly buildArgs?: Readonly<Record<string, string>>;
        readonly target?: string;
      };
  readonly user?: string;
  readonly dockerAccess?: DockerSandboxAccess;
  readonly resources?: DockerSandboxResources;
  readonly lifetimeMs?: number;
}

type DockerSandboxAccess =
  | { readonly mode: "socket"; readonly socketPath: string }
  | { readonly mode: "dind"; readonly isolation: "raw-privileged" }
  | {
      readonly mode: "dind";
      readonly isolation: "managed-rootless";
      readonly profile: string;
    };

interface DockerSandboxResources {
  readonly cpus?: number;
  readonly memoryBytes?: number;
  readonly pidsLimit?: number;
  readonly readOnlyRootfs?: boolean;
  readonly tmpfs?: Readonly<Record<string, {
    readonly sizeBytes: number;
    readonly mode?: number;
    readonly uid?: number;
    readonly gid?: number;
  }>>;
}

interface E2BSandboxOptions {
  readonly template: string;
  readonly user?: string;
  readonly lifetimeMs?: number;
}

interface VercelSandboxOptions {
  readonly snapshotId: string;
  readonly lifetimeMs?: number;
}

declare function dockerComposeSandbox(
  options: DockerComposeSandboxOptions,
): SandboxLayer<"template-bearing">;
declare function dockerSandbox(
  options: DockerSandboxOptions,
): SandboxLayer<"template-bearing">;
declare function e2bSandbox(
  options: E2BSandboxOptions,
): SandboxLayer<"template-bearing">;
declare function vercelSandbox(
  options: VercelSandboxOptions,
): SandboxLayer<"template-bearing">;

declare function sandboxLayer(): SandboxLayer<"command-only">;
```

`user` 替换整个 Sandbox 的默认执行身份,省略时沿用起点声明的身份;语义与各 provider 的支持面见 [Library · 执行身份](library.md#执行身份),值进入 fingerprint。

Docker image/Dockerfile 还可声明结构化 `resources`与 `dockerAccess`。socket、raw privileged DinD和
managed rootless DinD是不可互相降级的判别分支；完整边界见 [Library · Docker access](library.md#docker-access)。

`env` 只放会改变运行时语义的非敏感 Compose 插值值，它的值进入 fingerprint。凭据改用
`credentialEnv`：`value` 只交给本次 runtime binding，不进入 plan、record 或 fingerprint；变量名与可选
`revision` 进入身份。凭据选择了不同租户、数据集或权限面时必须更新 `revision`。同一个变量名不能同时出现在
`env` 与 `credentialEnv`。

每个 factory 声明完整起点并选择 Provider:

```text
dockerComposeSandbox({ file, workspaceService }) -> Compose template + Docker Compose Provider
dockerSandbox({ source: { type: "dockerfile", context, ... } }) -> Dockerfile template + Docker Provider
dockerSandbox({ source: { type: "image", image } })              -> image template + Docker Provider
e2bSandbox({ template })                         -> E2B template + E2B Provider
vercelSandbox({ snapshotId })                    -> snapshot template + Vercel Provider
localSandbox()                                   -> 宿主目录 template + Local Provider
```

原生起点字段必填：`dockerSandbox` 必须给出带 `type` 的 `source`，`e2bSandbox` 必须给 `template`。
没有 provider-only factory、implicit default 或 profile registry;共享起点直接抽成返回 factory 定义值的普通 TypeScript 函数。
`e2bSandbox({ template })` 中的 `template` 只是该 factory 的 provider-native option,不同 factory 之间不共享字段类型。

Compose template 保存 service、网络、volume、ready、主执行空间与整组 finalizer,不会被压成单容器 image。
`workspaceService` 指明 Agent、Eval、文件 API、workdir 与 diff 共同锚定的主 Sandbox。
`localSandbox()` 的安全边界与限制见[本地执行](local.md)。

## Eval 与 Experiment 使用同一个类型

```typescript
interface EvalInput {
  readonly sandbox?: SandboxLayer;
  test(t: TestContext): Promise<void> | void;
}

interface ExperimentInput {
  readonly sandbox?: SandboxLayer;
  readonly agent: Agent;
}
```

对 Sandbox Agent 的配对/link 语义，省略 `sandbox` 按空的 command-only layer 参与配对，
但 Definition 仍保留“省略”这一声明事实，也不会提供隐式 template：

```typescript
const sandboxLinkEquivalent = sandboxLayer();
```

上式只说明 Sandbox Agent 配对时的命令/template 效果，不表示两种作者声明在所有拓扑都同一。
Direct Agent 只允许两侧都省略；作者显式写出 `sandboxLayer()` 仍属于声明了 SandboxLayer，
会按下文报 `sandbox.unexpected-for-direct-agent`。

作者只在需要 template 或准备命令时写字段。
字段所在位置决定 owner,不表示创建两份 Sandbox;Runner 把两层与 Agent 的专用贡献放进同一条准备时间线,只创建一个 Case。

Terminal-Bench 的 Eval 携带 template:

```typescript
export default defineEval({
  sandbox: dockerComposeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
  }),
  async test(t) {
    await t.send("完成任务。");
  },
});
```

Experiment 没有额外命令时省略 `sandbox`:

```typescript
export default defineExperiment({
  agent: codexAgent(),
  evals: ["terminal-bench/"],
});
```

MemoryBench 反向:Experiment 携带 template,Eval 只准备题目:

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "mempal-codex-v3" })
    .prepare(installTool({
      tool: "mempal",
      identity: { version: "0.9.0" },
      probe: shell("mempal --version | grep -q 0.9.0"),
      install: shell("curl -fsSL https://get.mempal.dev | sh"),
    })),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  sandbox: sandboxLayer().prepare(checkoutLockedRepository),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
  },
});
```

## 每个配对的 link 约束

| Eval layer | Experiment layer | 结果 |
|---|---|---|
| template-bearing | command-only | Eval 是 template owner |
| command-only | template-bearing | Experiment 是 template owner |
| template-bearing | template-bearing | `sandbox.template-conflict`,不生成配对 |
| command-only | command-only | `sandbox.template-missing`,不生成配对 |

这个约束取决于 discovery 与 selector 形成的真实配对,单个 TypeScript 文件无法证明。
Runner 在 discovery 与 Experiment selector 完成后,为每一条实际选中的边执行上表检查;任一配对非法时聚合全部错误,整个 Run 保持零 Provider I/O、零构建、零 Sandbox 创建。

```text
discovery + selection
  -> pure link(全矩阵 template 检查)
  -> Provider 只读 physical / network planning
  -> fingerprint
  -> build / Sandbox create
```

`niceeval check <experiment>` 在 pure link 后停止,零 Provider 文件读取与网络请求。
`--dry` 与正常运行消费同一份 linked matrix,在 fingerprint 后停止;三者不各自重算 template 选择。

### ProviderModule 与完成态 plan

每个 template factory 私下绑定一个泛型 `ProviderModule<Plan>`。
`Plan` 是该 provider 自己的完整 typed 运行计划。
Compose、Dockerfile、E2B 等互不共享 `adapter: string + input: JsonValue` 信封。

factory 完成 planning 后，用闭包把 `Plan` 与 module 一起绑定到公开 `SandboxProviderPlan`。
core 只取得已经消去泛型的 materialize / build closure。
core 不读取 provider 私有字段，也不按 provider 名或 adapter 字符串分支。

公开 plan 是不可伪造的冻结完成态。
它一次带齐 target、scheduling、capabilities、carry 与稳定 identity。
会改变调度或生命周期的事实全部进入 identity。
凭据值与 callback 只留在私有 binding，不能被 record 或 fingerprint 原样泄露。
动态构造的假对象没有 binding，运行边界返回 typed `sandbox.provider-binding-missing`。
运行边界不会回退到猜测或兼容路径。

每条边从 `(experimentId, evalId)` tuple 派生身份。
id 含紧凑分隔符时切换到无碰撞编码，不从结果字符串猜边界。
同一 tuple 重复出现是 `sandbox.duplicate-run-pair` typed link failure。
Map 的后写值不能静默改写先写值。

人类错误至少给出可直接修改的两处声明:

```text
sandbox.template-conflict: Experiment "memory/codex" and
Eval "terminal-bench/play-zork-easy" both declare a template

  eval:       dockerComposeSandbox(...) at evals/.../eval.ts
  experiment: e2bSandbox({ template: "mempal-codex-v3" }) at experiments/codex.ts

NiceEval starts one Sandbox Case and does not merge or prioritize templates.
Remove one template or split the Experiment's Eval selection.
17 conflicting pairs were found. No Sandbox was created.
```

Direct Agent 没有运行中的 Sandbox;任一侧为它声明 SandboxLayer 都是 `sandbox.unexpected-for-direct-agent`。
missing 的配对必须补 template 或修改 selector,不能借相邻配对的 template 补位。

### 混合矩阵的结构约束

一个 Experiment 自己带 template 时,它选中的每个 Eval 都必须是 command-only。
一个 Experiment 是 command-only 时,它选中的每个 Eval 都必须带 template。
两组 Eval 混在同一个 selector 里时，矩阵必然出现 conflict 或 missing；不能靠“Eval 优先于 Experiment”一类优先级静默丢掉某一方声明。

通常做法是让 Experiment 保持 command-only，每个 Eval 显式拥有自己的 template。通用起点用普通函数复用，特殊 Eval 直接使用自己的 Compose / image / template。这样同一个 Experiment 仍可横跨混合数据集，A/B 身份不被拆散。

只有实验本身必须拥有起点时，才拆 selector 或拆 Experiment。

```ts
// evals/shared/node24.ts
export const node24 = () => dockerSandbox({ source: { type: "image", image: "node:24@sha256:…" } });

// 通用 Eval
export default defineEval({ sandbox: node24(), async test(t) { /* ... */ } });

// 特殊 Compose Eval
export default defineEval({
  sandbox: dockerComposeSandbox({ file: new URL("compose.yaml", import.meta.url), workspaceService: "app" }),
  async test(t) { /* ... */ },
});

// 同一个对照实验不带 template，仍可选择两类 Eval
export default defineExperiment({ agent: codexAgent(), evals: ["generic/", "compose/"] });
```

## 顺序与依赖方向

每条 Attempt 的准备顺序由 template owner 完全决定:

```text
templateOwner = eval
  Eval commands -> Experiment commands -> agent.ensure 循环

templateOwner = experiment
  Experiment commands -> Eval commands -> agent.ensure 循环
```

每个作者 layer 内按 `.prepare()` 的追加顺序串行执行。
Runner 不从命令文本、路径、包管理器或 Provider 名推导依赖,也不自动并行。

依赖方向是公开契约:

- template owner 的 command 只能依赖自己的 template 已经提供的能力;
- 第二个作者 layer 可以依赖 template owner 的命令结果;
- Agent layer 的 ensure 循环可以依赖两方作者准备;
- 前层不能依赖后层尚未产生的结果,重试等待后层出现也不是合法解决方案。

发现反向依赖时按下面顺序修正:

1. 条件本来属于后一个 owner:移动 command 所有权。
2. 条件是完整起点的一部分:放进唯一 template factory 或预制实例。
3. 只有部分 Eval / Experiment 组合兼容:拆 selector,形成各自合法的配对图。
4. 两方条件无法现场组合:为该组合提供已经融合双方条件的完整 template,另一方保持 command-only。

融合 template 用普通 TypeScript 函数共享,不新增按配对替换的注册表;Runner 不合并两个起点。

## Command 形状与 identity

```typescript
interface SandboxCommand {
  (
    sandbox: SandboxCommandTarget,
    context: SandboxCommandContext,
  ): MaybePromise<void>;
}

interface SandboxCommandContext {
  readonly phase: "prepare" | "agent.post-setup" | "agent.pre-teardown";
  readonly owner:
    | { readonly kind: "eval"; readonly id: string }
    | { readonly kind: "experiment"; readonly id: string }
    | { readonly kind: "agent"; readonly id: string };
  readonly attempt: AttemptRef;
  readonly signal: AbortSignal;
  readonly progress: SandboxProgress;
  readonly diagnostic: SandboxDiagnosticSink;
  readonly facts: SandboxFactsWriter;
  onCleanup(command: SandboxCleanupCommand): void;
}

type SandboxProgress = (update: {
  readonly message: string;
  readonly current?: number;
  readonly total?: number;
}) => void;
type SandboxDiagnosticSink = (input: DiagnosticInput) => void;
type SandboxFactsWriter = (key: string, value: string | number | boolean) => void;
type SandboxCleanupCommand = (
  sandbox: SandboxCommandTarget,
  context: Omit<SandboxCommandContext, "onCleanup">,
) => MaybePromise<void>;

interface AttemptRef {
  readonly id: string;
  readonly index: number;
}

interface SandboxCommandTarget extends SandboxOperations {
  copyPath(sourcePath: string, targetPath: string): Promise<void>;
  putContent(content: RegisteredSandboxContent, targetPath: string): Promise<void>;
}
```

`SandboxCommandTarget` 是运行中主 Sandbox 的窄视图。
它没有 `stop()`,不暴露 Provider-native SDK,`copyPath()` 的两端都在 Sandbox 内;命令不能创建 sidecar、修改 Case 拓扑、保存新 template 或替换主 Sandbox。

同名方法与 `t.sandbox`、完整 `Sandbox` 的语义完全相同。`runCommand()` / `runShell()` 返回任意 exit code；checked 调用显式使用 `runCommandOrThrow()` / `runShellOrThrow()`。

timeout、cancel 与 transport failure 始终 reject。完整签名只在[操作 Sandbox](library/operations.md)定义，不在 layer 再造一套 `SerializableCommandOptions`。

### 稳定 identity 与 opaque callback

```typescript
interface SandboxCommandIdentity {
  readonly id: string;
  readonly revision: string;
  readonly inputs: SandboxCommandIdentityValue;
}

/** 可进入稳定 command identity 的 CommandOptions 子集；函数、signal 与运行时回调不在其中。 */
interface SandboxCommandOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly user?: string;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

interface RegisteredSandboxContent {
  readonly digest: string;
  readonly kind: "file" | "directory";
}

declare function command(
  executable: string,
  args?: readonly string[],
  options?: SandboxCommandOptions,
): StableSandboxCommand;

declare function shell(
  script: string,
  options?: SandboxCommandOptions,
): StableSandboxCommand;

declare function defineSandboxCommand(
  identity: SandboxCommandIdentity,
  run: SandboxCommand,
): StableSandboxCommand;

declare function registerSandboxContent(
  source: string | URL,
): RegisteredSandboxContent;
```

普通 shell 步骤不必写 callback:

```typescript
sandboxLayer()
  .prepare(command("apt-get", ["install", "-y", "git"], { user: "root" }))
  .prepare(shell("pnpm install --frozen-lockfile"));
```

`command()` / `shell()` 由纯数据参数生成稳定 identity,identity 涵盖 executable / script、argv、cwd、env、user 与 stdin。
复杂探测、分支与文件 IO 可以直接写 callback。JavaScript 无法可靠提取它读取的 `process.env`、时间或其它闭包状态，因此直接 callback 不向 fingerprint 增加 identity；Runner 也不用 `Function.prototype.toString()` 或函数名猜闭包。

需要稳定 identity 的自定义步骤用 `defineSandboxCommand({ id, revision, inputs }, run)` 显式登记,所有动态输入进入 `inputs`。
本地文件或目录先经 `registerSandboxContent()` 取得 digest-backed handle,再放进 `inputs` 并用 `putContent()` 送入 Sandbox。

`run` 的函数体、函数名与闭包不进入 identity。只改实现而保持 `id`、`revision`、`inputs` 不变时,Runner 不会发现语义已经变化,旧结果仍可能沿用。实现语义变化必须提高 `revision`;外部输入变化必须反映到 `inputs`。若作者漏改 identity 后已经产生或沿用了结果,先修正 `revision` 或 `inputs`,再按[全量重验](../experiments/use-case/重新运行/全量重验.md)对受影响选择执行 `--rerun all`。`--rerun all` 只修复这一次结果集,不能替代永久 identity 修正。

`putContent()` 对大文件自动拆成有界的 provider 写入,全部到达后才在 Sandbox 内原子替换目标；SDK 单次请求超时不会留下半个目标文件。
未登记 identity 的 callback 默认允许跨 Run 携带，避免一个声明遗漏让昂贵 Attempt 永久重跑。这个默认只代表 callback 没有增加失效条件，不代表 Runner 已证明其语义稳定。
Provider 的声明 identity、BuildKey 或 opaque marker 直接进入 fingerprint，不再额外保存或判定 provider carry eligibility。

源码检出与慢工具安装这两类常见昂贵动作有内置命令(`checkout()` / `installTool()`),自带检查、缓存与稳定 identity,见[内置 prepare 命令](prepare-commands.md)。

### Cleanup

命令需要 cleanup 时,在本次执行成功取得资源后调用 `context.onCleanup()` 登记。
Runner 对已成功登记的 cleanup 按全局准备顺序逆序执行;未执行或取得失败的命令不会产生虚假 cleanup。
绑定完整 Case 的资源由 Provider finalizer 回收；属于该物理 Sandbox 的持久路径，以及跨 run checkpoint 的恢复与回存，都由 `setup()` / `teardown()` 成对处理；三者都不走 `onCleanup()`。

## Agent layer

每个 Sandbox Agent Adapter 声明自己的 ensure(目标 identity 加只读 探测);官方 Agent 安装层按 identity 配对,Runner 由两者组装出一个 command-only 的 Agent layer。
它排在两方作者 layer 之后进入同一条准备时间线,但它的节点是 ensure 循环(探测 → 缺失才 install → 复检),保留宿主侧 payload prepare、目标平台探测、安装模式与安装事实,不降格成普通 `SandboxCommand`。

Agent layer 由 Runner 组装,没有作者可导入的组装 API;Adapter 与 Eval / Experiment 作者都不手工排列安装组件。
Adapter 不能提供 template 或 Provider;Agent 需要特殊系统起点时,Eval 或 Experiment 必须显式提供兼容 template,link 与 physical planning 用 Adapter 声明的 capability requirement 检查它。
完整协议见 [Agent Ensure](../adapters/architecture/agent-ensure.md)。

## 相关阅读

- [三方准备时序](lifecycle.md) —— owner 顺序、fresh / reuse 次数、身份与错误归属。
- [Case](case.md) —— template 之下的完整运行单位:BuildKey / CaseKey、构建协调、Compose。
- [Library](library.md) —— 运行中 Sandbox 的路径、执行身份、超时与自定义 Provider。
- [Sandbox 复用](reuse.md) —— `sandboxReuse` 下的重新执行、reset 与寿命确认。
- [Agent Ensure](../adapters/architecture/agent-ensure.md) —— Agent layer 的安装协议与事实。
