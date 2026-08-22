# Library

## 统一的准备 API

`prepare` 表示“在 Agent/test 前准备 Sandbox”，不再等同于“每 Attempt 必定调用一次命令”。求值后的 scope 决定 occurrence 属于物理 Sandbox 还是 Attempt；缓存只决定该 occurrence 通过 restore 还是 recipe invocation 得到满足。

```ts
type PreparationScope = "sandbox" | "attempt";

const changeFrequency = {
  rare: 10,
  normal: 100,
  frequent: 1_000,
} as const;

interface PreparationOperationOptions {
  readonly id: string;
  readonly inputs: readonly PreparationInput[];
  readonly scope?: PreparationScope;
  readonly changeFrequency?: number;
  readonly cacheVersion?: string;
}

declare function shell(
  input: PreparationOperationOptions & ShellInput,
): SandboxPreparationOperation;
declare function write(
  input: PreparationOperationOptions & WriteInput,
): SandboxPreparationOperation;
declare function copy(
  input: PreparationOperationOptions & CopyInput,
): SandboxPreparationOperation;

interface SandboxLifecycleNode {
  readonly scope: PreparationScope;
  readonly setup: SandboxLifecycleAction;
  readonly teardown: SandboxLifecycleAction;
}

interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  prepare(operation: SandboxPreparationOperation): SandboxLayer<Kind>;
  lifecycle(node: SandboxLifecycleNode): SandboxLayer<Kind>;
}
```

操作在写出时直接传给 `.prepare()`，不需要先定义 setup 容器再传一次：

```ts
dockerSandbox({
  source: { type: "dockerfile", context: HARNESS_CONTEXT },
})
  .prepare(shell({
    id: "runtimes",
    command: "./import-runtimes.sh",
    inputs: [runtimeV09, runtimeV012],
    changeFrequency: changeFrequency.rare,
  }))
  .prepare(shell({
    id: "fixture",
    command: "./install-fixture.sh",
    inputs: [fixtureArchive],
    changeFrequency: 40,
  }))
  .prepare(write({
    id: "adapter-env",
    path: ".env",
    input: publicAdapterConfig,
    changeFrequency: changeFrequency.frequent,
  }))
  .lifecycle({
    scope: "attempt",
    setup: injectCredentialOverlay,
    teardown: removeCredentialOverlay,
  });
```

`shell()`、`write()` 与 `copy()` 的返回值同时是规范化操作、缓存节点和 `.prepare()` 参数。命令、目标、规范化参数及 inputs 形成 recipe identity；只有这些输入无法表达的实现世代变化才使用 `cacheVersion` 显式失效。

## Scope 推导

每个 typed input 携带最小安全 scope。planning 对输入求 join：

```text
requiredScope(inputs):
  含 attempt-bound handle → attempt
  只有 immutable handle  → sandbox-capable
```

省略 `scope` 时，sandbox-capable 求值为 `sandbox`，attempt-bound 求值为 `attempt`。作者可以把 sandbox-capable 显式收紧为 `attempt`，让 occurrence 更频繁；不能把 attempt-required 放宽为 `sandbox`。违反时 planning 在创建资源前失败。求值后的 scope 进入 PrefixKey、debug 与诊断。

fixture、sample、seed、transfer/config manifest 只有被该操作实际消费时才通过 typed handle 进入 inputs。model、timeout、Attempt UUID 与其它不可见配置不会仅因属于同一个 Attempt 就击穿缓存。inputs 同时负责运行时交付与 identity，不是额外的 cache tag。

## 频率与顺序

`changeFrequency` 接受任意有限非负数，默认 `changeFrequency.normal`。数值越大表示作者预计它变化越频繁；三个预设只是普通数字。该值只影响 promotion、retention、GC 与缓存工作排队，不进入 PrefixKey，也绝不改变执行顺序。

规范化顺序固定为：

```text
Provider ready
  → 所有 sandbox-scope nodes
  → verified sandbox reset baseline
  → 每个 Attempt:
      reset
      → 所有 attempt-scope nodes
      → Agent/test
      → attempt teardown / cleanup
  → sandbox teardown
  → Provider finalizer
```

每个 scope 内使用 framework phase、template owner、另一 author owner、Agent owner和作者书写顺序。跨 scope 只能从 sandbox 指向 attempt；反向依赖 planning fail。API 不提供越过 owner precedence 或书写顺序的任意重排。

## 确定性边界

可缓存 operation 是确定性承诺，只允许改变 Sandbox 内状态。执行面清空 ambient env、默认阻断网络，并禁止 secret、租约、外部会话、当前时间、随机数和外部写入。宿主文件与浮动引用先经内容求值或身份查找，得到 canonical value、digest 或只读 handle。漏报输入违反 eligibility，但 NiceEval 不宣称可以自动发现任意 shell 的全部隐藏读取。

需要凭据、外部副作用、长驻会话或任意 callback 的动作使用 `.lifecycle()`：

```ts
layer.lifecycle({
  scope: "sandbox",
  setup: startFixtureService,
  teardown: stopFixtureService,
});
```

scope 对 callback 必填，不能从函数体推导。lifecycle node 始终真实执行且不可缓存，并截断所在物理状态的共享捕获 lineage；后续 operation 仍执行，但标记 `ineligible: opaque-ancestor`。只有框架与 Provider 类型共同证明 snapshot-excluded 的私有 overlay 可以例外。

teardown 义务在 setup invocation 前登记，因此 setup 部分失败也会收尾。所有已到达节点按规范化 forward 顺序的全局逆序 teardown。即使 lifecycle action 使用可精确展示的 `shell()`，它也不缓存、不因任何 prefix hit 跳过。

## Provider 中立

`.prepare()` 属于 `SandboxLayer`，不属于 Docker：

```ts
const prepareProject = <Kind extends SandboxLayerKind>(layer: SandboxLayer<Kind>) =>
  layer
    .prepare(copy({
      id: "fixture",
      source: fixtureArchive,
      destination: "/workspace",
      inputs: [fixtureArchive],
      changeFrequency: 40,
    }))
    .prepare(write({
      id: "adapter-env",
      path: "/workspace/.env",
      input: publicAdapterConfig,
      inputs: [publicAdapterConfig],
      changeFrequency: changeFrequency.frequent,
    }));

prepareProject(dockerSandbox({ source: { type: "image", image } }));
prepareProject(e2bSandbox({ template }));
prepareProject(vercelSandbox({ snapshotId }));
```

Provider 对每个 scoped prefix 分别报告 `persistent | invocation-local | unsupported`。persistent 可以跨 Invocation 命中；invocation-local 只能在本次运行 build once；unsupported 仍真实执行合法 operation。Provider 不得忽略准备、伪造 hit 或交付共享 writable state。

最终 sandbox-scope state 是物理实例的 reset baseline。Provider 无法可靠恢复它时，只能为每个 Attempt 创建新实例或拒绝 reuse，不能把 sandbox-scope operation 偷换成每 Attempt replay。
