# PLAN-3：Library

本篇是 PLAN-3 公开调用形状的单一来源。
方案取舍见 [README](README.md)，运行和身份语义见 [Architecture](architecture.md)，完整场景见 [Use Cases](use-case/README.md)。

## Sandbox Case 入口

Eval 使用现有 environment 入口声明完整题目 Case：

```typescript
export default defineEval({
  environment: composeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    mainService: "client",
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

SandboxSpec 可以按 profile 提供完整预制 Case：

```typescript
e2bSandbox({
  environments: {
    "terminal-bench/sheets": {
      template: "acme/tb-sheets-v5",
    },
  },
});
```

`environments` 表项优先于同 profile 的 folder-local materialize。
表值仍是完整 Sandbox Case，不把 Compose 多 service 环境压成单 template。

普通 Provider 对内建 source kind 提供默认 materializer。
用户只在自定义 source kind 或自定义 Provider 时声明 materializer。
本方案不改变 Sandbox Case 的公开形状与完整义务。

## `defineAddon`

Addon 声明 Experiment 希望在主 Sandbox 中成立的一项普通工具状态：

```typescript
const companyCertificates = defineAddon({
  name: "company-certificates",
  identity: { bundleDigest: COMPANY_CA_SHA256 },
  resources: ["system-ca"],
  check: async (sandbox, ctx) => {
    return inspectCompanyCertificates(sandbox, ctx.identity);
  },
  install: async (sandbox) => {
    await installCompanyCertificates(sandbox);
  },
});

const mempal = defineAddon({
  name: "mempal",
  identity: {
    version: "0.9.0",
    installerDigest: MEMPAL_SHA256,
  },
  dependsOn: [companyCertificates],
  resources: ["npm-global"],
  check: async (sandbox, ctx) => {
    return inspectMempal(sandbox, ctx.identity);
  },
  prepare: async (ctx) => {
    return stageMempal(ctx.target.platform, ctx.stageDir);
  },
  install: async (sandbox, ctx) => {
    await uploadAndInstallMempal(sandbox, ctx.prepared);
  },
});
```

候选公开形状为：

```typescript
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type AddonIdentity = Readonly<Record<string, JsonValue>>;
type AddonFact = string | number | boolean;

type AddonCheckResult =
  | {
      satisfied: false;
      reason: string;
      actualIdentity?: AddonIdentity;
      detail?: string;
    }
  | {
      satisfied: true;
      actualIdentity: AddonIdentity;
      facts?: Readonly<Record<string, AddonFact>>;
    };

interface AddonTarget {
  platform: string;
}

interface PreparedAddon {
  files: Readonly<Record<string, string>>;
  identity?: AddonIdentity;
}

interface AddonContext<I extends AddonIdentity> {
  identity: I;
  target: AddonTarget;
  signal: AbortSignal;
  progress(update: ProgressUpdate): void;
  diagnostic(diagnostic: DiagnosticInput): void;
  fact(key: string, value: AddonFact): void;
}

interface AddonPrepareContext<I extends AddonIdentity>
  extends AddonContext<I> {
  stageDir: string;
}

interface AddonInstallContext<I extends AddonIdentity>
  extends AddonContext<I> {
  prepared: PreparedAddon;
}

interface AddonSpec<I extends AddonIdentity> {
  name: string;
  identity: I;
  dependsOn?: readonly AddonSpec<AddonIdentity>[];
  resources?: readonly string[];
  check(
    sandbox: Sandbox,
    context: AddonContext<I>,
  ): Promise<AddonCheckResult>;
  prepare?(
    context: AddonPrepareContext<I>,
  ): Promise<PreparedAddon>;
  install(
    sandbox: Sandbox,
    context: AddonInstallContext<I>,
  ): Promise<void>;
}
```

`name` 在一次 Experiment 的解析结果内唯一。
`identity` 是可序列化目标身份；脚本、payload 和模型会改变目标状态时，必须以 digest 或 revision 进入 identity。

`check` 返回实际 identity、事实与不匹配原因，不能只返回 boolean。
`install` 成功后框架重跑同一个 `check`。

`resources` 为空时使用保守的 `sandbox-mutation` 资源。
`dependsOn` 表达语义依赖，不表达共享资源锁。

## Experiment 的 `addons`

Experiment 通过 `addons` 声明实验条件：

```typescript
export default defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox(),
  addons: [companyCertificates, mempal],
});
```

`addons` 是声明集合，数组位置不表达执行顺序。
Runner 根据 `dependsOn` 与 `resources` 建立调度图。

框架提供 `commandAddon`、`aptPackages` 与 `npmGlobalPackages` 等 helper。
helper 返回普通 Addon，并自动提供对应工具的真实检查与安装资源声明。

Addon 可以有 `prepare`。
它只在实际 `check` miss 后运行，按 Addon name、目标 identity 与目标 platform single-flight。
没有 `prepare` 时，`install` 收到 `{ files: {} }`。

## AgentProvisioner 保持独立

AgentProvisioner 不转换成 Addon。
Adapter 继续通过自己的 factory 接受完整 provisioner：

```typescript
const internalCodex = defineAgentProvisioner({
  identity: {
    agent: "codex",
    version: "0.144.0",
    revision: "corp-2",
  },
  check: checkInternalCodex,
  prepare: prepareInternalCodex,
  install: installInternalCodex,
});

codexAgent({ provisioner: internalCodex });
```

AgentProvisioner 的 identity、目标平台探测、staged payload、`staged` / `sandbox-network` / `verifyOnly` 安装模式、check、install、recheck 与逐 Attempt 安装事实继续组成一个原子值。
本方案不重新定义或删减这些义务。

Addon 与 AgentProvisioner 只共享准备 single-flight、依赖和资源互斥等底层设施。
二者的公共返回类型、错误码和运行事实保持分开。

## 状态 Hook 与 Fixture

外部状态载入和回存继续使用 Sandbox `.setup()` / `.teardown()`。
任务文件继续使用 Eval Fixture；Experiment 整场一份的宿主资源继续使用 Experiment lifecycle。

Addon 没有 teardown。
安装内容随 Sandbox 销毁；运行状态和外部副作用由对应 Hook 成对收尾。
