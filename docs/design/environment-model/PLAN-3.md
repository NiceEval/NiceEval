**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [DECISION](DECISION.md)

---

## 实现方案 3(完整 Sandbox Case + Experiment Addon,推荐)

### 简述

模型保留三个公开领域对象:

- Sandbox Case 描述题目环境和完整运行资源组。
- Addon 描述 Experiment 希望在主 Sandbox 中成立的工具状态。
- AgentProvisioner 描述 Adapter 启动 Agent 所需的身份、准备、检查与安装。

Addon 与 AgentProvisioner 共用底层安装资源调度器,但不共用同一个公开协议。
Fixture、Sandbox 状态 Hook 与宿主侧 Experiment 生命周期继续留在各自现有位置。

### 题目环境:继续使用完整 Sandbox Case

folder-local Eval 直接声明 source:

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

Experiment 的 SandboxSpec 可以为同一个 profile 提供完整预制 case:

```typescript
e2bSandbox({
  environments: {
    "terminal-bench/sheets": { template: "acme/tb-sheets-v5" },
  },
});
```

显式 `environments` 表项优先于 folder-local materialize,因此预制产物只是同一 Sandbox Case 槽位的优化实现。
它不要求把 Compose 多服务环境压成单个 template,也不引入第二套安装协议。

普通 Provider 对内建 source kind 自动带 materializer。
用户只有在接入自定义 source kind 或自定义 Provider 时才注册 materializer;写第一条 Compose Eval 不需要额外接线。

### Addon:Experiment 工具的低成本协议

```typescript
const companyCertificates = defineAddon({
  name: "company-certificates",
  identity: { bundleDigest: COMPANY_CA_SHA256 },
  resources: ["system-ca"],
  check: async (sandbox) => inspectCompanyCertificates(sandbox),
  install: async (sandbox) => installCompanyCertificates(sandbox),
});

const mempal = defineAddon({
  name: "mempal",
  identity: { version: "0.9.0", installerDigest: MEMPAL_SHA256 },
  dependsOn: [companyCertificates],
  resources: ["npm-global"],
  check: async (sandbox) => inspectMempal(sandbox),
  install: async (sandbox) => installMempal(sandbox),
});

export default defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox(),
  addons: [companyCertificates, mempal],
});
```

最小 Addon 有四项义务:

1. `name` 在一次 Experiment 的解析结果内唯一。
2. `identity` 是可序列化目标身份,进入 configHash 与 `run.json`。
3. `check` 返回实际状态与不匹配原因,不只返回 boolean。
4. `install` 成功后框架重跑同一个 `check`;复检失败按环境准备错误处理。

框架提供 `commandAddon`、`aptPackages`、`npmGlobalPackages` 等 helper,消除常见检查与安装样板。
自定义 Addon 仍必须提供真实检查,不能只写 manifest。

Addon 可以提供可选的宿主侧 `prepare(ctx)`。
它在实际检查未命中后按 Addon identity 与目标平台 single-flight,用于下载、校验并缓存题面网络之外的 payload。
`install` 经 Sandbox 文件 API 消费准备结果;payload digest 必须成为声明 identity 或解析后的目标身份,不能只藏在函数闭包里。

### 调度:默认串行,安全部分并行

`addons` 是声明集合,数组位置不表达执行顺序。
调度器先校验重名、缺失依赖和依赖环,再建立 DAG。

- 未声明 `resources` 的自定义 Addon 使用保守的 `sandbox-mutation` 资源,彼此串行。
- helper 自动声明准确资源;不同资源且依赖已经满足的 Addon 可以并行。
- 相同资源互斥,例如两个 `npm-global` 安装不会同时修改 prefix。
- `dependsOn` 只表达语义依赖,不兼任资源锁。
- 多个失败分别保留诊断;依赖失败的 Addon 标记为 blocked,不执行安装。

AgentProvisioner 在 `agent.setup` 阶段继续执行自己的 Ensure。
它可以复用同一套资源互斥与宿主侧准备协调设施;但 Agent check、安装模式、启动条件与安装事实仍归 Adapter。

### 检查缓存与预制环境

Addon 不以受管 manifest 作为状态证明。
预制环境第一次使用时照常执行 `check`;检查命中就没有安装动作。

框架可以缓存同一 Sandbox 实例内的成功检查。
缓存键至少包含 Sandbox 实例代次、Addon identity 与最近一次可能冲突的资源修改代次。
Sandbox 重建、reset 触及安装目录或同资源安装完成后,对应缓存失效。

### 生命周期、身份与错误

Addon 在 Sandbox Case ready 之后、SandboxSpec setup Hook 之前执行;状态 Hook 因此可以使用已经检查就位的工具。
Addon 与 SandboxSpec Hook 都归 `sandbox.setup`,随后才建立变更分类账锚点并进入 Eval Fixture 与 Agent setup。
同一 Sandbox 被多个 Attempt 复用时,每次派发都走检查;缓存命中可以省掉实际命令。

身份分层如下:

```text
configHash  += Experiment Addon 的 { name, identity, dependsOn, resources } 集合
configHash  += AgentProvisioner identity 与 staged payload 身份
fingerprint += Eval environment + 解析后的 Sandbox Case 身份
fingerprint += Addon 按目标环境解析出的平台与 payload 身份
```

Addon 集合参与哈希前按 `name` 排序。
Addon 声明进入 `run.json`;逐环境解析身份进入对应 eval 的指纹清单,因为同一实验可以包含不同目标平台。
运行记录保存每个 Addon 的检查结果、是否安装、复检结果与耗时。

配置非法在创建 Sandbox 前一次穷举报错。
Addon 检查或安装失败只让依赖该 Sandbox 的 Attempt `errored`,phase 归 `sandbox.setup`;它不是 Agent 做题失败。

### 优势

- 保留 Sandbox Case 对 Compose、多构建产物、能力与资源组的完整表达。
- 添加普通工具只有一个 Addon,常见场景由 helper 进一步缩短。
- 实际检查是默认契约,不会把历史 manifest 当成当前状态。
- 用户不维护顺序;调度器保守正确,并能在明确资源边界后并行。
- Agent Ensure 保留完整领域义务,同时可以复用资源互斥设施。
- 声明身份与目标环境解析身份从一开始就分配到 configHash 与逐 Eval fingerprint,不会在 Feature 阶段补猜。

### 缺点

- 公开面保留 Sandbox Case、Addon、AgentProvisioner 三个概念,数量多于统一 Layer。
- 自定义 Addon 要写真实 `check`;框架只能用 helper 消除常见工具的样板。
- 资源名是一套需要维护的开放词表;声明过细会产生竞态,声明过粗会损失并行。
- 第一版默认串行会牺牲一部分冷启动速度,后续通过内置 helper 的资源声明逐步收回。

### 落地路线

1. 保留现有 Sandbox Case 与 AgentProvisioner 契约,只移除普通 Compose 用户必须手工注册 materializer 的接线。
2. 定稿 Addon 类型、检查结果、运行事实与错误码。
3. 实现 DAG 校验和资源互斥调度,第一版允许只提供保守资源。
4. 添加常用 helper,并让内置 AgentProvisioner 声明安装资源。
5. 把按 Experiment 变化的稳定工具从无身份 Sandbox Hook 迁入 Addon;状态 Hook、Fixture 与外部服务不迁移。
6. 接入 configHash、逐 Eval fingerprint、`run.json`、`--dry` 差异解释与结果携带门。
