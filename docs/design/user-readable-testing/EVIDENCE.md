# 现状与历史证据

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)

本页记载本次决策审阅过的测试结构、代表性实现和历史提交。
数字用于说明规模与结构，不作为质量分数。

## 审计参照切面

在 `c12aeeb27d4f` 对 tracked `*.test.ts(x)` 做静态统计：190 个文件、52,624 行，以及 2,227 个
`it` / `test`。Runner 约占 18,567 行、623 个测试；Report 约占 11,706 行、590 个测试。
这不是会自动更新的“当前数字”，而是本次决策可复算的历史参照。

单个 `src/runner/run.test.ts` 在该参照快照中有 5,319 行和约 106 个测试。
它同时包含大型 FakeSandbox、RunOptions 装配、全局 fake timer，以及捕获真实墙钟的双时钟协议。

[`cases-registry.lint.ts`](../../../lint/docs/cases-registry.lint.ts)只校验测试文件前 20 行的一条 `// cases:`。
因此，测试文件与 Feature 测试文档有连接，但场景、`覆盖类别`与具体证明没有机器映射。

Runner 测试文档按粗粒度`覆盖类别`组织，无法替代具体结果 owner 与原生测试标题之间的连接。

## 代表性提交

| Commit | 改动与后续结果 | 对本决策的证据 |
|---|---|---|
| `02fb24d5` | 建立 view “E2E harness”，但只运行 mock agent / judge，失败路径最终仍 `exit 0`；次日删除 | 用户项目形状不等于真实用户边界；不能重建 offline fake E2E |
| `84650302` | 用真实 CLI 测“模型拒绝识图却误判通过”，但输入是 mock 协议，断言读取私有 `.fasteval` 文件；后来删除 | 用户标题可以很好读，但主证明仍必须选对观察面 |
| `b66929af` | 审计发现 45% 测试来自临时 worktree 副本，并发现结果层测试过密、断言与 expect 风险区缺口 | 测试预算应按错误静默发布的风险分配，不按哪里容易写 |
| `6abccb8b` | 建立 unit / E2E 两层、60 秒预算与每 Feature 场景表；单次增加 1,838 行 | 两层边界有效；把场景再抄进 docs 的成本过高 |
| `d5b54472` | 审计 888 条测试，删除约 40 条无区分力断言，并引入 `// cases:` Registry | 区分性与登记有效；文件粒度不足以表达用户行为主证明 |
| `6458af5a` | 删除 adapter wire fixture 与离线结构测试，把协议兼容性交给真实 Adapter E2E | 确定性转换可 unit，真实协议兼容性必须 E2E |
| `998ebeef` | 用`覆盖类别`替换逐场景表，删除 1,862 行重复文档 | 不应恢复手写场景镜像；粗类别也不能无限膨胀 |
| `aabf22cc` | 把 Report E2E 拆成一次 `produceEvidence()` 与多个消费者 | 一次昂贵取证、多面复用是正确所有权 |
| `5c5f5b95` | 从候选包导入 schema version，避免 fixture 漂移 | 同源信息会让实现与测试一起错，减少漂移不是最高目标 |
| `89ba8e64` | 恢复签入 E2E 仓库的独立 schema 预期，并删除三套离线进程 fixture | 独立 oracle 与真实边界优先于方便复用 |
| `17222e0c` | E2E 因散点标题不匹配而失败，随后读取 renderer 输出并放宽 regex | 从当前实现学习期望会把测试降成实现镜像 |
| `ac571d96` | 为负载 flaky，在全局 fake timer 中捕获真实 `setTimeout` 并按墙钟推进 | 修复了症状，却形成难读的双时钟协议；机制证明需要显式 TestClock 与 barrier |
| `022c0adc` | 删除 1,106 行 show / view 单测，把用法错误矩阵迁到真实 CLI E2E | 用户可见错误由真实 CLI 证明后，测试更接近用户任务 |
| `84d46091` | evidence schema 升版同时修改 20 个测试文件 | 完整生产 DTO fixture 会把内部字段变化扩散到无关测试 |
| `031ce196` | Report E2E 必须把只读验证排在会追加快照的 readback 之前 | 共享可变结果把调用顺序变成隐藏测试契约 |
| `32f2df7f` | 一次增加 71 个测试方案 / 示例文件、5,519 行 | Behavior / World / DSL 元平台压过测试正文，不适合作为每条测试的必经层 |

## 已被历史反复验证的原则

### 保留

- unit 证明确定性数据与机制语义，E2E 证明真实包、协议、进程和浏览器边界。
- E2E 的关键预期由测试侧独立声明，不能从候选实现派生。
- 一次昂贵运行生成证据，多个只读验证面复用。
- Fixture 要区分正确实现与常见错误实现。
- 测试预算按静默风险分配。
- 用户能复制的原始命令与带下一步的失败信息值得保留。

### 不再重复

- mock 协议加真实 CLI 的离线伪 E2E；
- unit 与 E2E 同时锁完整渲染字节；
- 在 Markdown 再抄一份测试场景；
- 一个巨型过程式测试承载多个用户能力；
- 全局 fake timer 与真实文件系统、墙钟混用；
- prepare 之后继续修改共享 evidence；
- 用候选 schema、renderer 文案或本次输出生成 oracle。

## 文档之间的直接矛盾

[测试总纲](../../engineering/testing/README.md)与 [Report E2E](../../engineering/testing/e2e/report.md)把真实 text / HTML 设为 E2E 的唯一验收面。
[`unit/reports.md`](../../engineering/testing/unit/reports.md)却仍要求若干 text 字符串与 HTML 输出断言。

[Report 读面 DSL](PLAN-2/README.md) 曾试图统一结构识别、evidence 生命周期和公共 verifier。
该抽象已随 PLAN-2 留在 Design；选定方案只提取机械 parser 与 browser 工具，并把领域 expected 留在原生测试。
浏览器审阅仍遵守 [Insight](../../feature/insight/README.md)，场景 Repo 仍遵守 E2E 自治，两者不需要一套新的产品对象模型才能成立。

这些冲突说明，媒介 parser 的稳定性只是问题的一部分。
测试作者面还需要先裁决证明对象、主证明所有者和 evidence 生命周期。

## 怎样解释 churn

历史中约 327 个提交直接触碰 `*.test.ts(x)`。
这个数字不能推出测试质量差。

beta 契约演进会合理地修改高质量行为测试。
设计试点必须把变化分成四类：

1. 公开契约改变；
2. 内部实现重构；
3. transport 或媒介表示改变；
4. 外部协议改变。

目标不是让测试少变化，而是让每类变化只触及拥有对应证明对象的测试。
