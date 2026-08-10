# 更换上层 API 而保持旧 Record 可读

这个用例证明 Assertion API 与 Record、Report 解耦。producer 可以改 matcher 语法、collector、memoization 或 evaluation algorithm；只要继续写出冻结的 <code>niceeval.assertions</code> 投影，底层 reader 和标准 Attempt detail 都不需要跟着改。

## 时间边界

本契约在 <code>niceeval.record</code> 首次发布前定稿，因此没有一个更早、已经合法写出的 assertions shape。Assertions Architecture 定义的 document 就是新格式第一天的冻结契约。

这里的“旧 Record”是由较早 producer generation 写出、但仍使用相同 <code>niceeval.record</code> 核心与稳定通道契约的数据。

## 业务场景

第一代 producer 使用 API A 运行一次 Eval，并把 Attempt 写入 Record。后续版本把 assertion 语法改成 API B，也重构了 matcher 与 collector。

只要业务展示事实不变，检查名称、分组、判定分类、可用性、得分、通过线、预览、证据和给分仍归一成同一个 <code>AssertionsDocument</code>。

用户升级到后续版本后，仍要查看较早 Run 的结果。这不是 carry 场景；用户显式选择旧 Run，Record reader 按 Member 引用打开旧 Attempt，标准 Report 再读取其 assertions。

~~~text
显式选择旧 Run。
      ↓
Member 引用旧 Attempt。
      ↓
niceeval.assertions raw file。
      ↓
永久内建 decoder。
      ↓
标准 Assertions FactRequirement。
      ↓
Attempt detail PageModel / textAlternative。
      ↓
同一 ReportExecution → show / view / 当前 exporter。
~~~

CLI 只有显式 Run selection；本用例不新增也不假设独立 Attempt selector。Attempt detail route 由已选 Run 的 Member 与 ReportPlan 建立。

## 为什么 API 改动不触碰底层

Record 不保存以下 producer 实现细节：

- public API 或 matcher 名称；
- matcher 默认线怎样产生；producer 必须把最终 threshold 写成数值；
- collector、memoization、Fact 使用图或 evaluation algorithm；
- <code>stopOnFailure</code> 或其它控制流；
- strict policy 的折叠过程；最终 Attempt Verdict 已独立写入 <code>niceeval.verdict</code>。

标准 Report 只消费冻结投影。API A 与 API B 只要产生逐字段相同的 decoded value，就形成相同的标准 Assertions <code>PageModel</code> 与 <code>textAlternative</code>。show 与 view 消费同一份 <code>ReportExecution</code>。

## 兼容矩阵

| reader | writer | 保证 |
|---|---|---|
| 较早 reader | 较早 writer | 读取并展示冻结的 assertions。 |
| 后续 reader | 较早 writer | assertions 深等价读取，并可进入标准 Attempt detail。 |
| 较早 reader | 后续 writer | 只要后续 writer 仍写冻结的 assertions，较早 reader 继续读取；新加的无关通道按 unknown 规则保留，较早 reader 不必理解。 |
| 后续 reader | 后续 writer | 读取冻结的 assertions；新增业务只通过新的描述性 requirement 和 channel 进入。 |

eligibility 的 domain 或 value 改变可能让旧 Attempt 不再满足 carry，但不影响显式选择旧 Run 后读取、show、view 或重新 export。carry 成功不能替代本用例的读取证明。

已经生成的静态报告站是自包含文件。直接打开它不会读取 Record，因此也不能证明后续 reader 仍兼容旧 Assertions document；验收必须从旧 Record 重新建立 ReportInput。

## 实现验收

第一版 <code>niceeval.record</code> writer 实现时，保存它实际生成的原始 fixture bytes。以后不能用当前 writer 重新生成这份 fixture，否则测试只会证明当前版本能读取自己。

每个后续 reader 至少验证：

1. 用当前 reader 打开第一版 fixture，而不是打开既有静态 export。
2. 显式选择旧 Run，并沿 Member 取得旧 Attempt。
3. 标准 Assertions requirement 读取 <code>niceeval.assertions</code>，得到与冻结 fixture 逐字段深等价的值。
4. 同一标准 definition 与 runtime 形成预期的 <code>PageModel</code> 和 <code>textAlternative</code>。
5. show 与 view 使用同一份 <code>ReportExecution</code>，当前 exporter 能从旧 Record 成功重新 export。

重新 export 不承诺输出目录逐 byte 相等。用户自定义 Report 可以读取时间或随机源，因此展示等价只约束确定性的标准 Assertions projection。

## 什么时候必须新增通道

如果 API B 产生了旧投影无法表达的新业务事实，不能给同名 document 增字段、改类型、改含义或放宽永久限制。应新增没有数字版本后缀的描述性 business channel，并给使用它的 Report 增加新 requirement。

旧 <code>niceeval.assertions</code> decoder 与标准 Attempt detail 入口仍永久保留。新 reader 可以同时展示旧投影与新事实；旧 reader 则继续展示自己认识的旧投影。

## 相关阅读

- [Assertions 稳定落盘投影](../../assertions/architecture.md#稳定落盘投影)
- [Record 通道语义与兼容性](../architecture.md#通道语义与兼容性)
- [Reports FactRequirement](../../reports/library.md#factrequirement)
- [Reports CLI](../../reports/cli.md)
