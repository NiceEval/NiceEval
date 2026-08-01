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

`SandboxLayer` 是 **Eval / Experiment 对同一 Sandbox 生命周期的声明层**，不是 Docker image layer，也不是可单独构建的镜像增量。保留 `Layer` 这个词，是因为它表达 owner 与有序组合；物理运行句柄始终叫 `Sandbox`，完整环境单位始终叫 `SandboxCase`。
普通 layer 不能创建第二个 Sandbox、替换 template、增加 sidecar 或停止 Case。

## 作者只学三个规则

1. `dockerComposeSandbox()` / `e2bSandbox()` 等具体 factory 声明 template;`sandboxLayer()` 只声明命令。
2. 一个配对只能有一方带 template。两边都有是 `sandbox.template-conflict`,两边都没有是 `sandbox.template-missing`。
3. template owner 的命令先执行,另一方的命令后执行,Agent 安装最后执行;同一 layer 内按书写顺序执行。

普通 command 只有逐 Attempt 的 `prepare()` 一种频次;开启 Sandbox 复用后也先 reset,再重放完整准备链。
预装或昂贵工具由 prepare command 检查实际版本,命中后快速返回;缺失时安装并复检。
作者因此不必区分窗口级与逐题级两种 scope,也没有放错 scope 造成的复用污染。
完整时序与 fresh / reuse 次数表见 [三方准备时序](lifecycle.md)。

## 导出入口

```typescript
import {
  command,
  defineSandboxCommand,
  dockerComposeSandbox,
  dockerfileSandbox,
  dockerImageSandbox,
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
}
```

`prepare()` 是普通 layer 唯一的公开生命周期方法,每条 Attempt 都执行。
command 链只保留原 kind:不能把 command-only layer 变成 template-bearing,也不能给 template-bearing layer 追加第二个起点。
共享接口不暴露 `.template()`、`.provider()` 或可写 template 属性;起点只能由具体 factory 的 options 声明。

即使 Eval 与 Experiment 声明了物理身份相同的 template,配对仍是 `sandbox.template-conflict`。
删除其中一份会改变 template owner、命令顺序、来源与失败归因,Runner 不能先去重再猜顺序。

## Template-bearing factory

```typescript
interface DockerComposeSandboxOptions {
  readonly file: string | URL;
  readonly workspaceService: string;
  readonly build?: "on-demand" | "prebuilt";
  readonly executionUser?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly credentialEnv?: Readonly<Record<string, {
    readonly value: string;
    readonly revision?: string;
  }>>;
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
  readonly lifetimeMs?: number;
}

declare function dockerComposeSandbox(
  options: DockerComposeSandboxOptions,
): SandboxLayer<"template-bearing">;
declare function dockerfileSandbox(
  options: DockerfileSandboxOptions,
): SandboxLayer<"template-bearing">;
declare function dockerImageSandbox(
  options: DockerImageSandboxOptions,
): SandboxLayer<"template-bearing">;
declare function e2bSandbox(
  options: E2BSandboxOptions,
): SandboxLayer<"template-bearing">;
declare function vercelSandbox(
  options: VercelSandboxOptions,
): SandboxLayer<"template-bearing">;

declare function sandboxLayer(): SandboxLayer<"command-only">;
```

`env` 只放会改变环境语义的非敏感 Compose 插值值，它的值进入 fingerprint。凭据改用
`credentialEnv`：`value` 只交给本次 runtime binding，不进入 plan、record 或 fingerprint；变量名与可选
`revision` 进入身份。凭据选择了不同租户、数据集或权限面时必须更新 `revision`。同一个变量名不能同时出现在
`env` 与 `credentialEnv`。

每个 factory 声明完整起点并选择 Provider:

```text
dockerComposeSandbox({ file, workspaceService }) -> Compose template + Docker Compose Provider
dockerfileSandbox({ context, ... })              -> Dockerfile template + Docker Provider
dockerImageSandbox({ image })                    -> image template + Docker Provider
e2bSandbox({ template })                         -> E2B template + E2B Provider
vercelSandbox({ snapshotId })                    -> snapshot template + Vercel Provider
localSandbox()                                   -> 宿主目录 template + Local Provider
```

原生起点字段必填:`dockerImageSandbox` 必须给 `image`,`e2bSandbox` 必须给 `template`。
没有 provider-only factory、implicit default 或 profile registry;共享起点直接抽成返回 factory 产物的普通 TypeScript helper。
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

对 Sandbox Agent 的配对/link 语义，省略 `sandbox` 按空的 command-only layer 参与解析，
但 Definition 仍保留“省略”这一来源事实，也不会提供隐式 template：

```typescript
const sandboxLinkEquivalent = sandboxLayer();
```

上式只说明 Sandbox Agent 配对时的命令/template 效果，不表示两种作者声明在所有拓扑都同一。
Direct Agent 只允许两侧都省略；作者显式写出 `sandboxLayer()` 仍属于声明了 SandboxLayer，
会按下文报 `sandbox.unexpected-for-direct-agent`。

作者只在需要 template 或准备命令时写字段。
字段所在位置决定 owner,不表示创建两份 Sandbox;Runner 把两层与 Agent 的专用贡献放进同一条准备时间线,只创建一个 Sandbox Case。

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
两组 Eval 混在同一个 selector 里时，矩阵必然出现 conflict 或 missing；不能靠“Eval 覆盖 Experiment”一类优先级静默丢掉某一方声明。

通常做法是让 Experiment 保持 command-only，每个 Eval 显式拥有自己的 template。通用起点用普通 helper 复用，特殊 Eval 直接使用自己的 Compose / image / template。这样同一个 Experiment 仍可横跨混合数据集，A/B 身份不被拆散。

只有实验本身必须拥有起点时，才拆 selector 或拆 Experiment。

```ts
// evals/shared/node24.ts
export const node24 = () => dockerImageSandbox({ image: "node:24@sha256:…" });

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
2. 条件是完整起点的一部分:放进唯一 template factory 或预制产物。
3. 只有部分 Eval / Experiment 组合兼容:拆 selector,形成各自合法的配对图。
4. 两方条件无法现场组合:为该组合提供已经融合双方条件的完整 template,另一方保持 command-only。

融合 template 用普通 TypeScript helper 共享,不新增按配对覆盖的注册表;Runner 不合并两个起点。

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
  readonly root?: boolean;
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
  .prepare(command("apt-get", ["install", "-y", "git"], { root: true }))
  .prepare(shell("pnpm install --frozen-lockfile"));
```

`command()` / `shell()` 由纯数据参数生成稳定 identity,identity 覆盖 executable / script、argv、cwd、env、root 与 stdin。
复杂探测、分支与文件 IO 可以直接写 callback,但直接传入的 callback 一律 opaque:JavaScript 无法证明它没有读取 `process.env`、时间或其它全局状态,Runner 也不用 `Function.prototype.toString()` 或函数名猜闭包。

需要稳定 identity 的 helper 用 `defineSandboxCommand({ id, revision, inputs }, run)` 显式登记,所有动态输入进入 `inputs`。
本地文件或目录先经 `registerSandboxContent()` 取得 digest-backed handle,再放进 `inputs` 并用 `putContent()` 送入 Sandbox。
`putContent()` 对大文件自动拆成有界的 provider 写入,全部到达后才在 Sandbox 内原子替换目标；SDK 单次请求超时不会留下半个目标文件。
任一 opaque command 使整条 Attempt `carryEligible = false`,禁止跨 Run 结果沿用;计划与运行记录都显示具体原因。

源码检出与慢工具安装这两类常见昂贵动作有内置命令(`checkout()` / `installTool()`),自带检查、缓存与稳定 identity,见[内置 prepare 命令](prepare-commands.md)。

### Cleanup

命令需要清理时,在本次执行成功取得资源后调用 `context.onCleanup()` 登记。
Runner 对已成功登记的 cleanup 按全局准备顺序逆序执行;未执行或取得失败的命令不会产生虚假 cleanup。
绑定完整 Case 的资源由 Provider finalizer 清理,跨 Attempt 状态由 State Feature 清理,两者都不走 `onCleanup()`。

## Agent layer

每个 Sandbox Agent Adapter 声明自己的 ensure(目标 identity 加只读 probe);官方 Agent 安装层按 identity 配对,Runner 由两者组装出一个 command-only 的 Agent layer。
它排在两方作者 layer 之后进入同一条准备时间线,但它的节点是 ensure 循环(probe → 缺失才 install → 复检),保留宿主侧 payload prepare、目标平台探测、安装模式与安装事实,不降格成普通 `SandboxCommand`。

Agent layer 由 Runner 组装,没有作者可导入的组装 API;Adapter 与 Eval / Experiment 作者都不手工排列安装组件。
Adapter 不能提供 template 或 Provider;Agent 需要特殊系统起点时,Eval 或 Experiment 必须显式提供兼容 template,link 与 physical planning 用 Adapter 声明的 capability requirement 检查它。
完整协议见 [Agent Ensure](../adapters/architecture/agent-ensure.md)。

## 相关阅读

- [三方准备时序](lifecycle.md) —— owner 顺序、fresh / reuse 次数、身份与错误归属。
- [Sandbox Case](case.md) —— template 之下的完整运行单位:BuildKey / CaseKey、构建协调、Compose。
- [Library](library.md) —— 运行中 Sandbox 的路径、root 用户、超时与自定义 Provider。
- [Sandbox 复用](reuse.md) —— `sandboxReuse` 下的重放、reset 与寿命确认。
- [Agent Ensure](../adapters/architecture/agent-ensure.md) —— Agent layer 的安装协议与事实。
