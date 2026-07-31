**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md)

---

## 结论

采纳 [PLAN-6](PLAN-6/README.md):唯一 Environment 起点,双方在既有 setup 层准备。

## 关键裁决

- Environment 只负责选择起点。它是 profile 或 provider-neutral source,不是 RunningSandboxCase。
- Environment 可以由 Eval 作者声明,也可以由数据集 adapter 从原始 task package 派生。
- SandboxSpec 是唯一解析者。每条 Attempt 只选择一个完整 Sandbox Case。
- 随 Experiment 变化的沙箱准备放 SandboxSpec setup。
- 随 Eval 变化的题目准备放 EvalDef setup。
- Agent CLI 与 runtime 继续由 Agent/Adapter setup 拥有。
- 需要预装命中的准备封装成领域 setup helper,在 helper 内 check/install/recheck。
- 第一阶段不公开 Requirement、Base contribution、依赖 DAG、资源图或自动并行。
- 现场无法组合时复用 `environments[profile]` 提供预制完整 case,或明确 skip/fail。
- `sandboxReuse` 窗口内 SandboxSpec setup 只跑一次,跨 Attempt 会变化的条件禁止放这层。
- 无 identity 的 plain setup 不参与缓存命中,报告标注 setup 身份不可比。

## 真实仓库证据

### Terminal-Bench

本次复核对象是 [harbor-framework/terminal-bench](https://github.com/harbor-framework/terminal-bench) 的 `d28711d0da2675d0bb1d56de45ae5df6082438a3`,不是已经迁移过的 NiceEval 版本。

上游把每道题组织成 task package。
`TaskPaths` 固定从同一目录取得 `task.yaml`、`docker-compose.yaml`、`run-tests.sh`、`tests/**` 与 solution;harness 把 Compose build/up 后的 `client` 交给 Agent,并在 Agent 结束后才复制测试材料。

这证明 Compose 的 owner 是 task package,不是 Experiment,也不应由迁移者逐题重写。
迁移边界应是一份 benchmark adapter:它从原始目录派生普通 EvalDef、Environment source 与 hidden verifier,Experiment 只选择 materializer 并追加自己的 sandbox setup。

### MemoryBench

MemoryBench 的 Experiment 选择 E2B template;mempal 变体使用预装 template 与 sandbox setup/teardown。
具体 Eval 没有 Environment source,而是在 Agent 前 checkout 固定仓库 commit 并安装项目依赖。

这证明反向路径同样存在:Experiment 默认 case 决定起点,EvalDef setup 再准备题目。
它不需要 Eval 再贡献一份 Base,也不需要把 checkout 与 `yarn install` 抽象成 Environment Requirement。

## 为什么 PLAN-5 的 DX 过重

PLAN-5 把四类不同问题同时暴露给作者:

1. 起点所有权:Eval Base、默认 Base、条件 Base 与融合 case。
2. 条件建模:Eval/Experiment Requirement 与 owner 命名域。
3. 调度建模:`dependsOn`、`resources`、single-flight 与多道验证屏障。
4. 正交生命周期:state、Agent runtime、Fixture 与 hidden verifier。

作者为“在最终 Sandbox 装一个工具”付出了理解整个组合系统的成本。
而两家真实仓库只要求两个稳定动作:Experiment 给 Sandbox 装实验工具,Eval 给 Sandbox 准备题目依赖。

PLAN-5 还把 `e2bSandbox({ template })` 与 Eval source 解释成两个 Base 的潜在冲突。
但既有 SandboxSpec 语义已经能表达:有 Eval Environment 时走覆盖/materializer,无 Environment 时才走默认 template。
默认值不是第二份 contribution。

## 候选对照

| 候选 | 作者要理解的公开概念 | 对两个真实方向的处理 | 结论 |
|---|---|---|---|
| PLAN-1 | Environment、Provision | 固定 Eval 环境/Experiment 安装,反向路径别扭 | 否决 |
| PLAN-2 | 单 template、Layer | Compose 被压扁,领域边界丢失 | 否决 |
| PLAN-3 | Eval Case、Experiment Addon | Terminal-Bench 自然,MemoryBench 仍偏向 Eval 起点 | 否决 |
| PLAN-4 | Requirement、Base、Ensure | 两方可贡献,但默认 template 被误判成 Base 冲突 | 否决 |
| PLAN-5 | 两组 Requirement、四档 Base、融合 case、调度图 | 表达力最大,作者面和实现面也最大 | 否决 |
| PLAN-6 | Environment、SandboxSpec setup、EvalDef setup、Agent setup | 两个方向都沿既有 owner 直接表达 | 采纳 |

## 两条迁移路径

Terminal-Bench:

```text
upstream task package
  -> dataset adapter 派生 EvalDef + Compose source
  -> Docker materializer 启动完整 case
  -> Experiment sandbox setup 安装 mempal
  -> Agent setup
  -> turn 后 hidden verifier
```

MemoryBench:

```text
Eval 无 Environment
  -> Experiment E2B template 启动默认 case
  -> Experiment sandbox setup 检查 mempal 预装状态
  -> EvalDef setup checkout + yarn install
  -> Agent setup 与 Agent turn
```

## 预制与真实检查

PLAN-6 不承诺运行时合并两个起点。
若 mempal 不能装进某条 Compose 环境,Experiment 必须在 `environments[profile]` 提供预制完整 case,否则该组合明确 skip/fail。

预制 case 或 template 名不证明工具可用。
`mempalSetup()` 这类领域 helper 必须检查实际版本与 cache identity,缺失时安装或明确失败;执行安装后必须复检。
这保留 PLAN-5 最有价值的真实性要求,但不把通用 Requirement 协议暴露给所有作者。

## 实现边界

第一阶段只需要五项增量:

1. 数据集 adapter 可以批量返回带不同 Environment source 的普通 EvalDef record。
2. SandboxSpec setup 确认作用于最终解析出的主 Sandbox,不只作用于默认 case。
3. EvalDef setup 确认在 workspace baseline 后、Agent setup 前执行。
4. `defineSandboxSetup()` 为少数重准备 helper 提供 identity、check/install/recheck 与 staged payload。
5. 记录所选 Sandbox Case 与三层 setup activity,保留 owner phase。

依赖图、资源锁、跨 helper 自动并行、外部 state API 与 managed hidden verifier 不进入本决策的第一阶段。
出现独立真实样本后再按对应 Feature 扩展,不回填进 Environment contribution。

## 遗留风险

- 预制 case 需要携带构建时写入的 Environment source provenance,规划期才能与当前 source 的内容身份核对。不能从当前 source 动态计算声明值给既有产物背书;在产物元数据与 per-eval fingerprint 拥有同源输入前,不公开 `fulfills` 之类的声明字段。
- benchmark adapter 的 filtered build context 必须默认排除 solution 与 hidden verifier,并检查 Compose bind mount 泄漏。
- 某些工具同时需要安装与跨 Attempt 状态。PLAN-6 保留现有 setup/teardown 写法;若以后引入独立 state lifecycle,应由对应 Feature 单独迁移。
