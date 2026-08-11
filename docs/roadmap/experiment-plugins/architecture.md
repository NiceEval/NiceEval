# Experiment Plugins —— Architecture

## 从 Blueprint 到运行计划

插件经过现有定义管线,不建立旁路 runtime:

```text
ExperimentPlugin blueprint
        │ defineExperiment({ plugins })
        ▼
Linked Plugin Instance       每个 Experiment × plugin occurrence 独立
        │
        ├─ Experiment contribution ──▶ Experiment scope
        ├─ Sandbox command layer ────▶ 每个 linked pair / physical Sandbox
        ├─ AgentExtension ───────────▶ Agent receiver
        └─ staged requirements ──────▶ selection / link / physical planning
```

同一个 blueprint 可以被多个 Experiment 引用。link 为每个 occurrence 创建独立 instance;blueprint 和模块级闭包不能保存运行时 mutable state。

运行时状态由 Experiment、physical Sandbox 与 Attempt 三个既有 scope 分配。父 scope 可以向子 scope 提供只读 handle,例如 Experiment setup 得到的服务坐标;子 scope 不能反向修改父 scope,Attempt 状态也不能泄漏给另一个 Attempt。

## Core 与 Agent receiver 边界

Agent 特殊性继续留在 Adapter。core 只做三件事:

1. 按插件顺序收集 receiver-branded AgentExtension;
2. 检查当前 Agent 是否暴露同 identity 的 receiver;
3. 接收 receiver 返回的新不可变 Agent、canonical behavior projection 与 manifest projection。

core 不读取 Codex config、MCP、native plugin、hook 或鉴权字段。receiver 按自己的具名槽位完成规范化、冲突检查与时序接线;不支持的 receiver 或冲突在 pure link 阶段聚合报错。

这条边界也保证凭据只有一个 producer。Remem worker 使用 Codex Adapter 已求值的 effective runtime auth / provider binding,而不是再次读取 `CODEX_API_KEY` 或 `CODEX_BASE_URL`。受管 transport 在最后边界取得值、注入子进程并登记脱敏;没有 `ctx.resolveBinding(): string` 一类把秘密交给 plugin callback 的通用 API。

## 身份与哈希

插件身份分为静态可观察投影与行为投影:

```ts
interface ExperimentPluginRunInfo {
  readonly name: string;
  readonly instanceKey: string;
  readonly behaviorRevision: string;
  readonly contributions: JsonValue;
  readonly provenance: JsonValue;
}
```

`ExperimentRunInfo.plugins[]` 保存有序 Linked Plugin Instance 的静态 identity、规范化贡献摘要与 provenance。插件贡献的 labels 可以在这里说明声明方,但配置求值后的消费面仍是 `ExperimentRunInfo.labels`。

config hash 不哈希原 factory options或整份 manifest。它消费各 owner 产出的 canonical effective behavior:

- 非 Agent 行为由 plugin behavior revision、非重复 behavior 输入、已求值 flags 与 Sandbox / Experiment 行为贡献表示;
- Agent 行为只由 receiver 的 canonical behavior projection 表示;
- labels 不进入哈希;
- requirements 不独立进入哈希,其验证对象的完成态 plan 按原契约进入哈希;
- credential value 与 selector 不进入哈希,显式 credential revision 才表达会改变行为的租户或端点代次。

每个哈希输入都有同源 manifest 投影,但同一个值不以原 options、plugin identity 与 receiver projection 三种形态重复出现。

## 两级 Requirement 证据

Requirement 声明与实得事实不全属于 Run 公共事实:

- `ExperimentRunInfo.plugins[]` 只保存静态 requirement 声明摘要;
- 每个 Eval × Experiment pair 的既有 plan / fingerprint manifest 保存该 pair 的 requirement、实得 group / Sequence / provider plan / requested lifetime 与验证结果。

静态插件投影不复制进每个 Eval;逐 pair 的 provider 或 group 事实也不提升成整份 Run 的共同事实。

## Provenance 与 phase

插件的 Sandbox contribution 仍由 Experiment owner 负责,沿用 `sandbox.prepare.experiment` 等既有 phase。执行与诊断上下文增加只读 provenance:

```ts
type ContributionSource =
  | { readonly kind: "author"; readonly owner: "eval" | "experiment" | "agent" }
  | {
      readonly kind: "experiment-plugin";
      readonly name: string;
      readonly instanceKey: string;
    };
```

`contributionSource` 用于错误、diagnostic、fact 与 manifest 定位,不是新的生命周期 owner 或 phase。Record 消费方仍可按唯一 `LifecyclePhase` 词表归因。

## 强杀恢复

需要跨进程补做的 Experiment teardown 在磁盘登记有序 Linked Plugin Instance behavior identities。恢复命令重新 link 当前 Experiment:

- 身份完整匹配才执行当前定义的组合 teardown;
- 插件删除、重排、升级或配置变化导致不匹配时不猜测,保留未解决义务并给出手动恢复方向;
- 跨进程资源必须使用插件自己声明的稳定、持久、幂等 resource id,不能依赖旧进程闭包。

普通 Attempt 与 physical Sandbox 的进程内 finalizer 继续由现有 Scope 管理,不因插件增加第二份恢复注册表。
