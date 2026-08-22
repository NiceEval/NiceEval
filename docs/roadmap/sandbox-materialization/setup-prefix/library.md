# Library

## Inline setup API

可缓存操作在写出时直接传给 `.setup()`。作者不需要先定义一个 setup 容器，再把容器传给 Layer：

```ts
const setupChangeFrequency = {
  rare: 10,
  normal: 100,
  frequent: 1_000,
} as const;

interface SetupOperationOptions {
  readonly id: string;
  readonly changeFrequency?: number;
  readonly after?: readonly SetupRef[];
  readonly cacheVersion?: string;
}

declare const setup: {
  exec(input: SetupOperationOptions & SetupExecInput): CacheableSetupOperation;
  write(input: SetupOperationOptions & SetupWriteInput): CacheableSetupOperation;
  copy(input: SetupOperationOptions & SetupCopyInput): CacheableSetupOperation;
};

interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  setup(operation: CacheableSetupOperation): SandboxLayer<Kind>;
  setup(hook: SandboxHook): SandboxLayer<Kind>;
  teardown(hook: SandboxHook): SandboxLayer<Kind>;
}
```

```ts
dockerSandbox({
  source: { type: "dockerfile", context: HARNESS_CONTEXT },
})
  .setup(setup.exec({
    id: "runtimes",
    command: "import-runtimes",
    inputs: [runtimeV09, runtimeV012],
    changeFrequency: setupChangeFrequency.rare,
  }))
  .setup(setup.exec({
    id: "fixture",
    command: "install-fixture",
    inputs: [fixtureArchive],
    changeFrequency: 40,
  }))
  .setup(setup.write({
    id: "adapter-env",
    path: ".env",
    input: publicAdapterConfig,
    changeFrequency: setupChangeFrequency.frequent,
  }));
```

`setup.exec()`、`setup.write()` 与 `setup.copy()` 返回的品牌化值同时是操作、缓存节点和 `.setup()` 参数。API 不要求 `defineSandboxSetup()`、`sandboxRecipe()`、外层 `materialize` 或必填 `revision`。命令、目标、规范化参数和不可变 inputs 直接形成 recipe identity；只有无法由这些值表达的实现世代变化才使用 `cacheVersion` 显式失效。

`changeFrequency` 接受任意有限非负数，默认 `setupChangeFrequency.normal`。数值越大表示作者预计它变化越频繁；预设常量只是便于阅读的普通数字，用户可以在常量之间或之外取值。它不表示时间单位，不进入 PrefixKey，也不改变缓存资格。Provider 可以不 promotion 某个逻辑前缀，但 miss 时仍从最长 verified 前缀重新执行剩余操作。

频率放在产生变化的操作上：shell 频率跟 `setup.exec()` 走，文件内容频率跟 `setup.write()` 走。外层 `.setup()` 只负责把操作附着到 Layer，不再拥有另一份缓存配置。

操作只接受品牌化、可规范化的输入。宿主 callback、当前时间、随机数、ambient environment 与任意网络读取不能进入执行面。宿主文件和浮动引用必须在 planning 中经过内容求值或身份查找，得到冻结的 value、digest 或 runtime input handle；操作只能消费这些 handle。执行进程移除 ambient env 并默认阻断网络。可信作者故意遗漏或伪装输入仍违反 eligibility 规则，NiceEval 不宣称能从任意 shell 自动证明确定性。

## Provider 中立

setup 操作属于 `SandboxLayer`，不属于 Docker。所有 template-bearing Provider 使用相同 attachment：

```ts
const prepareProject = <Kind extends SandboxLayerKind>(layer: SandboxLayer<Kind>) =>
  layer
    .setup(setup.copy({
      id: "fixture",
      source: fixtureArchive,
      destination: "/workspace",
      changeFrequency: 40,
    }))
    .setup(setup.write({
      id: "adapter-env",
      path: "/workspace/.env",
      input: publicAdapterConfig,
      changeFrequency: setupChangeFrequency.frequent,
    }));

prepareProject(dockerSandbox({ source: { type: "image", image } }));
prepareProject(e2bSandbox({ template }));
prepareProject(vercelSandbox({ snapshotId }));
```

每种操作依赖跨 Provider 的最小 `SandboxOperations`，不能携带 Docker image、volume 或 daemon 参数。需要操作 inner Docker data-root 的步骤仍可用 `setup.exec()`，但只有提供 Docker capability 的 template 能通过 planning。

缓存是 Provider capability，不是已创建 `Sandbox` 的方法。Provider 对 setup prefix 返回 `Hit | Miss | Unsupported`：

- 支持一致捕获和私有 clone 的 Provider 可以跨 Invocation 命中；
- 只能在一次 Invocation 内复制 template 的 Provider 可以 build once 后为本次消费者 clone；
- 不支持捕获的 Provider 返回 `Unsupported`，Runner 逐实例执行相同操作，结果语义不变；
- Provider 不得因无法持久缓存而忽略 setup、伪造 hit，或交付共享 writable 实例。

因此作者不写 Docker 专属 cache 开关，也不为 E2B、Vercel 重写 setup。plan/debug 必须显示 `persistent`、`invocation-local` 或 `unsupported`，让性能降级可观察而不改变正确性。

## 组合顺序

每个完整操作身份由 attachment owner 与本地 `id` 组成。同 owner 重复 id、缺失依赖、循环或重复 attachment 在 planning 聚合失败。多数作者只需 inline 注册；跨越默认 owner 顺序的真实正确性依赖才使用由目标 owner 和 id 构造的品牌化 `SetupRef`，不要求先把目标操作保存为变量。框架为 Agent 等固定边界提供内置 barrier ref。

线性化顺序是：

```text
dependency edges
  → 当前 frontier 内 changeFrequency 从小到大
  → 同频 owner precedence
  → 同 owner registration order
```

依赖永远优先于频率。普通 `.setup(callback)` 是逐实例硬屏障：可缓存操作不能越过它重排。可缓存操作完成并得到最终私有 clone 后，后续 callback 按 attachment 顺序执行，teardown 按逆序执行。

## Adapter `.env`

```ts
dockerSandbox({ source: { type: "dockerfile", context: HARNESS_CONTEXT } })
  .setup(setup.exec({
    id: "fixture",
    command: "install-fixture",
    inputs: [fixtureArchive],
    changeFrequency: 40,
  }))
  .setup(setup.write({
    id: "adapter-env",
    path: ".env",
    input: publicAdapterConfig,
    changeFrequency: setupChangeFrequency.frequent,
  }))
  .setup(injectCredentialOverlay)
  .teardown(removeCredentialOverlay);
```

无密钥 `.env` 模板或普通 fixture 配置可以缓存。框架与 Adapter 已知的 secret handle 在类型上只能交给逐实例 callback；secret bytes 不进入操作、PrefixKey、manifest 或日志。若 Provider 无法证明 secret overlay 不会进入共享捕获面，planning 失败。
