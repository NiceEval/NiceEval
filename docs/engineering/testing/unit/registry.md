# Unit 例外登记：先声明，后写测

每篇 Feature 测试文档的“例外规范”是新增或保留 Unit 的准入面。本页定义登记流程与预算，不逐条复述测试 case。

## 风险类别是设计输入

Unit 例外与 Feature 契约同批定稿。设计变更影响 `docs/feature/**` 时，对应测试文档只登记无法由 E2E 完整证明的风险：

- 对应用户结果的 Journey 或单边界 E2E owner；
- E2E 为什么无法稳定制造、穷举或区分；
- 会通过的具名错误算法；
- 最小等价类矩阵；
- Unit 进入生产逻辑的稳定 seam。

具体场景由测试名枚举，docs 不维护第二份 case 清单。

每个例外使用稳定 anchor，推荐表形状如下：

| Owner ID | 具名风险 | E2E 主 owner | E2E 不足 | 最小矩阵 | 稳定 seam |
|---|---|---|---|---|---|
| `#fingerprint-inputs` | 漏掉一种身份输入 | `e2e/runner/...` | Journey 无法穷举输入组合 | 每种输入一次变化 | `FingerprintPort` |

类别名称本身不授予保留资格。“公式”“schema”“纯逻辑”或“离实现近”都不能填入 E2E 不足列。

## 写测流程

- 测试只实现已经批准的 Unit 例外；无法指认 owner anchor 的旧测试按 [Unit 核心判据](README.md#存在资格) 删除。
- 实现中发现新风险时，先查 Journey 或单边界 E2E；只有它们无法证明时，才登记 Unit 例外。
- Bug 回归仍归属 Feature 类别；确认旧实现会逃逸后，用 `// bug: memory/<条目>.md` 保存现象、根因与修法凭据。
- 测试文件首行用 `// owner: docs/engineering/testing/unit/<feature>.md#<anchor>` 声明唯一 owner。

## 类别预算

- 一个例外按最小等价类、边界值和状态组合展开，不按测试数量或代码行比例补齐。
- 同一场景的第二条测试默认是维护负担；若跨故障边界保留两处，必须分别说明会放走的错误不同。
- 没有新增契约的实现重构可以零新增测试。
- fixture 的区分力规则见 [Harness](harness.md)。

Unit 无法通过[可靠性接管门](../README.md#可靠性重复运行)时，不以 retry、固定 sleep 或 mock 核心算法换取通过。
该行为按[不自动化](../README.md#不自动化)处理，由本次 AI 真实验收，不建立 Unit owner。

## 机器守护与评审

机器守护保证每个测试文件只有一个 `owner:`、anchor 存在，并验证 `// bug:` 引用。
例外是否必要、矩阵是否最小、稳定 seam 是否成立，仍由评审对照例外规范裁决。
