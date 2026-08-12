# Plugins —— Architecture

## Owner-scoped link

Plugin factory 在作者构造 Definition 时执行，产出深冻结 occurrence。Link 在 Provider planning 前按每个 Eval × Experiment pair 组合 Experiment、Group 与 Eval occurrence，不再次执行 callback。

Link 拒绝不支持的 owner、Agent receiver 不匹配和 pair 内重复 `(name, instanceKey)`。多 owner callback 只表示 family 可用于多个位置；一次 attachment 只应用当前 owner 的 fragment。

作者贡献先于同 owner 的 Plugin 贡献。Experiment、Group 与 Eval 的 command-only layer 都保留 owner provenance，不把失败压成另一个 owner 的 prepare 阶段。

## Behavior identity

每个 occurrence 的 `name`、`instanceKey`、`behaviorRevision`、owner 和行为贡献进入身份。Experiment Plugin 的行为与 AgentExtension canonical projection 进入 `configHash`；Eval、Group 与 Experiment occurrence provenance 进入 pair fingerprint。

Group membership、policy、Eval 与 Group resource demand、selected resource envelope、receiver 和 physical plan 同样进入 pair fingerprint。重排 Group 的 `evals` 数组不改变身份；增加或删除成员会改变身份。

Labels、credential values 与 runtime facts 不进入行为身份。Labels 可以出现在审计面的 contribution kinds 中，但不能因此让旧结果失效。

## Demand cohort 与 physical resource envelope

一个 demand cohort 是同一台计划中 physical Sandbox 服务的 selected demands 集合。Runner 在 carry planning 前为每个 cohort 冻结唯一 resource envelope。Envelope 同时容纳 Group 与 Eval demand，不为 Group 再建第二套资源系统。

| demand scope | 基数 | prepare 适用面 |
|---|---|---|
| `group` | 每个 Experiment × Eval Group × Group occurrence 一份 | 该 Group 每条真实 Attempt |
| `eval` | 每个 Eval × Experiment pair occurrence 一份 | 当前 Eval 的每条真实 Attempt |

两类 demand 不按 payload 静默去重。同一个 resource definition 可以聚合两类 demand；callback 只收到 deep-frozen typed payload，不得到 core provenance accessor。需要按 scope 改变行为时，Plugin 作者使用不同 definition，或把 scope 写进自己的 payload。

| cohort | materialize | prepare |
|---|---|---|
| 全量 carry | 不创建 Sandbox，不执行 | 不执行 |
| fresh pair | 每台物理 Sandbox 一次完整 envelope | 每条真实 Attempt |
| Sandbox reuse / Eval Group | 每台物理 Sandbox 一次完整 envelope | 每条真实 Attempt |
| replacement | 新实例重新 materialize | 后续真实 Attempt |

Partial carry 仍冻结一份 Group demand和所有 selected Eval demand，保持物理形状不依赖哪些成员本次 fresh。只有真实派发的 Attempt 执行 prepare 与 command；carried、预算未派发、首过即停和取消的 slot 不执行。

## Closed audit schema

行为投影与审计投影分开。Fingerprint 与 `configHash` 只消费 behavior projection；`--dry`、manifest 与差异解释消费下面的 credential-free audit projection。

Occurrence 投影是闭合结构：

```ts
type PluginOccurrenceAudit = {
  owner: "eval" | "experiment" | "group";
  ownerSource: { id: string; source: string; position: number };
  name: string;
  instanceKey: string;
  behaviorRevision: string;
  contributions: readonly (
    | "identity"
    | "flags"
    | "labels"
    | "sandbox-commands"
    | "experiment-lifecycle"
    | "agent-extension"
    | "sandbox-resource"
  )[];
  receivers: readonly string[];
};
```

Resource envelope 投影同样闭合：

```ts
type PluginResourceEnvelopeAudit = {
  cohort: { kind: "fresh-pair" | "sandbox-reuse" | "eval-group"; id: string; physical: string };
  demands: readonly {
    scope: "eval" | "group";
    owner: { id: string; source: string; position: number };
    plugin: { name: string; instanceKey: string; behaviorRevision: string };
    receiver: string;
    resourceRevision: string;
    projection: JsonValue;
  }[];
};
```

普通 `--dry` 的人读与 JSON 输出直接展示 occurrence 与 envelope，不要求用户解读哈希。`--dry --commands` 另外按 physical / Attempt 时序展示 materialize、prepare、commands 与 release。运行后的 manifest 保存同源 provenance。

Env、MCP header 等凭据只允许投影键名；任何 credential value 都不得进入 dry、manifest、fingerprint delta 或错误详情。

## Receiver boundary

Core 把 AgentExtension payload 与 resource token 当成 opaque value。Receiver 组合原生配置并产生 credential-free behavior projection。Plugin 不能替换 Agent，也不能通过 contribution 修改 Sandbox template 或 Provider。

