# Experiment 对账：把有效证据补到目标状态

Roadmap 候选设计，见 [Roadmap 约定](../README.md)。
本篇从 `niceeval exp` 的产品承诺出发，重新定义默认沿用、手动重跑与一次性认账。
指纹退回内部索引，不再充当用户理解这条路径的起点。

实体、阶段与落盘形状见 [Architecture](architecture.md)；API 面见 [Library](library.md)；
CLI 计划与覆盖出口见 [CLI](cli.md)；按场景的写法见 [Use Case](use-case/README.md)。

## 核心承诺

`niceeval exp compare/codex` 的含义不是「现在把所有 eval 全跑一遍」，也不是「查缓存」。
它表示：

> 按当前 Experiment 定义，把选中 eval 的有效证据集补到目标状态。
> 已有证据能证明满足当前要求时沿用，只执行缺失、失效或无法证明有效的部分。

`attempts: 5` 因此表示每条 eval 需要五个有效证据槽位。
一次 Invocation 是一次对账动作，Run 是对账完成后的当前证据快照。

## 默认到底宽还是严

默认不按「尽量用」或「尽量不用」二选一，而按**能否证明**裁决：

| 当前变化 | 默认动作 | 理由 |
|---|---|---|
| 没有影响当前要求的变化 | 沿用 | 历史证据直接满足目标 |
| `attempts` 调大、并发或预算变化 | 沿用已有部分，只补缺口 | 只改变目标数量或编排 |
| model、flags、Agent 能力、Sandbox 起步环境变化 | 重跑受影响部分 | 被测条件已经变化 |
| eval 判定逻辑或输入数据变化 | 重跑受影响 eval | 旧证据回答的是旧问题 |
| 系统无法判断的 Hook、外部状态或依赖 | 默认重跑 | 猜错会静默采信无效证据 |
| 用户确认的一次精确无语义变化 | 沿用并记录认账 | 人补上系统缺少的语义判断 |

所以默认策略是：**已证明有效才沿用，未知不是有效。**
这条策略保留增量执行的收益，同时把无法判断时的错误方向固定为多跑。

## 两种人工覆盖

系统判断之后，用户只需要说两个方向相反的话：

- **收紧采信：**`--rerun failed|all` 表示本次对账不采信哪些已有判定。
  它用于外部世界变化但 Experiment 没有 observer，或用户就是要复验。
- **放宽采信：**`--accept-change <path>` 接受计划中这次精确源码差异不改变证据含义。
  它只接受当前计划已经列出的 old digest → new digest 转换，不形成永久忽略规则。

两者都不修改 Experiment 定义，也不改变后续默认政策。
`--rerun` 让本次多跑；`--accept-change` 建立一次可审计的证据等价关系。

## 为什么不能只继续扩指纹

指纹只能回答两个已知输入是否相同，回答不了三个更上层的问题：

1. 当前 Experiment 到底要求多少条、什么条件下的证据；
2. 外部资源在规划前能否被只读观测；
3. 一次源码变化是否只改了格式、没有改变判定语义。

把三者继续塞进一个哈希会产生两个相反错误：

- 漏输入时错误沿用；
- 把编排与格式变化也算输入时无谓重跑。

候选设计改为先生成 `EvidenceRequirement`，再拿它与历史 `Evidence` 对账。
内部 `requirementKey` 只加速精确匹配；完整输入清单与差异必须落盘，不能只存最终哈希。

## Experiment 新的职责

Experiment 仍然描述「怎么跑这批 eval」，但它的目标形态从运行参数袋收紧为**证据目标声明**：

- 被测条件：Agent、model、flags、Sandbox 与 eval 选择；
- 证据目标：每条 eval 需要多少个有效 Attempt；
- 编排政策：并发、预算、early exit 与 timeout；
- 外部资源：规划前只读 observer，以及真正执行前才运行的 setup / teardown。

observer 只回答「现在连接的是哪个资源版本」，不得创建或修改资源。
setup 只在计划里存在派发项时执行，继续负责有副作用的准备与收尾。

## 方案解决的问题

### 改完 eval 或 Experiment 后不再靠猜

系统先显示当前要求与历史证据的结构差异，再按上表自动裁决。
已知编排变化继续增量补齐；条件与判定变化自动重跑；未知依赖默认重跑。

### 外部状态可以在规划前进入判断

Experiment 可以给记忆库、数据集或远端服务声明只读 observer。
observer 返回稳定 `resourceVersion`；版本变化使依赖它的证据失效。
没有 observer 也没有静态 epoch 时，该依赖是 `opaque`，默认不沿用。

### 格式化一类变化有一次性出口

系统保存完整源码 manifest，能展示具体路径与 digest 变化。
用户接受的是这次 old → new 差异，不是把某个路径永久踢出判断。

### 缓存与跨 Run 可比性不再共用一个结论

对账判断一条历史 Evidence 能否满足当前 Requirement。
Sample 是否拼接多个 Run 则由读取面的版本化 `ComparisonProfile` 决定。
两者共享落盘事实，不共享一个 `configHash` 布尔结论。

## 明确边界

- 任意函数 Hook 的运行语义不能从 `Function#toString()` 可靠恢复。
  Hook 没有声明式 recipe 或 observer 时，对应要求是 `opaque`。
- 历史 Run 没落某个新字段时，今天无法凭空恢复。
  只有能证明缺失等价于默认值才迁移，否则可比性为 `unknown`。
- `node_modules`、动态 `import()` 与项目外依赖若未进入 manifest，同样属于 `opaque`。
- 用户可以认账一次精确变化，但不能配置永久 source ignore。

## 待裁决分歧

1. `sandboxReuse: true` 产出的首个 Attempt 是否与非复用模式等价。
   在等价性定稿前，模式变化默认使全部证据失效。
2. 任意 Hook 是统一标记整条 eval 为 `opaque`，还是允许作者给 Hook 提供声明式 recipe。
3. observer 失败时是整场启动错误，还是把依赖它的 eval 标为 `opaque` 后继续规划。
   本方案倾向后者，并在计划中给出醒目诊断。
4. `--accept-change` 是否只接受源码差异，还是同时接受 Agent / Sandbox manifest 差异。
   本方案先只开放源码，避免把被测条件变化做成日常豁免。

## 相关阅读

- [Architecture](architecture.md) —— EvidenceRequirement、对账阶段、证明等级与来源链。
- [CLI](cli.md) —— 默认计划、`--rerun` 与 `--accept-change`。
- [Library](library.md) —— Experiment resource observer、AgentSpec、EnvironmentRecipe 与 loader。
- [Use Case](use-case/README.md) —— 改完不同部分后默认沿用还是重跑。
- [缓存与携带](../../feature/experiments/cache.md) —— 当前已定稿的六道门与 Attempt 粒度。
- [Record](../../feature/record/architecture.md) —— 当前 Run 与 Attempt 的落盘契约。
