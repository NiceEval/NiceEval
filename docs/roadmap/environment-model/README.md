# Environment 与 Sandbox

Eval 作者只想回答两个问题:题目需要什么环境,Experiment 要额外加入什么条件。
现有设计却要求用户同时理解 sandbox source、sandbox case、materializer、Layer stack、Agent Layer 与 Sandbox Hook。
这些概念大多属于运行器实现,不应成为写第一条重环境 Eval 的前置知识。

本设计从用户任务重新划分公开模型,不沿用现有名词的边界。

## 三种真实项目形态

| 项目形态 | 变化落在哪一侧 | 用户声明 |
| --- | --- | --- |
| 评估环境较重 | 每道 Eval 有自己的 Dockerfile、Compose、系统包或服务 | `eval.environment` |
| 实验环境较重 | 所有 Eval 共用基础环境,但工具、运行时或模型 cache 随 Experiment 变化 | `experiment.provisions` |
| 两边都较重 | 每道 Eval 的环境与每个 Experiment 的工具独立变化 | 同时声明两者,由 Runner 组合 |

第三种形态不是能力上无法运行,而是现有 API 无法可靠表达身份、检查、离线准备与组合关系。
用户只能把安装写进 Hook,或手工维护「Eval 环境 × Experiment 变体」的派生产物。

## 第一性约束

1. Eval 声明题目条件,不选择 Provider。
2. Experiment 选择 Sandbox Provider,不复制每道 Eval 的环境定义。
3. Experiment 增加的软件必须有身份,并能检查实际安装是否与声明一致。
4. Provider 原生支持的 Environment 不要求用户注册转换器。
5. 性能优化不能暗中改变跨 Attempt 状态语义。
6. Fixture 只进入 workdir;环境安装与持久状态都在 workdir 之外。

## 四个公开概念

| 概念 | 回答什么 | 归谁声明 |
| --- | --- | --- |
| Environment | 这道 Eval 需要怎样的题目环境 | Eval 的 `environment` |
| Sandbox | Agent 与测试实际执行命令、读写文件的隔离运行空间 | Experiment 或 Config 的 `sandbox` |
| Provision | 这个 Experiment 要在 Sandbox 中额外确保什么内容存在 | Experiment 的 `provisions` |
| Fixture | 这道 Eval 开始时要写入 workdir 的任务文件与判分材料 | `EvalDef.setup` / `test(t)` |

用户不需要理解 materializer、Layer stack 或 agent Layer。
Runner 内部仍可按 Provider 分派、协调构建、维护资源组和执行有序检查,但这些实现步骤不进入普通调用点。

## `Sandbox` 这个名字保留,但边界收窄

`Sandbox` 只指真实运行空间及其公开操作句柄:`runCommand`、`runShell`、文件读写、上传下载与停止。
Compose 环境里,`Sandbox` 指 `workspaceService` 对应的容器;其它服务属于同一个运行环境,但不冒充主执行空间。

其它对象使用各自的准确名字:

- Eval 的 Compose 或 Dockerfile 声明叫 Environment。
- Provider 根据 Environment 生成的完整计划叫 Environment Plan,只在架构文档出现。
- 主 Sandbox、伴随服务与清理句柄组成 Running Environment,只在 Provider 契约出现。
- `dockerSandbox()` 返回的配置类型叫 `SandboxConfig`,不把配置对象说成已创建的实例。

Experiment 字段仍叫 `sandbox`,因为它清楚回答「Agent 在哪种隔离空间里运行」。
`dockerSandbox()`、`e2bSandbox()` 与 `vercelSandbox()` 的调用点也保留;它们选择 Provider,不会在构造时创建实例。
自定义后端用 `defineSandboxProvider()` 声明;名字直接指出它定义的是 Provider,不冒充运行实例。

## 最小调用形状

### 每道 Eval 自带 Compose

```typescript
// eval.ts
export default defineEval({
  environment: composeEnvironment({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

```typescript
// experiment.ts
export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: dockerSandbox(),
});
```

Docker Provider 原生支持 Compose,不再出现 `dockerComposeMaterializer()` 或 `materializers` 表。

### Experiment 增加 mempal

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: BASE_TEMPLATE }),
  provisions: [mempal],
});
```

Provision 描述目标安装状态。Runner 检查实际身份,缺失或不匹配时安装,随后再次检查。

### 两边都较重

Eval 继续声明 `composeEnvironment(...)`,Experiment 继续声明 `provisions: [mempal]`。
Runner 在 Docker 创建该 Eval 的 Environment 后安装 mempal,不要求任何一侧知道另一侧有多少变体。

## 性能与语义分开

| 成本 | 正确机制 |
| --- | --- |
| Dockerfile 或 Compose 构建慢 | Provider 按 BuildKey 复用构建产物 |
| Provision payload 下载慢 | `prepare` 按 Provision identity 与目标平台 single-flight |
| 稳定工具安装慢 | 预装进 image、template 或 snapshot,Provision 保留检查 |
| Provider 能克隆准备好的全新环境 | Provider 内部透明缓存,每条 Attempt 仍取得隔离实例 |
| 实验本来就要观察跨 Attempt 状态 | 显式 `sandboxReuse: true` |

`sandboxReuse` 不再作为「安装太慢」的默认答案。
它允许 `$HOME`、`/tmp`、全局安装和后台进程跨 Attempt 存续,因此只在实验接受或研究这种状态边界时使用。

## 设计落点

- [Library](library.md) 定义 `composeEnvironment`、`defineProvision`、`experiment.provisions` 与 Sandbox Provider 的公开 API。
- [Architecture](architecture.md) 定义环境解析、身份、能力、准备、生命周期、失败与记录。
- [用例手册](use-case/README.md) 从三种项目形态进入完整代码。

本目录仍是 Roadmap。定稿后会按[迁移表](architecture.md#迁移面)重写 Feature 契约与实现,不让新旧 API 长期并存。
