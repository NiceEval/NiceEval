# Proof Portfolio 与测试退役

## 目标

测试组合的优化目标不是覆盖率最大，也不是测试文件最少，而是：每个会静默进入发布的错误都有最早、稳定、
唯一的证明 owner，同时不让内部结构变化要求成批改写无关测试。

Portfolio 以 Behavior 和机制风险为单位管理全部 unit、structure 与 E2E proof。目录、测试框架、函数和类型不是
新增 proof 的理由。

## 两种存在资格

每条测试只能以一种身份进入 portfolio：

| 身份 | 存在资格 | 数量规则 |
|---|---|---|
| Behavior 主证明 | 证明一个稳定用户结果；从最低成本的完整公开边界进入 | 每个 Behavior 恰好一个 |
| Mechanism proof | 主证明无法确定制造或无法直接定位的机制错误算法 | 每个具名机制风险一个矩阵 owner |

boundary proof 是主证明缺少真实边界时的补充角色，不获得复制产品矩阵的资格。supporting proof 是已有
mechanism proof 与 Behavior 的诊断关联，也不因此新增测试。

以下理由不能让测试获得存在资格：

- 新增了函数、分支、类型、字段或目录；
- 同一场景换成 human、JSON、text、web 或另一种 renderer 再测一遍；
- 为了提高 line / branch coverage；
- snapshot 已经存在，删除看起来不放心；
- 另一个测试离实现较远，所以再写一个贴近实现的副本。

## 唯一矩阵 owner

一个等价类矩阵只能有一个 owner。例如 fingerprint 输入的进 / 不进、版本迁移和差异原因矩阵由 mechanism
unit proof 拥有；carried 用户任务由 Behavior 主证明拥有；JSON schema 只拥有编码形状，不复制 carried 决策矩阵。

其它 proof 可以选一个有区分力的代表验证接线，但不能复制完整矩阵。代表 case 的期望来自 owner 已声明的领域事实，
不 import owner 的候选算法现算。

```text
fingerprint mechanism matrix ──产出──▶ CarryDecision
                                           │
                         ┌─────────────────┼─────────────────┐
                         ▼                 ▼                 ▼
                  Human projection    JSON projection    Run dispatch
                  一个接线代表        schema + 一个代表   Behavior 主证明
```

Human 与 JSON 如果声明跨媒介相等，这个关系本身是一条 Behavior；否则各自只证明独有契约，不能各复制一次
完整 CarryDecision 矩阵。

## 稳定 fixture 边界

测试不得在不关心某字段时直接构造完整生产 DTO。每个 portfolio owner 提供自己的最小 fixture builder：

```ts
manifestFixture({ config: { model: "old" } });
comparisonFixture.changed({ selector: "config:model", from: "old", to: "new" });
carryWorld({ prior: "passed", currentInput: "same" });
```

规则如下：

- 参与本 case 身份与语义的字段由测试显式填写；
- 当前合法 schema 的机械默认值由 builder 填充；
- 版本兼容测试绕过默认值，显式构造旧格式；
- builder 返回领域输入或公开入口句柄，不暴露生产对象的完整内部形状；
- production DTO 新增字段时，只有该字段属于 case 语义的测试可以被迫修改。

builder 不能复制候选决策算法。它只造输入，不计算预期的 carried、verdict、delta 或 summary。

## Retirement Manifest

新增 Behavior、扩大主证明或迁移矩阵 owner 时，必须与代码同批提交一份静态 retirement declaration：

```ts
retireProofs({
  replacement: "runner.carry-stable-results",
  removes: [
    "runner.fingerprint.full-carry-matrix-in-human",
    "runner.fingerprint.full-carry-matrix-in-json",
  ],
  merges: [
    {
      from: ["runner.fingerprint.input-flags", "runner.fingerprint.input-agent"],
      into: "runner.fingerprint.identity-matrix",
    },
  ],
  keeps: [
    {
      proof: "runner.fingerprint.version-migration",
      risk: "旧 manifest 与新算法的等价迁移无法由一次用户 E2E 穷举",
      wrongAlgorithm: "只凭 manifest 内容相同就接受未知版本",
    },
  ],
});
```

这不是永久产品元数据。迁移批次完成、Registry 验证旧 proof 已消失后，生成迁移报告并删除 declaration。
签入历史由 Git 保留。

静态守护必须拒绝：

- `removes` 指向仍被收集的测试；
- `merges` 的旧 owner 仍保留完整矩阵；
- `keeps` 没有具名 wrong algorithm；
- 新主证明没有 retirement declaration，也没有声明 `netNewReason`；
- 一个 proof 同时被两个 replacement 宣称替代。

## 数量预算

数量预算按 proof 与 scenario matrix 计算，不按 `it()` 或文件行数计算。表驱动展开的十个 case 是一个矩阵，
十处复制的单 case 是十个 proof 负担。

每个迁移批次输出：

| 读数 | 含义 |
|---|---|
| Behavior 主证明数 | 稳定用户结果数量 |
| mechanism matrix 数 | 主证明之外保留的独有机制风险数量 |
| duplicated matrix 数 | 同一等价类在多个 owner 完整展开的数量；目标为 0 |
| retired proof 数 | 本批实际删除或合并的旧 proof |
| net proof delta | 新增减去退役；必须逐项解释正增长 |
| fixture blast radius | 一个 production DTO 加无关字段时受影响的测试 owner 数；目标为 0 |

不设置“每个 Feature 最多 N 条测试”的机械上限。硬门禁是唯一 owner、保留理由与 duplicated matrix 为 0。
Feature 新增真实用户能力时可以净增加；纯实现重构的净 proof delta 必须小于等于 0。

## Escape Audit

一个 bug 逃逸时先升级现有 owner，不默认新增测试：

1. 找到本应捕获它的 Behavior 或机制矩阵；
2. 若 owner 命题过窄，扩大命题并删除被替代 proof；
3. 若 observer 假绿，修 reader / matcher，自测 malformed 输入；
4. 只有现有 owner 无法表达第二个独立错误算法时，才新增 proof；
5. 在旧 bug 逆补丁上验证升级后的 proof 失败，在非契约扰动上仍通过。

每个 bug 一个回归测试的策略被禁止。历史 commit 可以登记到同一个 Behavior 的 `bugs`，不增加主证明数量。

## Review 问题

评审一批测试变更时按顺序回答：

1. 用户契约是否真的改变，还是 production DTO 改了？
2. 哪个 portfolio owner 应该捕获本次错误？
3. 新 case 是否让正确算法与一个具名错误算法产生不同结果？
4. 完整矩阵是否已经在其它层存在？
5. 新主证明替代了哪些旧测试，它们是否已实际删除？
6. 一个无关 production 字段变化还会让多少测试 fixture 编译失败？

无法回答第 2、3 项的测试删除；第 4 项重复时合并；第 5 项没有退役动作时不接受“先加以后再删”。
