# Library

## SandboxLayer API

```ts
type ChangeFrequency = "rare" | "normal" | "frequent";

interface CacheableSandboxSetup {
  readonly id: string;
  readonly revision: string;
  readonly changeFrequency?: ChangeFrequency;
  readonly dependsOn?: readonly SetupRef[];
  readonly inputs: readonly ImmutableSetupInput[];
  readonly materialize: SandboxRecipe;
  readonly activate?: PhysicalSetupHook;
  readonly deactivate?: PhysicalSetupHook;
}

interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  setup(node: CacheableSandboxSetup): SandboxLayer<Kind>;
  setup(hook: SandboxHook): SandboxLayer<Kind>;
  teardown(hook: SandboxHook): SandboxLayer<Kind>;
}

declare function defineSandboxSetup(input: CacheableSandboxSetup): CacheableSandboxSetup;
declare function setupRef(node: CacheableSandboxSetup): SetupRef;
declare function sandboxRecipe(steps: readonly SandboxRecipeStep[]): SandboxRecipe;
declare function setupExec(input: SetupExecInput): SandboxRecipeStep;
declare function setupWrite(input: SetupWriteInput): SandboxRecipeStep;
declare function contentInput(input: ContentInput): ImmutableSetupInput;
declare function immutableValueInput(input: ImmutableValueInput): ImmutableSetupInput;
```

`changeFrequency` 默认 `normal`。三个值只表达相对变化频率，不承诺时间范围；它们不改变缓存资格和正确性身份。不存在作者侧 `noCache`。Provider 可以不 promotion 某个逻辑前缀，但 miss 时仍从最长 verified 前缀重新执行剩余 recipe。

`materialize` 只接受品牌化、可规范化的 recipe。宿主 callback、当前时间、随机数、ambient environment 与任意网络读取不能进入执行面。宿主文件和浮动引用必须在 planning 中经过内容求值或身份查找，得到冻结的 value、digest 或 runtime input handle；recipe 只能消费这些 handle。执行进程移除 ambient env 并默认阻断网络。可信作者故意遗漏或伪装输入仍违反 eligibility 契约，NiceEval 不宣称能从任意 shell 自动证明确定性。

## 组合顺序

每个完整节点身份由 attachment owner 与本地 `id` 组成。同 owner 重复 id、缺失依赖、循环或重复 attachment 在 planning 聚合失败。跨 owner 依赖使用品牌化 `SetupRef`，不能使用纯文本字符串；框架为 Agent 等固定边界提供内置 barrier ref。

线性化顺序是：

```text
dependency edges
  → 当前 frontier 内 rare / normal / frequent
  → 同频 owner precedence
  → 同 owner registration order
```

依赖永远优先于频率。普通 `.setup(callback)` 是 activation-only 硬屏障：新节点不能越过它重排。全部 materialize 完成并得到最终私有 clone 后，activate 按同一线性化顺序执行，deactivate 按逆序执行；activate 开始前登记收尾义务，部分激活失败也对已经到达的节点执行 deactivate。

## Adapter `.env`

```ts
const fixture = defineSandboxSetup({
  id: "fixture",
  revision: "1",
  changeFrequency: "normal",
  inputs: [contentInput(fixtureArchive)],
  materialize: sandboxRecipe([setupExec({ command: "install-fixture", inputs: [fixtureArchive] })]),
});

const adapterEnv = defineSandboxSetup({
  id: "adapter-env",
  revision: "1",
  changeFrequency: "frequent",
  dependsOn: [setupRef(fixture)],
  inputs: [immutableValueInput({ id: "adapter-config", value: publicAdapterConfig })],
  materialize: sandboxRecipe([setupWrite({ path: ".env", input: "adapter-config" })]),
  activate: injectCredentialOverlay,
  deactivate: removeCredentialOverlay,
});

layer.setup(fixture).setup(adapterEnv);
```

无密钥 `.env` 模板或普通 fixture 配置可以成为 frequent materialize。框架与 Adapter 已知的 secret handle 在类型上只能交给 activate；secret bytes 不进入 recipe、PrefixKey、manifest 或日志。若 Provider 无法证明 secret overlay 不会进入共享捕获面，planning 失败。
