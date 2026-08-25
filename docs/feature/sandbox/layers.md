# Sandbox Layer —— 起点与准备的作者声明

Eval、Experiment 与 Agent 向同一个主 Sandbox 各贡献一层准备。
Eval 与 Experiment 使用完全相同的公开 `sandbox` 字段和 `SandboxLayer` 类型;Adapter 内部也拥有 Agent layer,但不能提供 template。

对每个实际选中的 `Eval × Experiment` 配对:

- 恰好一方的 layer 是 template-bearing,由具体 Provider factory 构造,携带完整起点并同时选定 Provider;
- 另一方是 command-only layer,只能在已经启动的主 Sandbox 中执行命令;
- Agent layer 始终是 command-only,并与其它 owner 进入同一个 ready set；数值更小的 Agent action 可以先于 Experiment、Eval Group 或 Eval action;
- 每个 occurrence 内跨 owner 建立依赖 DAG；依赖满足后，从 ready set 选择最小 `changeFrequency`；after 按实际登记栈逆序退出。

```text
one linked pair
  = one template-bearing layer
  + one command-only author layer
  + one Agent layer

before order
  = dependencies
  -> lowest normalized changeFrequency
  -> experiment / eval-group / eval / agent
  -> stable owner id
  -> owner-local ordinal

after order
  = actual registration stack in reverse
```

template 的唯一性是配对局部约束,一个 Run 可以同时存在多个 template。
同一 Experiment 可以选中分别使用 Compose、E2B 与 Docker image 的多个 Eval;Runner 为矩阵中的每个合法配对分别得到一个 template,再按物理身份共享构建或分配 Case。

`SandboxLayer` 是 **Eval / Experiment 对同一 Sandbox 生命周期的声明层**，不是 Docker image layer，
也不是可单独构建的镜像增量。保留 `Layer` 这个词，是因为它表达 owner 与有序组合；物理运行句柄始终叫
`Sandbox`，完整运行单位始终叫 `SandboxCase`。

普通 layer 不能声明第二个 Sandbox、替换 template、改变 NiceEval 管理的 SandboxCase 拓扑或停止 Case。
可信的 provider-specific callback 可以取得不属于 Case 的 Attempt 级宿主辅助资源；它必须在取得资源后立即用
`context.onCleanup()` 登记回收，并保持为 opaque cache barrier。

## 作者只学四个规则

1. `dockerComposeSandbox()` / `e2bSandbox()` / `incusSandbox()` 等具体 factory 声明 template;`sandboxLayer()` 与 `sandboxRequirements()` 只声明命令。
2. 一个配对只能有一方带 template。两边都有是 `sandbox.template-conflict`,两边都没有是 `sandbox.template-missing`。
3. Experiment、Eval Group、Eval、Agent 使用同一种 `before()` / `after()`；owner 只保留声明出处与归因。
4. before 按依赖与数值排队。成功取得资源后用 `context.onCleanup()` 登记释放；无条件 after 在入口登记，所有收尾按实际登记栈逆序退出。

声明式 before action 可以形成缓存前缀。callback before、secret、租约与外部会话始终真实执行，并截断后续共享捕获。after 始终真实执行。完整资格、`verified` 边界与 Provider 降级见 [Architecture](architecture.md#准备前缀的身份与验证边界)。

当前 occurrence 固定为 `attempt`。作者 API 不暴露 scope，也不能靠 owner kind 或低频数值要求提升。把已证明稳定的前缀提升到 physical-instance 是后续性能工作，不属于当前 capability。
完整时序与 fresh / reuse 次数表见 [三方准备时序](lifecycle.md)。

## 导出入口

```typescript
import {
  changeFrequency,
  command,
  defineSandboxAction,
  defineSandboxCommand,
  dockerComposeSandbox,
  dockerSandbox,
  e2bSandbox,
  gitCheckout,
  incusSandbox,
  sandboxContent,
  sandboxLayer,
  sandboxRequirements,
  sandboxStep,
  shell,
  uploadDirectory,
  uploadFile,
  vercelSandbox,
  writeBytes,
  writeText,
  type Sandbox,
  type SandboxCommand,
  type SandboxCommandContext,
  type SandboxCommandTarget,
  type SandboxLayer,
  type SandboxAction,
  type SandboxActionFamily,
  type SandboxAfterAction,
  type SandboxStep,
  type CommandActionOptions,
  type ShellActionInput,
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
  before(action: SandboxAction | SandboxCommand): SandboxLayer<Kind>;
  after(action: SandboxAfterAction | SandboxCleanupCommand): SandboxLayer<Kind>;
}
```

直接传给 `before()` 的 callback 就是 `SandboxCommand`。它取得 `SandboxCommandTarget` 与 `SandboxCommandContext`；上下文包含当前 attempt、progress、diagnostic 和 `onCleanup()`，不包含 session、模型或复用池句柄。

link 给每个 attachment 编译 attempt occurrence，结果进入 identity 与 debug。作者不能手写 scope 或取得 pool 句柄。physical-instance promotion 是后续性能工作，不能从当前声明推断已经发生。

拥有可用 Sandbox 的 occurrence 进入后，Runner 按稳定 declaration key 登记 standalone after。callback before 与 `defineSandboxCommand()` 始终真实执行并截断后续共享捕获；成功取得资源后可同步调用 `context.onCleanup()`，把本次 invocation 的释放动作立即压入同一栈。所有已登记项按全局 LIFO 使用独立 cleanup signal，失败后继续收尾；after 即使使用 exact command 也不缓存。

`onCleanup()` 只能在登记它的 callback 尚未 settle 时调用，返回 `void`，cleanup 内不能再次登记 cleanup。callback 后续失败或取消不撤销已登记项。每次 attempt invocation 都拥有独立 registry；定义级对象不保存 handle。standalone after 必须能在任意后续 before 未执行或失败时安全运行，因此它只能表达无条件、幂等 finally，不能释放依赖成功 acquire 的资源。

它们附着在配对后的实际 Sandbox 上，不引入 lane、lane id 或可由作者持有的复用池句柄。

Plugin 自动投影的 Sandbox fragment 遵守同一条 owner 规则，并与四类 owner 的 action 进入同一个 DAG；它不会创建另一套生命周期 DSL。
before/after 链只保留原 kind:不能把 command-only layer 变成 template-bearing,也不能给 template-bearing layer 追加第二个起点。
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
  readonly resources?: DockerSandboxResources;
  readonly lifetimeMs?: number;
}

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

interface SandboxRequirementsOptions {
  readonly docker?: DockerExecutionRequirement;
}

interface DockerExecutionRequirement {
  readonly api: "docker/v1";
  readonly compose: "v2" | "not-required";
  readonly isolation: "dedicated-kernel/v1";
  readonly minimumDataBytes: number;
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
declare function incusSandbox(
  options: IncusSandboxOptions,
): SandboxLayer<"template-bearing">;

declare function sandboxLayer(): SandboxLayer<"command-only">;
declare function sandboxRequirements(
  options: SandboxRequirementsOptions,
): SandboxLayer<"command-only">;
```

`sandboxRequirements()` 与 `incusSandbox()` 的字段语义、capability receipt 与 identity 单源在
[Nested Docker Library](nested-docker/library.md)。

`user` 替换整个 Sandbox 的默认执行身份,省略时沿用起点声明的身份;语义与各 provider 的支持面见 [Library · 执行身份](library.md#执行身份),值进入 fingerprint。

Docker image/Dockerfile 还可声明结构化 `resources`。
Agent 要在 Sandbox 内使用 Docker API 时，Eval 写 `sandboxRequirements()`，Experiment 写 `incusSandbox()`；
完整契约见 [Nested Docker](nested-docker/README.md)。
`dockerAccess` 的 socket / raw / managed DinD 不是 adopted nested-Docker public path，也不能降为 fallback。

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
incusSandbox({ image, project, storagePool })    -> Incus VM template + Incus Provider
sandboxRequirements({ docker })                  -> command-only nested Docker requirement
```

原生起点字段必填：`dockerSandbox` 必须给出带 `type` 的 `source`，`e2bSandbox` 必须给 `template`。
没有 provider-only factory、implicit default 或 profile registry;共享起点直接抽成返回 factory 定义值的普通 TypeScript 函数。
`e2bSandbox({ template })` 中的 `template` 只是该 factory 的 provider-native option,不同 factory 之间不共享字段类型。

Compose template 保存 service、网络、volume、ready、主执行空间与整组 finalizer,不会被压成单容器 image。
`workspaceService` 指明 Agent、Eval、文件 API、workdir 与 diff 共同锚定的主 Sandbox。

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
    .before(shell({
      id: "install-mempal",
      command: "mempal --version | grep -q '^0.9.0$' || (npm install -g mempal@0.9.0 && mempal --version | grep -q '^0.9.0$')",
      changeFrequency: changeFrequency.rare,
    })),
  agent: codexAgent(),
});
```

```typescript
export default defineEval({
  sandbox: sandboxLayer().before(checkoutLockedRepository),
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
core 只取得已经消去泛型的 Sandbox create / Provider build closure。
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

template owner 只提供 Provider 起点，不参与 action 排序。每种 occurrence 都把四类 owner 的 before 放进同一张依赖 DAG。planning 先满足依赖，再从 ready set 选择规范化 `changeFrequency` 最小的 action。

`changeFrequency` 必须是有限非负 `number`。`-0` 规范化为 `0`，小数合法，省略时为 `normal = 100`。负数、`NaN` 与无穷在 planning 失败。数值相同时固定按 `experiment → eval-group → eval → agent`，再按稳定 owner id 与 owner 内 ordinal 排序。发现时机、对象枚举顺序和并发完成顺序都不能参与 tie-break。

```typescript
declare const changeFrequency: {
  readonly rare: 10;
  readonly normal: 100;
  readonly frequent: 1_000;
};
```

这些常量只提高可读性。作者可以使用任意合法小数；常量名称不进入 identity，规范化后的数值进入。

`dependsOn` 与具名 `provides` / `requires` capability 形成边。普通 inputs 只参与 identity、缓存资格与 occurrence 编译，不形成边。缺失 action、重复 capability provider、跨 occurrence 依赖或循环在 Provider I/O 前报错。
Runner 不从命令文本、路径、包管理器或 Provider 名推导依赖,也不自动并行。

依赖方向是公开契约:

- action 只能依赖同一 occurrence 中显式可见的 action 或 capability;
- owner 不自动产生依赖边，Eval Group 的低频 action 可以排在 Experiment 高频 action 前;
- Agent ensure 与 runtime 只在全部 attempt before 满足后开始;
- 前层不能依赖后层尚未产生的结果,重试等待后层出现也不是合法解决方案。

发现反向依赖时按下面顺序修正:

1. 条件本来属于后一个 owner:移动 action 所有权。
2. 条件是完整起点的一部分:放进唯一 template factory 或预制实例。
3. 只有部分 Eval / Experiment 组合兼容:拆 selector,形成各自合法的配对图。
4. 多方条件无法由 action DAG 组合:为该组合提供已经融合条件的完整 template,其它 owner 保持 command-only。

融合 template 用普通 TypeScript 函数共享,不新增按配对替换的注册表;Runner 不合并两个起点。

## Action family 与 Step

`SandboxAction` 是可缓存声明式准备的实例，不是 Plugin。作者用 `defineSandboxAction()` 定义可复用 family，再在 `.before()` 中直接实例化。family 只组合 NiceEval 提供的封闭 `SandboxStep`，不能取得运行中的 Sandbox，也不能接收任意 callback。

```typescript
import { Schema } from "effect";
import {
  defineSandboxAction,
  sandboxState,
  sandboxStep,
} from "niceeval/sandbox";

type SandboxState =
  (typeof sandboxState)[keyof typeof sandboxState];

type NonEmptySandboxSteps =
  readonly [SandboxStep, ...SandboxStep[]];

interface SandboxActionDefinition<A, I extends JsonValue> {
  readonly id: string;
  readonly input: Schema.Schema<A, I, never>;
  readonly cache?: {
    readonly state?: SandboxState;
    readonly fingerprint?: JsonValue | ((input: A) => JsonValue);
  };
  readonly steps: (input: A) => NonEmptySandboxSteps;
}

interface SandboxBeforeActionOptions {
  readonly id: string;
  readonly changeFrequency?: number;
  readonly dependsOn?: readonly SandboxActionRef[];
  readonly requires?: readonly SandboxCapability[];
  readonly provides?: readonly SandboxCapability[];
  readonly cache?: {
    readonly state?: SandboxState;
    readonly fingerprint?: JsonValue;
  };
}

interface SandboxActionInstanceOptions
  extends Omit<SandboxBeforeActionOptions, "id"> {
  readonly id?: string;
}

interface SandboxAfterActionOptions {
  readonly id: string;
}

interface SandboxActionFamily<A> {
  (input: A, options?: SandboxActionInstanceOptions): SandboxAction;
  readonly after: (
    input: A,
    options?: Partial<SandboxAfterActionOptions>,
  ) => SandboxAfterAction;
}

declare function defineSandboxAction<A, I extends JsonValue>(
  definition: SandboxActionDefinition<A, I>,
): SandboxActionFamily<A>;

declare const sandboxStep: {
  exec(input: ExecSandboxStepInput): SandboxStep;
  putText(input: PutTextSandboxStepInput): SandboxStep;
  putBytes(input: PutBytesSandboxStepInput): SandboxStep;
  transferFile(input: TransferFileSandboxStepInput): SandboxStep;
  transferDirectory(input: TransferDirectorySandboxStepInput): SandboxStep;
  checkoutGit(input: CheckoutGitSandboxStepInput): SandboxStep;
};
```

```typescript
const installToolVersion = defineSandboxAction({
  id: "@acme/niceeval-tools/install",
  input: Schema.Struct({ version: Schema.String }),
  steps: ({ version }) => [
    sandboxStep.exec({
      executable: "tool",
      args: ["install", version],
    }),
    sandboxStep.putText({
      path: ".tool-version",
      text: version,
    }),
  ] as const,
});

export const tools = sandboxLayer().before(installToolVersion(
  { version: "1.4.0" },
  { changeFrequency: 20, dependsOn: [actionRef("fixture")] },
));
```

family instance 默认直接使用 definition `id`，所以常见调用不用再声明第二次。
只有同一个 family 在同一 occurrence 出现多次时，才用可选的 instance `id` 区分节点。

一个 Action instance 是单一的调度、identity、执行、capture 与 satisfaction 单元。step 只有线性执行语义，没有 `id`、频率、依赖或 capability，不能直接传给 `.before()`。V1 `steps` 必须同步返回非空、无分支、无循环的 step tuple；Runner 顺序解释全部 step，全部成功并 quiesce 后才允许捕获，不发布内部半成品前缀。

`cache.state` 是 Action 对其全部可观察副作用作出的正确性承诺，不是“只缓存其中一部分”的性能选择器。V1 公开面是 `sandboxState.all`；省略固定为 `all`。nested Docker 不暴露 `sandboxState.dockerData` 特殊缓存；Incus Provider 只对完整、可验证的 prepared Sandbox artifact 报告 coverage。

definition 与 instance 都可以在其自己的单一声明点填写 `cache.state`。definition 已填写时，instance 不能重复或改写；内置 inline Action 则直接在 `.before(shell({ ... }))` 的同一个对象中填写。未知值与重复声明在构造 Action 时失败。

低层 `sandboxStep.transferFile()` / `transferDirectory()` 的 `source` 只接受 `registerSandboxContent()` 返回的 immutable handle，不能直接放宿主 path 或 URL。常见写法使用 `uploadFile()` / `uploadDirectory()`，由内容上传构造器在同一次声明中完成登记；这个限制保证第三方 Action 与官方 Action 都把实际 bytes、mode 与目录 manifest 纳入自动指纹。

同一 occurrence 内所有 action 的 `id` 必须唯一。内置 action 与第三方 family 共用这一命名空间；重复 id、不可见 `actionRef()` 与跨 occurrence 引用都在 Provider I/O 前形成 planning typed failure。

定义 family 就是作者作出确定性承诺：`steps` 只依赖已声明 input，只改变 Sandbox，可重复执行并可捕获。这个承诺与 Dockerfile `RUN` 同类，不是 NiceEval 对任意 shell、网络、时钟或随机读取做的污点证明。无法作出承诺的逻辑必须使用 callback 或 `defineSandboxCommand()`。第三方只能组合公开 step，不能注册新的 primitive kind。

普通 JSON、string 与文本由作者声明为非敏感输入。NiceEval 不承诺追踪 `process.env`、闭包或任意字符串的污点。secret、credential handle 与 runtime binding 必须留在 callback 或 Provider 私有通道，不能作为 action input 或 supplemental fingerprint 传入。

family 调用时先用 `Schema.validateSync()` 验证 type side，再用 `Schema.encodeSync()` 得到 canonical JSON input。`steps` 接收验证后的值；返回值随即规范化并冻结。Schema 必须无 requirements、可同步验证与编码，encoded side 必须能规范化为 JSON。

action 自动指纹包含 family `id`、canonical input、规范化后的 steps、规范化 state，以及 steps 引用的内容 digest、目录内容、完整 Git commit 与 image digest。函数源码、对象身份、模块路径和加载顺序不进入 identity。

definition 的可选 `cache.fingerprint` 接受 JSON 值，或接收已验证 input 并返回 JSON 值；instance options 也可 inline 传一个 JSON fingerprint。两者只补充自动观察不到的身份并共同规范化，不能替换自动指纹。最终 action 指纹固定为 `hash(auto, supplemental)`。省略补充值时使用规范化 absent sentinel；需要强制失效时可直接写 `cache: { fingerprint: "2" }`。state 属于自动身份，不能用 supplemental fingerprint 模拟或改写。

linked prefix 再加入 owner、ordinal、本 occurrence 的 action id、频率、依赖、capability、cohort、Provider identity 与 `interpreterRevision`。Eval `test` 函数、Assertion 与只发生在 Agent/test 阶段的输入不进入未改变的 SetupPrefixKey；它们仍按各自契约改变 CaseKey 之外的 Attempt 与结果 identity。

只有自动观察不到的协议版本才写补充指纹：

```typescript
cache: {
  fingerprint: ({ version }) => ({
    installerProtocol: 2,
    distribution: version,
  }),
}

// 只需要手动失效整个 family 时：
cache: { fingerprint: "2" }
```

定义、Schema、JSON、`cache.fingerprint` 或 steps 不合法时，同步抛出 Effect `Data.TaggedError` 形状、带稳定 `_tag`、`reason` 和结构化字段的 `SandboxActionDefinitionError`；Schema 失败作为 cause 保存。依赖图、动态输入求值和 Provider operation requirement 属于 planning typed failure；step、quiesce、capture 与 restore 属于 execution typed failure。错误识别读取数据字段，不依赖 `instanceof`。

`command()`、`shell()`、`writeText()`、`writeBytes()`、`uploadFile()`、`uploadDirectory()` 与 `gitCheckout()` 都由导出的 `defineSandboxAction()` 和 `sandboxStep` 定义。它们统一接受 `cache: { state?: SandboxState; fingerprint?: JsonValue }`。core 只认识封闭 step kinds，不按官方 family id 或 package 路径走旁路。内置函数可以把领域 input 与 before metadata 摊平成一个对象，但生成的品牌值、identity、调度、执行、缓存与第三方 family 完全同路。

同一 family 的 `.after(input, { id })` 产生 `SandboxAfterAction`。它不含频率、依赖、capability 或缓存字段，只能表达无条件、幂等 finally。需要本次 acquire handle 的释放仍由 callback 通过 `context.onCleanup()` 登记。

## Command 形状与 identity

```typescript
interface SandboxCommand {
  (
    sandbox: SandboxCommandTarget,
    context: SandboxCommandContext,
  ): MaybePromise<void>;
}

interface SandboxCommandContext {
  readonly phase: "before" | "agent.post-setup" | "agent.pre-teardown";
  readonly owner:
    | { readonly kind: "eval"; readonly id: string }
    | { readonly kind: "eval-group"; readonly id: string }
    | { readonly kind: "experiment"; readonly id: string }
    | { readonly kind: "agent"; readonly id: string };
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

interface SandboxCommandTarget extends SandboxOperations {
  readonly sandboxId: string;
  copyPath(sourcePath: string, targetPath: string): Promise<void>;
  putContent(content: SandboxContent, targetPath: string): Promise<void>;
}
```

`SandboxCommandTarget` 是运行中主 Sandbox 的窄视图。
它没有 `stop()`,不暴露 Provider-native SDK,`copyPath()` 的两端都在 Sandbox 内。`sandboxId` 实时转发
callback 开始时当前主物理 Sandbox 的 Provider-native ID。portable callback 只能把它当作不透明字符串；
只有已经由 factory 或作者配置确定 Provider 的可信 callback 才能交给对应宿主 SDK 查找实例。
跨 Provider 关联必须使用 `provider + sandboxId`，不能拆解字符串格式或假定全局唯一。

准备前缀可以在第一个 opaque callback 之前 rebase 主实例；callback 开始后，本 Attempt 不再 capture 或 rebase，因此该 callback 登记的 cleanup 与 standalone after 看到同一 ID。复用池继续租借同一物理实例时 ID 保持不变，实例退休或替换后允许变化。callback 取得的宿主辅助资源不属于 NiceEval 管理的 Case 拓扑，不进入 fingerprint、共享 capture 或 Record，并必须由作者登记 cleanup。

同名方法与 `t.sandbox`、完整 `Sandbox` 的语义完全相同。`runCommand()` / `runShell()` 返回任意 exit code；checked 调用显式使用 `runCommandOrThrow()` / `runShellOrThrow()`。

timeout、cancel 与 transport failure 始终 reject。完整签名只在[操作 Sandbox](library/operations.md)定义，不在 layer 再造一套 `SerializableCommandOptions`。

### 稳定 identity 与 opaque callback

```typescript
interface SandboxCommandIdentity {
  readonly id: string;
  readonly revision: string;
  readonly inputs: SandboxCommandIdentityValue;
}

interface SandboxCommandDefinition extends SandboxCommandIdentity {
  readonly changeFrequency?: number;
  readonly dependsOn?: readonly SandboxActionRef[];
  readonly requires?: readonly SandboxCapability[];
  readonly provides?: readonly SandboxCapability[];
}

/** 可进入稳定 action identity 的执行选项；函数、signal 与运行时回调不在其中。 */
interface SandboxExecOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly user?: string;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

interface CommandActionOptions
  extends SandboxExecOptions, SandboxBeforeActionOptions {}

interface ShellActionInput
  extends SandboxExecOptions, SandboxBeforeActionOptions {
  readonly command: string;
  readonly inputs?: readonly SandboxContent[];
}

interface SandboxContent {
  readonly digest: string;
  readonly kind: "file" | "directory";
}

declare function command(
  executable: string,
  args: readonly string[],
  options: CommandActionOptions,
): SandboxAction;

declare function shell(input: ShellActionInput): SandboxAction;

declare function defineSandboxCommand(
  definition: SandboxCommandDefinition,
  run: SandboxCommand,
): StableSandboxCommand;

declare const sandboxContent: {
  file(source: URL): SandboxContent;
  directory(source: URL): SandboxContent;
};

interface UploadFileActionInput extends SandboxBeforeActionOptions {
  readonly source: URL;
  readonly to: string;
}

interface UploadDirectoryActionInput extends UploadFileActionInput {}

interface WriteTextActionInput extends SandboxBeforeActionOptions {
  readonly path: string;
  readonly text: string;
}

interface WriteBytesActionInput extends SandboxBeforeActionOptions {
  readonly path: string;
  readonly bytes: Uint8Array;
}

declare function uploadFile(input: UploadFileActionInput): SandboxAction;
declare function uploadDirectory(input: UploadDirectoryActionInput): SandboxAction;
declare function writeText(input: WriteTextActionInput): SandboxAction;
declare function writeBytes(input: WriteBytesActionInput): SandboxAction;
declare function gitCheckout(input: GitCheckoutActionInput): SandboxAction;
```

普通 shell 步骤不必写 callback:

```typescript
const lockfile = sandboxContent.file(new URL("../../pnpm-lock.yaml", import.meta.url));

sandboxLayer()
  // 未锁定 apt index/package 是网络与时间相关操作，因此保留为 opaque barrier。
  .before(async (sandbox) => {
    await sandbox.runCommandOrThrow("apt-get", ["update"], { user: "root" });
    await sandbox.runCommandOrThrow("apt-get", ["install", "-y", "git"], { user: "root" });
  })
  .before(shell({
    id: "install-dependencies",
    command: "pnpm install --frozen-lockfile",
    inputs: [lockfile],
  }));
```

`command()` / `shell()` 由纯数据参数生成稳定 identity。identity 涵盖 executable / command、argv、cwd、env、user、stdin、显式 immutable inputs 与 action metadata。`shell()` 使用上面的单对象签名。

复杂探测、分支与文件 IO 可以直接写 callback。未锁定的 apt/package index、`latest`、移动 URL、时钟或其它网络状态也必须使用 callback barrier。JavaScript 无法可靠提取它读取的 `process.env`、时间或其它闭包状态，因此直接 callback 不向 fingerprint 增加 identity；Runner 也不用 `Function.prototype.toString()` 或函数名猜闭包。

需要稳定 identity 或跨 owner 排序元数据的自定义步骤使用 `defineSandboxCommand()`，所有动态输入进入 `inputs`。`id`、`revision` 与 `inputs` 决定 command identity。

`changeFrequency`、`dependsOn`、`requires` 与 `provides` 只决定 linked schedule、DAG、fingerprint 与 debug。这些字段不会把 callback 变成声明式 action。

普通本地传输直接使用 `uploadFile()` / `uploadDirectory()` action；它们在一次声明中完成内容登记、identity 与目标写入。声明期 source 必须是以定义模块为基准的 `file:` URL，例如 `new URL("fixtures/", import.meta.url)`，不能用随启动目录漂移的相对字符串。只有内容必须晚于 Agent 可见时，才用 `sandboxContent.file()` / `sandboxContent.directory()` 取得 digest-backed handle，并在 Eval test 中调用 `t.sandbox.upload()`。

声明式 action 与运行期 `Sandbox` 刻意共用文件动词：已有文本或字节使用 `writeText()` / `writeBytes()`，声明的宿主路径使用 `uploadFile()` / `uploadDirectory()`。前者的内容、后者的规范化 manifest 都直接进入 identity。`before()` 不能把尚不存在的 Sandbox 传给这些 action；只有 callback before 在执行期取得 `Sandbox`，代价是 opaque 且不能共享捕获。

`run` 的函数体、函数名与闭包不进入 identity。只改实现而保持 `id`、`revision`、`inputs` 不变时,Runner 不会发现语义已经变化,旧结果仍可能沿用。实现语义变化必须提高 `revision`;外部输入变化必须反映到 `inputs`。若作者漏改 identity 后已经产生或沿用了结果,先修正 `revision` 或 `inputs`,再按[全量重验](../experiments/use-case/重新运行/全量重验.md)对受影响选择执行 `--rerun all`。`--rerun all` 只修复这一次结果集,不能替代永久 identity 修正。

`defineSandboxCommand()` 的稳定 identity 只提供失效与排序依据。它的 `run` 始终 opaque，在每个 occurrence 真实执行并截断后续共享 capture，绝不因 identity 稳定而命中准备前缀。只有 `shell()`、`writeText()`、`writeBytes()`、`upload*()`、`gitCheckout()` 等完全声明式 action 具备前缀缓存资格。

`putContent()` 对大文件自动拆成有界的 provider 写入,全部到达后才在 Sandbox 内原子替换目标；SDK 单次请求超时不会留下半个目标文件。
未登记 identity 的 callback 是 opaque barrier。它真实执行并截断后续共享 capture；不能因为函数名或闭包外形稳定就把它当作可缓存 action。
Provider 的声明 identity、BuildKey 或 opaque marker 直接进入 fingerprint，不再额外保存或判定 provider carry eligibility。

源码检出使用 `gitCheckout()`；慢工具安装使用 `shell()` 或第三方 `defineSandboxAction()` family。它们的 identity 与执行边界见[内置 before 单元](prepare-commands.md)。Agent 前内容使用 action，隐藏判据只在 Agent 返回后的 Eval test 中上传，不能进入 SetupPrefixKey。

### Cleanup

命令需要 cleanup 时,在本次执行成功取得资源后调用 `context.onCleanup()` 登记。
`onCleanup()` 同步立即登记并返回 `void`，只能在当前 command callback 尚未 settle 时调用；cleanup 不能递归登记 cleanup。callback 后续失败或取消不撤销已经登记的动作。每次 Attempt 使用独立 registry，闭包捕获的 handle 不跨 Attempt 复用。

Runner 对已成功登记的 cleanup 只按实际登记栈 LIFO 执行；未执行或取得失败的命令不会产生虚假 cleanup。cleanup 保留登记时的 phase、owner 与反馈归因，只把 signal 替换成独立有界 cleanup signal。

单项失败追加 `teardown-failed` diagnostic 后继续收尾。动态 cleanup 先于入口登记的 standalone after，Provider finalizer 最后运行。
绑定完整 Case 的资源由 Provider finalizer 回收。跨 Run checkpoint 由 callback before 恢复，并在成功取得 handle 后用 `onCleanup()` 登记回存。无条件收尾使用已登记的 after；这些入口不建立第二套生命周期 API。

公开入口的生命周期验收涉及以下最小矩阵：

| 场景 | 必须观察到的结果 |
|---|---|
| acquire 未执行或取得失败 | 不登记、不执行对应 cleanup |
| acquire 成功，后续 before 或主体失败 | 已登记 cleanup 仍执行 |
| callback 部分取得后失败 | 每个已取得 handle 的补偿都执行，未取得部分没有虚假 cleanup |
| 多 owner 的 DAG 改变实际执行顺序 | cleanup 按实际登记顺序 LIFO，不按 owner 或频率另排 |
| 多条 Attempt 并发 | registry 和闭包 handle 彼此隔离 |
| `defineSandboxCommand()` 有稳定 identity | run 仍真实执行，不命中准备前缀 |
| 同时存在动态 cleanup 与 standalone after | 动态 cleanup 先执行，standalone after 随后逆序执行 |

## Agent layer

每个 Sandbox Agent Adapter 声明自己的 ensure(目标 identity 加只读 探测);官方 Agent 安装层按 identity 配对,Runner 也可附带 command-only 的 Agent before layer。
Agent-owned before action 与其它 owner 进入同一个 DAG，数值更小时可以先执行。ensure 循环(探测 → 缺失才 install → 复检)仍是整个 before DAG 之后的屏障；它保留宿主侧 payload prepare、目标平台探测、安装模式与安装事实,不降格成普通 `SandboxCommand`。

Agent layer 由 Runner 组装,没有作者可导入的组装 API;Adapter 与 Eval / Experiment 作者都不手工排列安装组件。
Adapter 不能提供 template 或 Provider;Agent 需要特殊系统起点时,Eval 或 Experiment 必须显式提供兼容 template,link 与 physical planning 用 Adapter 声明的 capability requirement 检查它。
完整协议见 [Agent Ensure](../adapters/architecture/agent-ensure.md)。

## 相关阅读

- [三方准备时序](lifecycle.md) —— action schedule、fresh / reuse 次数、身份与错误归属。
- [Case](case.md) —— template 之下的完整运行单位:BuildKey / CaseKey、构建协调、Compose。
- [Nested Docker](nested-docker/README.md) —— `sandboxRequirements()` 与 `incusSandbox()`。
- [Library](library.md) —— 运行中 Sandbox 的路径、执行身份、超时与自定义 Provider。
- [Sandbox 复用](reuse.md) —— `sandboxReuse` 下的重新执行、reset 与寿命确认。
- [Agent Ensure](../adapters/architecture/agent-ensure.md) —— Agent layer 的安装协议与事实。
