# PLAN-3（推荐）：增加已安装项目的 Eval 发现根

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 解决的问题

一棵已经能被 NiceEval 发现的 Eval 需要跨项目复用。
发布方不新增共享文件、不转换题目，消费方不复制目录；双方使用同一份依赖内容和同一套 NiceEval 运行契约。

## 核心心智

消费项目把一棵外部 Eval 目录加入现有发现根集合。
来源可以是另一个完整 NiceEval 项目；NiceEval 不要求它先变成一种新资源类型。

```text
已安装 package 中的 Eval root
  + root 内相对 Eval id
  + 消费项目挂载前缀
  = 项目内 Eval id
```

NiceEval 只读取指定 Eval root 及其依赖输入。
来源项目的配置、Agent 与 Experiment 不会进入消费项目。

## 所有权

| 内容 | owner |
|---|---|
| Eval、Task、Sandbox、Fixture、Assertion、Eval 依赖的项目内模块 | 来源 NiceEval 项目 |
| package 版本、Git commit 与传递依赖选择 | 消费项目 package manager 与 lockfile |
| 来源 package、root、挂载前缀与最终 Eval id | 消费项目 `niceeval.config.ts` |
| Agent、model、attempts、flags、预算与运行选择 | 消费项目 Experiment |
| 逐 Eval source、dependency、runtime、transfer 携带与变更解释 | NiceEval fingerprint + manifest |

## 范围

PLAN-3 增加 `Config.evalRoots`、外部根发现、消费运行时绑定、owner capability、逐 Eval 依赖/transfer 身份与 package provenance。
它不增加发布方 API，不改变 EvalDefinition、Experiment、Runner 或 Record 的主线。

外部根是 Node >=22.15 的 feature gate；低版本仍可使用 NiceEval 其它能力，但不能启用该装载路径。
Record 主线不分叉，但须扩展 definition/execution origin，避免把 carry 的旧结果归到新 package commit。

来源可以是 npm registry、私有 registry、Git dependency、tarball 或 workspace dependency。
NiceEval 不解析或安装这些来源，只读取 package manager 已安装并锁定的文件。

## 入口

- [Library](library.md)：消费侧挂载声明与来源形状。
- [CLI](cli.md)：列出、检查、诊断与普通运行。
- [Architecture](architecture.md)：发现、运行时绑定、源码捕获与指纹。
- [Lifecycle](lifecycle.md)：来源项目、安装、升级与结果携带时序。
- [Use Case](use-case/README.md)：Terminal-Bench 完整装配。
