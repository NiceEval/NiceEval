# 编译期作者契约

NiceEval 的 TypeScript 作者面同时包含作者声明、框架派生值和运行时数据。
当这三类事实共用一个宽接口时，TypeScript 会接受文档已经禁止的组合，错误只能等到模块装载、Agent setup 或报告渲染时出现。

本候选把静态可判定的约束前移到调用点。
运行时校验继续覆盖 JavaScript、类型断言、动态导入和 JSON 往返，不再承担 TypeScript 作者面的第一道反馈。

## 解决的问题

当前目标契约中有四种重复模式：

1. 作者被禁止填写的派生字段仍作为可选字段出现在输入类型中。
2. 两个字段要求二选一或共同出现，类型却把它们分别声明为 optional。
3. 两组对象键或字段值存在关系，泛型只描述返回值，没有约束调用参数。
4. 宿主只接受 `define*` 产物，公开类型却可以由普通对象按结构伪造。

这些问题让错误反馈远离出错调用点，也让文档中的“禁止”“二选一”和“只收 factory 产物”无法由 TypeScript 证明。

## 核心心智

每条事实只由一个 owner 声明：

| 事实 | owner | 校验位置 |
|---|---|---|
| 作者选择的 agent、page、字段和计算 | 作者输入 | TypeScript；运行时作无类型后备 |
| 路径生成的 id、factory 生成的 scoring、规划生成的 configHash | 发现器、factory、规划器 | 对应阶段构造，不回流到作者输入 |
| 文件是否存在、URL 是否可达、请求 options 的实际成员 | 运行时资源 | 运行时 |
| JSON 行的真实结构、跨行一致性和数值关系 | 数据读取边界 | 运行时 |
| 实际 Eval × Experiment 是否恰好一份 Sandbox template | discovery、selector 与 CLI filter 形成的 pair | 资源前 linker；`niceeval check` 与正常运行共用 |

类型重构使用四种固定工具：

- **阶段类型**：作者输入、定义产物、发现结果和规划结果使用不同类型。
- **穷尽联合**：二选一与字段依赖使用 union，并用 `never` 排除另一分支字段。
- **关系泛型**：键冲突、字段存在性和值类别由输入泛型计算。
- **不可伪造品牌**：只允许 factory 产生的定义带模块私有 `unique symbol`。

## 候选范围

| 契约族 | 候选改动 | 作者得到的反馈 |
|---|---|---|
| Eval / Experiment | 拆分 Author Input、Definition 与 Discovered 类型；移出 `id`、`scoring`、`configHash` | 禁止字段在 `define*` 调用处报类型错误 |
| Report page | 普通页与参数化页组成 union | `params` 缺 `load` 或 `navigation: false` 时不能编译 |
| MCP server | stdio 与 HTTP 分支互相声明负字段 | `command` 与 `url` 同时出现时不能编译 |
| HITL answer | `optionId` 与 `text` 使用共享 XOR 值类型 | 两者都缺或同时出现时不能编译 |
| Aggregate | 把分组键、读数键和 `refs` 的关系约束放到 options | 冲突键在 `aggregate()` 调用处报错 |
| Evidence row | 输入类型证明至少有一个 `MetricValue` 字段 | 只有维度字段的对象不能编译 |
| Report charts | `x`、`y`、`series`、`point`、`sort.field` 使用按值类型过滤后的键 | 不存在或不可绘制的静态字段不能编译 |
| Custom Sandbox case | `groupKeep` 推导 `group-keep`；作者不能重复声明该 capability | 不再产生两处声明不一致的组合 |
| Theme / Report definition | factory 产物增加模块私有品牌 | 普通对象不能冒充宿主可装载定义 |
| Sandbox recipe | template factory 与 Provider 原子绑定；phase context 精确分型 | 单个 recipe 的非法形状在调用点失败；跨 pair 的 1×1 / 0×0 在 linker 一次报全 |

精确类型与调用形状见 [Library](library.md)。
阶段边界、源码改动面和验收顺序见 [Architecture](architecture.md)。

## 编译期的真实边界

不能把“TypeScript 没法跨模块证明”当成把错误拖进 Sandbox 的理由，也不能为了让泛型看见整个矩阵，反过来要求 Experiment 静态 import 所有 Eval。

PLAN-9 中一个 Eval 的 `composeSandbox(...)` 与另一个 Experiment 的 `e2bSandbox(...)` 各自在本文件里都合法；是否冲突还取决于 discovery、Experiment selector 与 CLI filter 形成的实际 pair。普通 `tsc` 在两个独立定义的调用点无法证明这条 XOR。

因此边界固定为两层：

- TypeScript 拒绝单个声明内可知的错误：伪造 recipe、非法 factory options、phase context 错配，以及在已有 recipe 上追加 template / Provider。
- discovery 后的纯 linker 穷举实际 Eval × Experiment pair；Sandbox Agent 的 1×1 是 `sandbox.template-conflict`，0×0 是 `sandbox.template-missing`。`niceeval check` 与正常运行消费同一个 linker，任何 Provider 网络、fingerprint、build 或 Sandbox create 都在它之后。

这仍是 author-time feedback，只是属于项目级 configuration link，而不是单文件 TypeScript inference。真正的生命周期 command 只负责 shell 能否成功，不再承担 template 唯一性检查。

## 运行时校验仍是契约

编译期约束不删除对应运行时守卫。
JavaScript、`unknown`、动态 import 和显式类型断言仍可能绕过静态类型，因此两层必须拒绝同一类错误。

运行时错误继续负责以下信息：

- 指出配置文件、server、page、字段或冲突键的真实名字。
- 指出下一步应删除、补充或改写哪个字段。
- 在写文件、启动进程或渲染输出之前失败。

其中跨定义约束必须在资源前 linker 失败；“运行时后备”不等于允许等到 Agent setup 或第一条 Attempt 才失败。

类型系统不负责证明网络可达、文件存在、请求 option 真实存在、数组元素跨行一致或 `samples <= total`。
这些事实依赖运行时值，继续由现有边界校验。

## 迁移纪律

NiceEval 处于 beta，本候选不以保留宽类型别名为默认目标。
采用后先重写对应 Feature 的目标契约与类型测试，再修改实现；不把 Roadmap 文案直接当成已经定稿的 Feature 契约。

公共签名允许破坏性收窄，但运行时接收边界保持可诊断：旧 JavaScript 调用得到明确错误，不因类型重构变成静默取舍。
内部代码若依赖宽类型，应改用明确的 normalized 或 discovered 类型，不通过 `as` 把作者输入重新放宽。

## 不在本候选里的问题

- 不用模板字面量类型校验 URL、CSS、文件路径或十六进制颜色的全部语法。
- 不尝试在 TypeScript 中证明动态 page id 全局唯一或数据数组跨行同构。
- 不改变 Eval、Experiment、Report、Sandbox、MCP 或 HITL 的业务语义。
- 不新增 schema、CLI flag 或运行时序列化字段。
- 不用删掉运行时守卫来证明类型足够严格。

## 待裁决分歧

1. **作者输入的公开名字。** 候选倾向导出 `EvalInput`、`ScoreEvalInput` 与 `ExperimentInput`，让 `EvalDefinition` 和 `ExperimentDefinition` 专指 factory 产物；另一种选择是保留 `EvalDef` / `ExperimentDef` 名字，但彻底移除派生字段。
2. **动态 TypeScript 数据的显式入口。** 候选倾向让无法静态证明含 `MetricValue` 的对象先经过独立解析函数，再进入 `evidenceRow()`；另一种选择是为宽对象保留 overload，但这会让普通错误对象也逃回运行时。
3. **关系泛型的错误文本。** 候选倾向使用带冲突键名的诊断辅助类型；若 TypeScript 展示结果过长，则退回 `never` 约束，并由类型测试锁定最小可读反馈。

## 入口

- [Library](library.md) —— 各公共类型的候选形状与正反调用。
- [Architecture](architecture.md) —— 阶段所有权、改动落点、兼容边界与验收矩阵。
