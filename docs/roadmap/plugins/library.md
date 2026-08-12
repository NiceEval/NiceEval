# Plugins —— Library

## 作者 API：返回 owner fragment

Plugin family 声明允许挂载的 owner。callback 返回 NiceEval 已有或本 roadmap 同批定义的公开 fragment；它不构造 raw Attachment 路由，也不发明第二套 Sandbox DSL。

```ts
interface EvalPluginFragment {
  readonly identity?: Readonly<Record<string, JsonValue>>;
  readonly requirements?: readonly PluginRequirement[];
  readonly sandbox?: SandboxLayer<"command-only", SandboxLayerScope>;
  readonly agentExtensions?: readonly AgentExtension[];
  readonly hostedAgentHooks?: HostedAgentHooks;
}

interface ExperimentPluginFragment {
  readonly identity?: Readonly<Record<string, JsonValue>>;
  readonly requirements?: readonly PluginRequirement[];
  readonly flags?: Readonly<Record<string, JsonValue>>;
  readonly labels?: Readonly<Record<string, string | number>>;
  readonly sandbox?: SandboxLayer<"command-only", SandboxLayerScope>;
  readonly setup?: ExperimentHook;
  readonly teardown?: ExperimentHook;
  readonly agentExtensions?: readonly AgentExtension[];
  readonly hostedAgentHooks?: HostedAgentHooks;
}

interface GroupPluginFragment {
  readonly identity?: Readonly<Record<string, JsonValue>>;
  readonly requirements?: readonly GroupRequirement[];
  readonly manifest?: JsonValue;
}
```

`definePlugin<Options>()` 保留 callback 的 literal keys 与 fragment type-state。至少声明一个 owner；缺少相应 callback 的 family 不能挂到 `defineEval()`、`defineScoreEval()`、`defineExperiment()` 或 `defineSandboxGroup()`。动态 JavaScript 在 definition 边界收到同样的具名错误。

```ts
type RememOptions = Readonly<{
  memoryModel: string;
  mode?: "accumulated" | "isolated";
}>;

export const remem = definePlugin<RememOptions>({
  name: "dev.remem.agent-extension",
  behaviorRevision: "3",

  experiment(options) {
    return { /* ExperimentPluginFragment */ };
  },
});

remem({ memoryModel: "memory-v1" });
remem({
  instance: "secondary",
  memoryModel: "memory-v1",
  mode: "isolated",
});
```

同一 family 的所有 owner callback 接收同一份 frozen business options。`instance` 是 framework 保留字段，默认值为 `"default"`，调用 callback 前剥离；业务 `Options` 不得声明它。调用 family 时，每个已声明 callback 恰好执行一次，返回值规范化并深冻结；link 不重跑 callback。无业务 options 的 family 同时支持 `context7()` 与 `context7({ instance: "secondary" })`。

Plugin `name` 必须是 reverse-domain lowercase ASCII namespace，例如 `com.example.docs-mcp`；短名只用于扩展内部的 Skill／MCP 安装 key。

## AgentExtension：统一直配与 Plugin

Agent factory 使用 `extensions`，Plugin fragment 使用 `agentExtensions`；两者的元素是同一种 nominal `AgentExtension`：

```ts
const docsMcpExtension = mcpServersExtension({
  docs: {
    url: "https://mcp.example.com/v1",
  },
});

const direct = codexAgent({
  configFile: "configs/codex/base.toml",
  extensions: [docsMcpExtension],
});

export const docsMcp = definePlugin({
  name: "com.example.docs-mcp",
  behaviorRevision: "1",

  experiment() {
    return { agentExtensions: [docsMcpExtension] };
  },
});
```

目标 API 一次删除 Agent factory 上旧的 `skills`、`mcpServers`、`plugins`、`postSetup` 与 `preTeardown` 字段，不保留 alias 或隐式合并桥。`configFile`／`settingsFile`、model／provider、主 credential 和主进程 env 保留为 Agent base-only 字段。

内建窄协议如下：

```ts
declare function skillsExtension(
  skills: Readonly<Record<string, SkillExtensionSource>>,
): AgentExtension;

declare function mcpServersExtension(
  servers: Readonly<Record<string, McpServerExtension>>,
): AgentExtension;

declare function codexNativeExtension(
  extension: CodexNativeExtension,
): AgentExtension;

declare function claudeCodeNativeExtension(
  extension: ClaudeCodeNativeExtension,
): AgentExtension;

declare function bubPythonExtension(
  extension: BubPythonExtension,
): AgentExtension;

declare function agentLifecycleExtension(input: {
  readonly afterConfigure?: readonly StableSandboxCommand[];
  readonly beforeAgentTeardown?: readonly StableSandboxCommand[];
}): AgentExtension;
```

`skillsExtension()` 由 Codex、Claude Code 与 Bub receiver 接受；`mcpServersExtension()` 由能表达对应 transport 的 receiver 接受。native extension 保持供应商专属，不用 mega payload 把所有 Agent 的偶然交集伪装成统一能力。`agentLifecycleExtension()` 只接稳定 command declaration：它让 receiver 把安装后脚本与收尾前 drain 编入分阶段计划，不开放一个绕过 identity 的任意 Plugin lifecycle callback。

完整 Codex TOML／Claude JSON 是保留原始字节的 Agent factory 独占 slot。Plugin 不能贡献完整文件、arbitrary patch、deep merge 或 Adapter-owned 保留键。缺少的常见能力应新增具名 protocol／slot。

### Skill 与 package asset

```ts
import { definePlugin, pluginAsset } from "niceeval/plugin";
import { skillsExtension } from "niceeval/adapter";

const effectTsAsset = pluginAsset(
  new URL("./assets/effect-ts", import.meta.url),
);

export const effectSkill = definePlugin({
  name: "dev.effect.skill",
  behaviorRevision: "1",

  experiment() {
    return {
      agentExtensions: [
        skillsExtension({
          "effect-ts": { source: effectTsAsset },
        }),
      ],
    };
  },
});
```

`pluginAsset()` 只接受无 query／hash 的 `file:` URL，并在 definition 时快照 URL 字符串，不读取内容。它表达 module-relative trusted local asset，不承诺路径一定落在 npm package root 内。只有 selected occurrence 在 planning snapshot 中读取内容、拒绝根 symlink／目录内 symlink／special file并计算 digest；V1 materialize 只使用已捕获 snapshot，不重读宿主路径。

远程 Skill、native Plugin 或脚本必须声明完整 commit identity 或 content digest。branch、movable tag 与默认 ref 不算 immutable identity，在 link 阶段失败；dry plan 不下载，materialize 后验证实际 commit／digest。运行中的 MCP HTTP endpoint 不是安装 asset，不受此 pin 规则约束。

### MCP 与 credential binding

```ts
const rememCredential = credentialFromEnv({
  env: "REMEM_API_KEY",
  domain: "api.remem.dev",
  revision: "workspace-a",
});

const rememMcp = mcpServersExtension({
  remem: {
    url: "https://api.remem.dev/mcp",
    headers: {
      "X-NiceEval-Client": "remem",
    },
    credentialHeaders: {
      Authorization: {
        credential: rememCredential,
        render: "bearer",
      },
    },
  },
});
```

`credentialFromEnv()` 是 env-only opaque runtime binding。factory 与 link 私下保存 selector 以判断冲突，但不求值 `process.env[selector]`；dry plan 也不展示 selector。materialize 在任何 extension 写入前一次性求值。公开 `headers`／`env` 与敏感 `credentialHeaders`／`credentialEnv` 分栏，同一目标 key 不能两边同时声明。

安全 projection 只含目标 slot、credential domain、可选 revision 与 `raw | bearer` render；env selector 与 value 不进入 identity、provenance、manifest 或 dry plan。私有 merge 仍比较 selector：selector 不同不能因为安全 projection 相同而去重。缺值是具名 typed infrastructure failure，可以点名缺失的 `env` 键，绝不打印值。非 env secret manager 在 V1 先由应用把值投递到 env；不开放任意 credential 求值或 transform callback。

credential 普通轮换不要求更新 revision；租户、数据集或权限面改变时必须更新。Agent 主 credential／provider 不属于 extension slot，Plugin 无权替换。

## 跨 Agent 替代实现

共享 Skill／MCP protocol 直接由多个 receiver 接受。只有供应商专属实现才使用显式 choice：

```ts
oneOfAgentExtensions(
  codexNativeExtension({
    plugins: { memory: codexMemoryPlugin },
    hooks: codexMemoryHooks,
  }),
  claudeCodeNativeExtension({
    plugins: { memory: claudeMemoryPlugin },
    hooks: claudeMemoryHooks,
  }),
);
```

`oneOfAgentExtensions()` 只按 selected receiver 对 nominal protocol token 的静态支持选择 branch：

- 同 token branch 在 definition 阶段拒绝；
- 恰好一个匹配后才校验 payload 与参与普通 `resolve`；
- 零匹配列出每个 branch 的 unsupported reason，多匹配报 ambiguity；
- 选中 branch 的 payload、merge 或 materialization 失败直接失败，不回退其它 branch。

它只表达不同 receiver 的替代实现，不是运行时 fallback API。

## Hosted Agent Hook

Hosted Hook 属于 NiceEval owner fragment，不是 `AgentExtension`，也不是 Agent 原生 Hook：

```ts
type HostedHookResult = void | Promise<void>;

interface HostedAgentHooks {
  readonly beforeAttempt?: (
    context: HostedAttemptHookContext,
  ) => HostedHookResult;
  readonly afterAttempt?: (
    context: HostedAttemptHookContext,
    exit: AttemptHookExit,
  ) => HostedHookResult;
  readonly beforeSend?: (
    context: HostedSendHookContext,
  ) => HostedHookResult;
  readonly afterSend?: (
    context: HostedSendHookContext,
    exit: SendHookExit,
  ) => HostedHookResult;
}

type SendHookExit =
  | { readonly kind: "accepted"; readonly turn: Turn }
  | { readonly kind: "send-failed"; readonly failure: SendFailure }
  | { readonly kind: "before-hook-failed"; readonly failure: AttemptFailureInfo }
  | { readonly kind: "interrupted"; readonly failure: AttemptFailureInfo };
```

`beforeSend`／`afterSend` 包住一次逻辑 `t.send()`；Adapter 的全部物理 retry 位于其中，因此两者每次逻辑 send 各运行一次。context 只读暴露 Attempt／Session identity、session ordinal、send ordinal、输入摘要、`AbortSignal`、diagnostic 与 occurrence-local `record()`；它不能替换 prompt、Session 或 Turn。逐 token／逐 retry 观测继续读取标准 events／retry diagnostics。

`AttemptHookExit` 同样是 `completed | failed | before-hook-failed | interrupted` 的穷尽联合；`completed` 只表示基础设施生命周期完成，不取代 Verdict。所有 after 看到相同 immutable primary exit；某个 after 自己失败只进入 teardown aggregation，不改写后续 after 的输入。

Eval 与 Experiment author surface 同批获得 `hostedAgentHooks` 字段。每个 owner 内作者 hook 在前、Plugin hook 按数组顺序接入；Experiment 是外层，Eval 是内层，before 正序、after 依实际登记逆序。Plugin Eval fragment 不再提供含义重叠的 `before`／`after`。Experiment 的 `setup`／`teardown` 仍是每 Run 一次的外层 lifecycle，不能代替每 Attempt／Send Hook。

公共 callback 保持 `void | Promise<void>`；Runner 只在边界适配一次，内部由 Effect v3 Scope 结构化持有。Agent 原生 Hook 只能经 `codexNativeExtension()`／`claudeCodeNativeExtension()` 等 receiver-specific 声明安装。

## 第三方 Adapter SPI

```ts
export const acmeProtocol =
  defineAgentExtensionProtocol<AcmeExtensionSpec>({
    name: "com.acme.agent-extension",
    revision: "1",
  });

export const acmeExtension = (spec: AcmeExtensionSpec): AgentExtension =>
  acmeProtocol.extension(spec);

export const acmeReceiver = defineAgentExtensionReceiver({
  name: "com.acme.agent-receiver",
  revision: "1",
  supports: [acmeProtocol],
  resolve: resolveAcmeAgentPlan,
});
```

`defineAgentExtensionProtocol()` 创建 opaque token，兼容性只认 token 对象身份；reverse-domain `name + revision` 只用于安全展示、诊断与 canonical projection。相同展示 identity 却来自不同 token object 时，link 返回 `protocol-token-collision`，不按字符串兼容。Plugin 直接从 Adapter 包导入 protocol factory，或把协议包设为 peer dependency，避免打包第二份 token。

receiver 显式列出接受的 token，并由 Agent factory 携带；不使用 `Symbol.for`、全局 registry、动态注册或按字符串认领 payload。receiver 的 `name + revision` 进入 Run identity；`resolve`、merge、provision、materialize、redaction 或 cleanup 语义变化都必须提升 revision。

Plugin package、第三方 protocol 与 receiver 都是 application-trusted ESM code。NiceEval 只保证内建 receiver 的 redaction、纯 `resolve` 与资源纪律，不宣称验证或隔离恶意第三方实现。

## 持久事实不在当前 Plugin API

Plugin blueprint 不接受 `recordAttachments.write`，lifecycle context 也没有 `ctx.record()`。
raw definition、family、payload/blob 与 migration registry 方案已经
[退役](../record-attachment-authoring/README.md)。未来若设计高层持久事实 capability，必须由
Plugin 领域单独定义，不得把内部 Record API 包装成公开入口。

## Requirements、identity 与冲突

Requirement 是封闭 typed union。它可表达 reuse group、stop-group、complete-prefix、platform、requested lifetime／resources、runtime profile、Docker access 与 ordered sequence。Plugin 只把 union 值放进 `requirements`，不能暗改对应计划。

每个 owner 先接作者原生片段，再按 Plugin 顺序接贡献。Agent base 是带 provenance 的第一个 Agent contributor，随后是 Experiment Plugin 顺序，最后叠加 Eval pair delta。Skill 按安装名、MCP 按 server name、native Plugin 按 native id、credential 按目标 slot 合并：同 canonical value 去重并保留全部 provenance，异值冲突。

三个 ordered slot 各自按 contributor 顺序追加：

- Agent-native Hook 由 Agent runtime 执行；
- Agent lifecycle command 由 receiver 执行 `StableSandboxCommand`；
- Hosted Agent Hook 由 NiceEval host 执行 callback。

三者不共享 Hook 类型或 context。

framework 自动写入 provenance entry，其中有 name、instance、revision、mount、source、规范化行为 identity 与 accepted contribution refs。identity 只登记不能由 flags、requirements、Sandbox command 或 receiver projection 表达的行为输入；同一输入不重复登记。

## pnpm 示例

```ts
export const pnpm = definePlugin({
  name: "io.pnpm.toolchain",
  behaviorRevision: "1",
  eval(options: { version: string }) {
    return {
      identity: { version: options.version },
      sandbox: sandboxLayer().prepare(command("corepack", [
        "prepare",
        `pnpm@${options.version}`,
        "--activate",
      ])),
    };
  },
});
```

这里的 `.prepare()` 是既有 `SandboxLayer` API，不是 Plugin wrapper。`yarn({ version })` 是另一个具名 Plugin，拥有自己的安装、探测与版本规则。

## migration 边界

Plugin 不能安装 Record migration registry 或 converter。`niceeval migrate` 只使用 NiceEval
内部已知的格式与官方事实迁移，不按 Record 内容动态 import Plugin。
