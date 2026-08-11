# Experiment Plugins

## 解决的问题

一个实验条件经常同时占据多个既有声明面。MemoryBench 的 Remem 条件需要:

- 在 Experiment 上声明条件身份与静态约束;
- 给 Sandbox layer 增加二进制探测;
- 在 Codex Adapter 的配置、安装后与收尾槽位接入 hook;
- 复用 Adapter 已求值的模型、provider 与鉴权;
- 把版本、模型和运行事实投影进 Record。

这些动作属于同一个“Remem 条件”,现在却由下游构造函数返回多个互不约束的 fragment,Experiment 作者必须知道每个 fragment 放在哪一层、按什么顺序收尾。漏接其中一项仍能通过 TypeScript,直到真实批跑才表现成记忆没有积累、后台提炼未排空或结果身份错误。

## 核心心智

**Experiment Plugin 是一个可复用的实验条件蓝图。**

它在 `defineExperiment({ plugins })` 中一次出现,向现有 Experiment、Sandbox 与 Agent 声明槽位贡献内容。NiceEval 在 discovery、link 与 planning 中为该 Experiment 建立私有的 Linked Plugin Instance,再把贡献编入唯一的既有运行时生命周期。

Experiment Plugin 不是新的运行时、依赖注入容器或 marketplace。它不替换 Agent、不选择 Sandbox template、不修改模型、并发、预算或 Eval 选择。Codex / Claude Code 自己的 marketplace plugin 统一称为 **Agent Native Plugin**,两者不是同一个概念。

```ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerImageSandbox } from "niceeval/sandbox";
import { REMEM_DOCKER_IMAGE, remem } from "@memorybench/remem-niceeval";

export default defineExperiment({
  ...memoryExperimentBase,
  agent: codexAgent(),
  sandbox: dockerImageSandbox({
    image: REMEM_DOCKER_IMAGE,
    lifetimeMs: 5 * 60 * 60_000,
  }),
  plugins: [remem({ memoryModel: "gpt-5.6-luna" })],
});
```

这里的 base 必须是中性公共输入,不能带 `{ memory: "baseline" }` 一类变体字段。无记忆对照与 Remem 分别贡献自己的条件值;插件不把作者值当成可替换默认值。

## 框架保证

- `plugins` 按数组顺序组合;相同插件实例身份重复出现直接报定义错误。
- 独占槽位不做 last-wins,按 key 的槽位不做隐式替换,冲突在创建外部资源前聚合报告。
- 插件只接入既有 lifecycle phase;不新增 `plugin.*` phase 或第二条收尾链。
- setup / teardown 在各自资源作用域内成对、逆序收尾;并发 Attempt 之间没有虚构的全局顺序。
- Agent 专属贡献由该 Agent 的 opaque receiver 规范化;core 不读取 payload,也不按 Adapter 名字分支。
- 配置求值后的行为 projection 进入现有 config hash;纯报告 labels 仍不使结果失去携带资格。
- 静态 requirements 在最早拥有所需事实的阶段验证;requirements 只拒绝不合法计划,不暗改计划。
- 插件定义、计划、manifest、hash 与错误都不持有凭据明文。

NiceEval 只保证自己在 discovery / link 时不求值 runtime binding、不调用 lifecycle、不主动替插件执行外部 I/O。插件是可信 TypeScript;模块 import 与 factory 保持纯函数是作者契约,框架不宣称能沙箱化或证明这项纯度。

## 与 Remem 状态语义的边界

`remem()` 默认表示 `mode: "accumulated"`:成员 N 要读取本轮成员 N-1 留下的状态。该模式要求 stop-group 的物理连续性与[有序 Eval 序列](../ordered-sequences/README.md)的 complete-prefix 执行;普通 `maxConcurrency: 1`、Sandbox 复用或文件名字典序都不足以证明这条历史。

不需要跨 Eval 历史时必须显式写 `mode: "isolated"`。它只安装并验收单 Attempt 内的 Remem,不对跨 Eval 记忆作任何承诺,也不会从 accumulated 静默降级。

当前 Ordered Sequences 一次 Invocation 只接受一个 Experiment 与一个 Sequence。因此 MemoryBench 的六个独立 Remem group 在 accumulated 模式下是六次 Invocation,不是原先的一条批命令。本主题不顺带扩展 multi-Sequence Invocation,也不宣称保持原命令拓扑。

## 范围

包含:

- `defineExperiment({ plugins })`、`defineExperimentPlugin()` 与插件身份;
- Experiment、command-only Sandbox layer 与 Agent extension 三类贡献;
- 分阶段 requirements、组合冲突、指纹与 manifest;
- 各现有资源作用域内的 setup / teardown 顺序与强杀恢复身份;
- Remem 的 accumulated / isolated 用例。

不包含:

- 动态下载或隔离执行第三方插件;
- 替换 Sandbox template、provider、lifetime、resources 或 Agent;
- 自动打开 Sandbox 复用、创建 group / Sequence、修改并发或禁止 carry;
- 任意字符串 capability registry;
- 读取 provider identity、镜像名或 Dockerfile 猜测镜像内容;
- 一条 Invocation 运行多个 Sequence;
- 为插件增加返回 secret 明文的通用函数;
- 实现或发布 Remem 官方插件包。

## 入口

- [Library](library.md) —— `plugins`、`defineExperimentPlugin()`、贡献与 requirements 类型
- [Architecture](architecture.md) —— link、Agent receiver、冲突、身份与 Record 投影
- [Lifecycle](lifecycle.md) —— 三个资源作用域、调用顺序、失败与强杀恢复
- [Remem 用例](use-case/remem.md) —— 当前手工接线如何收进一个插件
- [NiceEval-Eval 候选 Runtime](use-case/niceeval-eval-candidate-runtime.md) —— 候选身份、就绪验证与 template 构建的边界
- [Terminal-Bench Harness](use-case/terminal-bench-harness.md) —— 异构 Eval pair 上的公共条件与不应插件化的 Oracle
